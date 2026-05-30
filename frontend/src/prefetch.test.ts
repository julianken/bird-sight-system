import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// O9 (#781): unit coverage for the scope-gated MapCanvas chunk prefetch.
//
// The module under test schedules a low-priority dynamic `import()` of the
// SAME MapCanvas chunk the MapSurface.tsx React.lazy boundary loads, exactly
// once per page lifetime. These tests pin the load-bearing properties:
//   1. idempotency — repeated calls trigger the underlying import at most once;
//   2. scheduling — requestIdleCallback when present, setTimeout fallback when not;
//   3. rejection safety — a failed prefetch never becomes an unhandled rejection;
//   4. SSR safety — strict no-op when `typeof window === 'undefined'`.
//
// We mock the MapCanvas module specifier so the import resolves without pulling
// maplibre-gl (and its WebGL/createObjectURL needs) into jsdom. Each test
// `vi.resetModules()` + re-applies the mock so BOTH the module-level `warmed`
// guard in prefetch.ts AND the MapCanvas mock-factory re-evaluate fresh — a
// stale warm OR a cached MapCanvas module from a prior test can't mask a real
// regression (or make the import-fired counter read zero).
//
// These tests deliberately use REAL timers + an explicit flush rather than fake
// timers: the scheduled callback fires a dynamic `import()` whose resolution
// runs on the microtask queue, which fake timers do not flush deterministically
// for a mocked module. `setTimeout(fn, 1)` / a synchronously-invoked idle
// callback settle within a couple of real milliseconds.

const importSpy = vi.fn();

/**
 * Install the MapCanvas mock fresh against the just-reset module registry and
 * return `prefetchMapCanvas` from a freshly-loaded prefetch module. `shouldThrow`
 * drives the rejected-import case. Counting `importSpy` is the proxy for "the
 * underlying import() fired" — the factory re-runs because the registry was reset.
 */
async function loadFresh(
  shouldThrow = false,
): Promise<typeof import('./prefetch.js')> {
  vi.resetModules();
  importSpy.mockClear();
  vi.doMock('./components/map/MapCanvas.js', () => {
    importSpy();
    if (shouldThrow) throw new Error('prefetch boom');
    return { MapCanvas: () => null };
  });
  return import('./prefetch.js');
}

/** Yield long enough for setTimeout(fn,1) + the dynamic-import microtasks. */
async function flush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 10));
  await Promise.resolve();
}

describe('prefetchMapCanvas (O9 #781)', () => {
  beforeEach(() => {
    importSpy.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.doUnmock('./components/map/MapCanvas.js');
  });

  it('warms the MapCanvas chunk exactly once even when called repeatedly (idempotent)', async () => {
    const { prefetchMapCanvas } = await loadFresh();

    prefetchMapCanvas();
    prefetchMapCanvas();
    prefetchMapCanvas();

    await flush();

    // The module-level guard collapses three calls into a single import().
    expect(importSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to setTimeout when requestIdleCallback is undefined and still imports', async () => {
    // jsdom has no window.requestIdleCallback by default; be explicit.
    vi.stubGlobal('requestIdleCallback', undefined);
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    const { prefetchMapCanvas } = await loadFresh();
    prefetchMapCanvas();

    // Scheduled via the setTimeout fallback path, not requestIdleCallback.
    expect(setTimeoutSpy).toHaveBeenCalled();

    await flush();
    expect(importSpy).toHaveBeenCalledTimes(1);
  });

  it('uses requestIdleCallback when available', async () => {
    const ric = vi.fn((cb: IdleRequestCallback) => {
      // Invoke synchronously with a stub deadline so the import fires.
      cb({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
      return 1;
    });
    vi.stubGlobal('requestIdleCallback', ric);

    const { prefetchMapCanvas } = await loadFresh();
    prefetchMapCanvas();

    expect(ric).toHaveBeenCalledTimes(1);
    await flush();
    expect(importSpy).toHaveBeenCalledTimes(1);
  });

  it('swallows a rejected import — no unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    const { prefetchMapCanvas } = await loadFresh(/* shouldThrow */ true);
    prefetchMapCanvas();

    await flush();

    expect(importSpy).toHaveBeenCalledTimes(1);
    expect(unhandled).not.toHaveBeenCalled();

    process.off('unhandledRejection', unhandled);
  });

  it('is a strict no-op under SSR (typeof window === "undefined")', async () => {
    // Remove `window` to simulate SSR / a non-DOM environment.
    const originalWindow = globalThis.window;
    // @ts-expect-error — deliberately deleting window for the SSR no-op assertion.
    delete globalThis.window;

    const { prefetchMapCanvas } = await loadFresh();
    expect(() => prefetchMapCanvas()).not.toThrow();

    await flush();
    expect(importSpy).not.toHaveBeenCalled();

    globalThis.window = originalWindow;
  });
});

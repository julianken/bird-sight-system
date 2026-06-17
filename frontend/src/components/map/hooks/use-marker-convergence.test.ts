import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMarkerConvergence } from './use-marker-convergence.js';
import type { ConvergenceMap, ConvergenceMapRef, MarkerConvergenceTelemetry } from './use-marker-convergence.js';
import type { MapSourceDataEvent } from 'maplibre-gl';

/**
 * Unit tests for the marker-convergence watchdog (#1236).
 *
 * Design invariants locked here:
 *   1. Cold-mount is a no-op (FP-safety: dataGen===committedGen===0 → no repaint).
 *   2. STAMP only on `idle` — `sourcedata` DRIVES only, never stamps.
 *      (False-convergence guard: a stamp on sourcedata would record health
 *       against an unpainted frame — `idle` is the only painted-frame signal.)
 *   3. `sourcedata` fires exactly one rAF-coalesced `triggerRepaint` per burst.
 *   4. Watchdog heals: bumping `dataVersion` starts the loop; `idle` stamps →
 *      loop self-cancels with no telemetry.
 *   5. Backstop: budget expiry → one final `triggerRepaint` + telemetry once.
 *   6. Re-arm: bumping `dataVersion` twice clears the prior timer.
 *   7. Cleanup: unmount removes both listeners, cancels timer + rAF.
 */

// ---------------------------------------------------------------------------
// Fake map — spy-testable narrow surface matching ConvergenceMap.
// Captures `idle` and `sourcedata` handlers so tests can fire them.
// ---------------------------------------------------------------------------
type IdleListener = () => void;
type SourceDataListener = (e: MapSourceDataEvent) => void;

function makeFakeMap() {
  const idleListeners: IdleListener[] = [];
  const sourceDataListeners: SourceDataListener[] = [];

  const map = {
    triggerRepaint: vi.fn(),
    on: vi.fn((type: string, listener: IdleListener | SourceDataListener) => {
      if (type === 'idle') idleListeners.push(listener as IdleListener);
      if (type === 'sourcedata') sourceDataListeners.push(listener as SourceDataListener);
    }),
    off: vi.fn((type: string, listener: IdleListener | SourceDataListener) => {
      if (type === 'idle') {
        const idx = idleListeners.indexOf(listener as IdleListener);
        if (idx !== -1) idleListeners.splice(idx, 1);
      }
      if (type === 'sourcedata') {
        const idx = sourceDataListeners.indexOf(listener as SourceDataListener);
        if (idx !== -1) sourceDataListeners.splice(idx, 1);
      }
    }),
    // Test-only helpers to fire captured events.
    __fireIdle: () => { for (const fn of [...idleListeners]) fn(); },
    __fireSourceData: (e: Partial<MapSourceDataEvent>) => {
      for (const fn of [...sourceDataListeners]) fn(e as MapSourceDataEvent);
    },
    __idleListeners: idleListeners,
    __sourceDataListeners: sourceDataListeners,
  };
  return map;
}

type FakeMap = ReturnType<typeof makeFakeMap>;

function makeMapRef(map: FakeMap) {
  const ref = {
    current: {
      getMap: () => map as unknown as ConvergenceMap,
    } as ConvergenceMapRef,
  };
  return ref;
}

// ---------------------------------------------------------------------------
// A qualifying sourcedata event payload (the fast-path trigger).
// ---------------------------------------------------------------------------
function observationsContent(overrides: Partial<MapSourceDataEvent> = {}): Partial<MapSourceDataEvent> {
  return {
    sourceId: 'observations',
    isSourceLoaded: true,
    sourceDataType: 'content',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('useMarkerConvergence', () => {
  let rafQueue: Array<{ id: number; cb: FrameRequestCallback }>;
  let rafIdSeq: number;
  let cancelledRafIds: number[];
  let fakeNow: () => number;
  let currentTime: number;

  beforeEach(() => {
    vi.useFakeTimers();
    currentTime = 0;
    rafQueue = [];
    cancelledRafIds = [];
    rafIdSeq = 0;
    fakeNow = () => currentTime;

    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafIdSeq += 1;
      const id = rafIdSeq;
      rafQueue.push({ id, cb });
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      cancelledRafIds.push(id);
      const idx = rafQueue.findIndex(e => e.id === id);
      if (idx !== -1) rafQueue.splice(idx, 1);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function flushRaf(): void {
    const pending = [...rafQueue];
    rafQueue = [];
    for (const { cb } of pending) cb(currentTime);
  }

  function advanceTime(ms: number): void {
    currentTime += ms;
    vi.advanceTimersByTime(ms);
  }

  // -------------------------------------------------------------------------
  // 1. Cold-mount no-op (FP-safety)
  // -------------------------------------------------------------------------
  it('cold-mount: dataGen===0, committedGen===0 → no triggerRepaint, no telemetry', () => {
    const map = makeFakeMap();
    const mapRef = makeMapRef(map);
    const onTelemetry = vi.fn();
    const dataVersion = {};

    renderHook(() =>
      useMarkerConvergence(mapRef, true, dataVersion, { now: fakeNow, onTelemetry }),
    );

    // Watchdog exits immediately (reflected() === true at mount).
    expect(map.triggerRepaint).not.toHaveBeenCalled();
    expect(onTelemetry).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 2. Stamp only on `idle` (false-convergence guard)
  // -------------------------------------------------------------------------
  it('sourcedata does NOT advance committedGen; idle DOES stamp committedGen', () => {
    const map = makeFakeMap();
    const mapRef = makeMapRef(map);
    const onTelemetry = vi.fn();

    // Use a stable first version so dataGen=0 at mount.
    const v0 = {};
    const { rerender } = renderHook(
      ({ dv }: { dv: unknown }) =>
        useMarkerConvergence(mapRef, true, dv, { now: fakeNow, onTelemetry }),
      { initialProps: { dv: v0 } },
    );

    // Bump dataVersion to dataGen=1 — watchdog arms.
    const v1 = {};
    rerender({ dv: v1 });
    // Advance past first backoff tick but stay under budget.
    advanceTime(100);

    // Fire sourcedata — should trigger repaint but NOT stamp.
    map.__fireSourceData(observationsContent());
    flushRaf();
    expect(map.triggerRepaint).toHaveBeenCalled();

    // Now fire idle — should stamp committedGen=1 → watchdog self-cancels.
    map.__fireIdle();
    map.triggerRepaint.mockClear();

    // Advance more time — after stamp, watchdog should be gone.
    advanceTime(500);
    expect(map.triggerRepaint).not.toHaveBeenCalled();
    // No telemetry (healed before budget).
    expect(onTelemetry).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 3. sourcedata drive + filter
  // -------------------------------------------------------------------------
  it('qualifying sourcedata event triggers one rAF-coalesced triggerRepaint', () => {
    const map = makeFakeMap();
    const mapRef = makeMapRef(map);

    renderHook(() =>
      useMarkerConvergence(mapRef, true, {}, { now: fakeNow }),
    );

    // Fire 3 qualifying events in one burst — should coalesce to ONE repaint.
    map.__fireSourceData(observationsContent());
    map.__fireSourceData(observationsContent());
    map.__fireSourceData(observationsContent());

    expect(map.triggerRepaint).not.toHaveBeenCalled(); // rAF pending
    flushRaf();
    expect(map.triggerRepaint).toHaveBeenCalledTimes(1);
  });

  it('sourcedata with wrong sourceId → no triggerRepaint', () => {
    const map = makeFakeMap();
    const mapRef = makeMapRef(map);

    renderHook(() =>
      useMarkerConvergence(mapRef, true, {}, { now: fakeNow }),
    );

    map.__fireSourceData(observationsContent({ sourceId: 'state-mask' }));
    flushRaf();
    expect(map.triggerRepaint).not.toHaveBeenCalled();
  });

  it('sourcedata with sourceDataType=metadata → no triggerRepaint', () => {
    const map = makeFakeMap();
    const mapRef = makeMapRef(map);

    renderHook(() =>
      useMarkerConvergence(mapRef, true, {}, { now: fakeNow }),
    );

    map.__fireSourceData(observationsContent({ sourceDataType: 'metadata' }));
    flushRaf();
    expect(map.triggerRepaint).not.toHaveBeenCalled();
  });

  it('sourcedata with isSourceLoaded=false → no triggerRepaint', () => {
    const map = makeFakeMap();
    const mapRef = makeMapRef(map);

    renderHook(() =>
      useMarkerConvergence(mapRef, true, {}, { now: fakeNow }),
    );

    map.__fireSourceData(observationsContent({ isSourceLoaded: false }));
    flushRaf();
    expect(map.triggerRepaint).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 4. Heal-on-retry: watchdog fires → idle stamps mid-loop → stops, no telemetry
  // -------------------------------------------------------------------------
  it('heal-on-retry: watchdog triggerRepaints; idle stamp stops loop with no telemetry', () => {
    const map = makeFakeMap();
    const mapRef = makeMapRef(map);
    const onTelemetry = vi.fn();
    const backoffMs = [100, 200, 400] as const;

    const v0 = {};
    const { rerender } = renderHook(
      ({ dv }: { dv: unknown }) =>
        useMarkerConvergence(mapRef, true, dv, { now: fakeNow, onTelemetry, backoffMs, budgetMs: 2000 }),
      { initialProps: { dv: v0 } },
    );

    // Bump dataVersion → dataGen=1, watchdog arms.
    const v1 = {};
    rerender({ dv: v1 });

    // First tick fires immediately (attempts=1, first repaint).
    expect(map.triggerRepaint).toHaveBeenCalledTimes(1);

    // Advance to second tick.
    advanceTime(100);
    expect(map.triggerRepaint).toHaveBeenCalledTimes(2);

    // Fire idle mid-loop → stamps committedGen=1.
    map.__fireIdle();
    map.triggerRepaint.mockClear();

    // Advance past third tick — should NOT fire because watchdog stopped.
    advanceTime(200);
    expect(map.triggerRepaint).not.toHaveBeenCalled();
    expect(onTelemetry).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 5. Backstop: budget expiry → one final triggerRepaint + telemetry, no double-fire
  // -------------------------------------------------------------------------
  it('backstop: budget expiry triggers one final repaint + onTelemetry exactly once', () => {
    const map = makeFakeMap();
    const mapRef = makeMapRef(map);
    const onTelemetry = vi.fn<(t: MarkerConvergenceTelemetry) => void>();
    const budgetMs = 1000;
    const backoffMs = [100, 200, 400, 800] as const;

    const v0 = {};
    const { rerender } = renderHook(
      ({ dv }: { dv: unknown }) =>
        useMarkerConvergence(mapRef, true, dv, { now: fakeNow, onTelemetry, backoffMs, budgetMs }),
      { initialProps: { dv: v0 } },
    );

    // Bump dataVersion → watchdog arms. Do NOT fire idle (never stamp).
    const v1 = {};
    rerender({ dv: v1 });

    // Drain the watchdog loop through the budget without stamping.
    // t=0: tick → repaint(1), schedule 100ms
    // t=100: tick → repaint(2), schedule 200ms
    // t=300: tick → repaint(3), schedule 400ms
    // t=700: tick → repaint(4), schedule 800ms (but budget=1000 so t=1500 > 1000)
    // Actually at t=700+800=1500 tick fires but elapsed=1500>=1000 → backstop.
    // Let's just advance past the budget and drain all pending ticks.
    advanceTime(100); // t=100
    advanceTime(200); // t=300
    advanceTime(400); // t=700
    // At t=700, next tick scheduled for 800ms delay → fires at t=1500
    // But budget=1000ms, so when the tick at t=1500 checks elapsed=1500>=1000 → backstop.
    advanceTime(800); // t=1500 → backstop fires

    // Backstop: one additional repaint + telemetry.
    expect(onTelemetry).toHaveBeenCalledTimes(1);
    const telemetry = onTelemetry.mock.calls[0][0];
    expect(telemetry.attempts).toBeGreaterThan(0);
    expect(telemetry.elapsedMs).toBeGreaterThanOrEqual(budgetMs);

    // Advance further — no more repaints or telemetry.
    const repaintCountAtBackstop = map.triggerRepaint.mock.calls.length;
    advanceTime(5000);
    expect(map.triggerRepaint).toHaveBeenCalledTimes(repaintCountAtBackstop);
    expect(onTelemetry).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // 6. Re-arm + thrash: bump twice → only latest watchdog active, prior timer cleared
  // -------------------------------------------------------------------------
  it('re-arm/thrash: second dataVersion bump clears the first watchdog timer', () => {
    const map = makeFakeMap();
    const mapRef = makeMapRef(map);
    const onTelemetry = vi.fn();
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    const v0 = {};
    const { rerender } = renderHook(
      ({ dv }: { dv: unknown }) =>
        useMarkerConvergence(mapRef, true, dv, { now: fakeNow, onTelemetry, budgetMs: 2000 }),
      { initialProps: { dv: v0 } },
    );

    // First bump → watchdog 1 starts.
    const v1 = {};
    rerender({ dv: v1 });
    expect(map.triggerRepaint).toHaveBeenCalledTimes(1);

    // Second bump (no idle in between) → watchdog 2 starts; watchdog 1 cleanup called.
    const v2 = {};
    rerender({ dv: v2 });

    // The second watchdog arms. clearTimeout should have been called (cleanup of first).
    expect(clearTimeoutSpy).toHaveBeenCalled();
    // Only the latest watchdog is active.
    const repaintsBefore = map.triggerRepaint.mock.calls.length;

    // Fire idle → stamp→ only latest watchdog stops.
    map.__fireIdle();
    map.triggerRepaint.mockClear();
    advanceTime(2000);
    expect(onTelemetry).not.toHaveBeenCalled();
    // No more repaints after stamp.
    expect(map.triggerRepaint).not.toHaveBeenCalled();
    expect(repaintsBefore).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // 7. Cleanup: unmount removes listeners, cancels timer + rAF
  // -------------------------------------------------------------------------
  it('cleanup: unmount removes idle+sourcedata listeners and cancels pending timer/rAF', () => {
    const map = makeFakeMap();
    const mapRef = makeMapRef(map);

    const v0 = {};
    const { rerender, unmount } = renderHook(
      ({ dv }: { dv: unknown }) =>
        useMarkerConvergence(mapRef, true, dv, { now: fakeNow, budgetMs: 2000 }),
      { initialProps: { dv: v0 } },
    );

    // Bump dataVersion to arm the watchdog.
    const v1 = {};
    rerender({ dv: v1 });

    // Fire sourcedata to queue a rAF.
    map.__fireSourceData(observationsContent());
    expect(rafQueue).toHaveLength(1);

    // Now unmount — should clear pending timer, cancel pending rAF, remove listeners.
    unmount();

    // map.off should have been called for both idle and sourcedata.
    const offCalls = map.off.mock.calls;
    const offTypes = offCalls.map(c => c[0]);
    expect(offTypes).toContain('idle');
    expect(offTypes).toContain('sourcedata');

    // The rAF that was queued should be cancelled.
    expect(cancelledRafIds).toHaveLength(1);

    // After unmount, advancing time should not trigger any repaint or error.
    map.triggerRepaint.mockClear();
    advanceTime(5000);
    expect(map.triggerRepaint).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Extra: mapReady=false → no listeners, no watchdog
  // -------------------------------------------------------------------------
  it('does nothing when mapReady is false', () => {
    const map = makeFakeMap();
    const mapRef = makeMapRef(map);

    const v0 = {};
    const { rerender } = renderHook(
      ({ dv }: { dv: unknown }) =>
        useMarkerConvergence(mapRef, false, dv, { now: fakeNow }),
      { initialProps: { dv: v0 } },
    );

    expect(map.on).not.toHaveBeenCalled();
    expect(map.triggerRepaint).not.toHaveBeenCalled();

    // Bump version — still no-op because mapReady=false.
    rerender({ dv: {} });
    expect(map.triggerRepaint).not.toHaveBeenCalled();
  });
});

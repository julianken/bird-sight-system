import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Clarity from '@microsoft/clarity';

/**
 * Tests for the clarity module. Verifies the env-gating contract from
 * issue #657:
 *
 *   - `Clarity.init` is NEVER called when `VITE_CLARITY_PROJECT_ID` is
 *     unset/empty.
 *   - `Clarity.init` is NEVER called in non-production builds
 *     (`import.meta.env.PROD === false`).
 *   - `Clarity.init` IS called exactly once with the project ID when both
 *     conditions hold.
 *
 * The module is imported dynamically per-test so each test sees a freshly
 * evaluated module body — top-level `import.meta.env` reads happen at
 * module evaluation, so env stubs must be in place before the dynamic
 * import.
 */

vi.mock('@microsoft/clarity', () => ({
  default: { init: vi.fn(), event: vi.fn(), setTag: vi.fn() },
}));

/**
 * Resolve the `init` spy from the SAME mocked `@microsoft/clarity` specifier
 * that `clarity.ts` consumes, re-read *after* the per-test `vi.resetModules()`
 * + dynamic import have run.
 *
 * Why this indirection (issue #1105, the flake fix): `vi.resetModules()` in
 * `beforeEach` invalidates the module registry, including the mocked
 * `@microsoft/clarity`. Under `--sequence.shuffle` this race manifests — the
 * freshly-imported `clarity.ts` binds a *new* mock `init` instance (auto-mock
 * spies, or a re-run factory), distinct from any spy captured in the test-file
 * top scope at collection time. A test that asserted on a top-level
 * `const initMock = vi.fn()` therefore saw 0 calls while `clarity.ts` had in
 * fact called init on the live instance — instrumentation in the issue shows
 * the module calling an init whose identity differs from the captured spy.
 *
 * Reading the spy through `import('@microsoft/clarity')` here guarantees the
 * test asserts on the exact instance `clarity.ts` just called, regardless of
 * how `resetModules` re-wired the registry. Verified deterministic across 30×
 * shuffled runs (and the previously-failing fixed seeds 3 / 9).
 */
async function currentInitSpy(): Promise<ReturnType<typeof vi.fn>> {
  const mod = (await import('@microsoft/clarity')).default as typeof Clarity;
  return mod.init as unknown as ReturnType<typeof vi.fn>;
}

describe('clarity module', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does NOT call Clarity.init when VITE_CLARITY_PROJECT_ID is unset', async () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_CLARITY_PROJECT_ID', '');
    await import('./clarity.js');
    expect(await currentInitSpy()).not.toHaveBeenCalled();
  });

  it('does NOT call Clarity.init in non-production builds', async () => {
    vi.stubEnv('PROD', false);
    vi.stubEnv('VITE_CLARITY_PROJECT_ID', 'abc123xyz');
    await import('./clarity.js');
    expect(await currentInitSpy()).not.toHaveBeenCalled();
  });

  it('calls Clarity.init with the project ID in prod when key is set', async () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_CLARITY_PROJECT_ID', 'abc123xyz');
    await import('./clarity.js');
    const initSpy = await currentInitSpy();
    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(initSpy).toHaveBeenCalledWith('abc123xyz');
  });
});

describe('safeClarity guarded wrapper', () => {
  beforeEach(() => {
    vi.resetModules();
    // Ensure window.clarity is undefined to simulate pre-init / non-prod.
    delete (window as unknown as { clarity?: unknown }).clarity;
  });

  afterEach(() => {
    delete (window as unknown as { clarity?: unknown }).clarity;
  });

  it('safeClarity.event is a no-op when window.clarity is undefined', async () => {
    const { safeClarity } = await import('./clarity.js');
    expect(() => safeClarity.event('panel_opened')).not.toThrow();
  });

  it('safeClarity.setTag is a no-op when window.clarity is undefined', async () => {
    const { safeClarity } = await import('./clarity.js');
    expect(() => safeClarity.setTag('view', 'feed')).not.toThrow();
  });

  it('safeClarity.event forwards to Clarity.event when window.clarity is a function', async () => {
    (window as unknown as { clarity: () => void }).clarity = vi.fn();
    const eventSpy = vi.fn();
    vi.doMock('@microsoft/clarity', () => ({
      default: { init: vi.fn(), event: eventSpy, setTag: vi.fn() },
    }));
    const { safeClarity } = await import('./clarity.js');
    safeClarity.event('panel_opened');
    expect(eventSpy).toHaveBeenCalledWith('panel_opened');
  });

  it('safeClarity.setTag forwards to Clarity.setTag when window.clarity is a function', async () => {
    (window as unknown as { clarity: () => void }).clarity = vi.fn();
    const setTagSpy = vi.fn();
    vi.doMock('@microsoft/clarity', () => ({
      default: { init: vi.fn(), event: vi.fn(), setTag: setTagSpy },
    }));
    const { safeClarity } = await import('./clarity.js');
    safeClarity.setTag('view', 'feed');
    expect(setTagSpy).toHaveBeenCalledWith('view', 'feed');
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

const initMock = vi.fn();

vi.mock('@microsoft/clarity', () => ({
  default: { init: initMock, event: vi.fn(), setTag: vi.fn() },
}));

describe('clarity module', () => {
  beforeEach(() => {
    vi.resetModules();
    initMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does NOT call Clarity.init when VITE_CLARITY_PROJECT_ID is unset', async () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_CLARITY_PROJECT_ID', '');
    await import('./clarity.js');
    expect(initMock).not.toHaveBeenCalled();
  });

  it('does NOT call Clarity.init in non-production builds', async () => {
    vi.stubEnv('PROD', false);
    vi.stubEnv('VITE_CLARITY_PROJECT_ID', 'abc123xyz');
    await import('./clarity.js');
    expect(initMock).not.toHaveBeenCalled();
  });

  it('calls Clarity.init with the project ID in prod when key is set', async () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_CLARITY_PROJECT_ID', 'abc123xyz');
    await import('./clarity.js');
    expect(initMock).toHaveBeenCalledTimes(1);
    expect(initMock).toHaveBeenCalledWith('abc123xyz');
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

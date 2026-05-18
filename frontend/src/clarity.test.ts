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
  default: { init: initMock },
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

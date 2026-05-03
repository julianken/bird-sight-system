import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for the analytics module.  Verifies the empty-key guard semantics
 * documented in issue #357 task 2:
 *
 *   - `posthog.init` is NEVER called when `VITE_POSTHOG_KEY` is unset/empty.
 *     This is load-bearing for CI: posthog-js emits a console warning on an
 *     empty key, which would fail the existing console-cleanliness assertions
 *     in every e2e spec (species-detail.spec.ts, map-symbol-layer.spec.ts).
 *   - When the key is empty, `analytics.capture(...)` is a no-op stub.
 *   - When the key is present, `analytics.capture(...)` is the real posthog
 *     module's capture, and `posthog.init` was called once with the key and
 *     the privacy-respecting options (`autocapture: false`,
 *     `capture_pageview: false`, `respect_dnt: true`).
 *
 * The module is imported dynamically per-test so each test sees a freshly
 * evaluated module body — top-level `import.meta.env` reads happen at module
 * evaluation, so `vi.stubEnv` must be called before the dynamic import.
 */

const initMock = vi.fn();
const captureMock = vi.fn();

vi.mock('posthog-js', () => ({
  default: {
    init: initMock,
    capture: captureMock,
  },
}));

describe('analytics module', () => {
  beforeEach(() => {
    vi.resetModules();
    initMock.mockReset();
    captureMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does NOT call posthog.init when VITE_POSTHOG_KEY is unset', async () => {
    // Default: env var unset / empty.  This mirrors CI + local dev.
    vi.stubEnv('VITE_POSTHOG_KEY', '');
    await import('./analytics.js');
    expect(initMock).not.toHaveBeenCalled();
  });

  it('exports a capture-stub no-op when VITE_POSTHOG_KEY is unset', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', '');
    const { analytics } = await import('./analytics.js');
    // Must not throw, must not delegate to posthog.capture.
    expect(() => analytics.capture('panel_opened', { species_code: 'x' })).not.toThrow();
    expect(captureMock).not.toHaveBeenCalled();
  });

  it('calls posthog.init with privacy-respecting options when key is present', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test_key');
    await import('./analytics.js');
    expect(initMock).toHaveBeenCalledTimes(1);
    expect(initMock).toHaveBeenCalledWith('phc_test_key', {
      api_host: 'https://us.i.posthog.com',
      autocapture: false,
      capture_pageview: false,
      respect_dnt: true,
    });
  });

  it('exports posthog as analytics when key is present', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test_key');
    const { analytics } = await import('./analytics.js');
    analytics.capture('panel_opened', { species_code: 'x' });
    expect(captureMock).toHaveBeenCalledWith('panel_opened', { species_code: 'x' });
  });
});

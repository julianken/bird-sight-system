import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for the Clarity-backed analytics module (PR #659 follow-up).
 *
 * The PostHog→Clarity migration kept the public `analytics.capture()` API
 * unchanged (4 existing call sites stay verbatim — see analytics.ts
 * docstring) but swapped the underlying transport.
 *
 *   - `capture(name)` → calls `safeClarity.event(name)`. No `setTag` calls.
 *   - `capture(name, props)` → calls `safeClarity.event(name)` AND
 *     `safeClarity.setTag(key, String(value))` for every prop key/value
 *     pair. This preserves the event-with-dimensions intent of the old
 *     PostHog payload shape under Clarity's split API.
 *   - `setView(view)` → calls `safeClarity.setTag('view', view)`. The
 *     'view' dimension lets dashboards filter Clarity sessions by surface
 *     (feed | map | species | detail).
 *
 * The runtime guard (window.clarity must be a function before any SDK
 * method fires) lives in `safeClarity` itself — these tests mock the
 * `./clarity.js` module directly, so the guard branch is not exercised
 * here; it has dedicated coverage in `clarity.test.ts`.
 *
 * Module is imported dynamically per-test so each test starts from a fresh
 * module evaluation.
 */

const eventMock = vi.fn();
const setTagMock = vi.fn();

vi.mock('./clarity.js', () => ({
  safeClarity: { event: eventMock, setTag: setTagMock },
}));

describe('analytics module', () => {
  beforeEach(() => {
    vi.resetModules();
    eventMock.mockReset();
    setTagMock.mockReset();
  });

  it('capture(name) calls safeClarity.event with the name', async () => {
    const { analytics } = await import('./analytics.js');
    analytics.capture('panel_opened');
    expect(eventMock).toHaveBeenCalledWith('panel_opened');
    expect(setTagMock).not.toHaveBeenCalled();
  });

  it('capture(name, props) calls safeClarity.event then setTag for each prop', async () => {
    const { analytics } = await import('./analytics.js');
    analytics.capture('panel_opened', { species_code: 'haxwo', source: 'feed' });
    expect(eventMock).toHaveBeenCalledWith('panel_opened');
    expect(setTagMock).toHaveBeenCalledWith('species_code', 'haxwo');
    expect(setTagMock).toHaveBeenCalledWith('source', 'feed');
  });

  it('setView(view) calls safeClarity.setTag with key "view"', async () => {
    const { analytics } = await import('./analytics.js');
    analytics.setView('species');
    expect(setTagMock).toHaveBeenCalledWith('view', 'species');
  });
});

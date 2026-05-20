import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for the Clarity-backed analytics module (PR #659 follow-up).
 *
 * The PostHog→Clarity migration kept the public `analytics.capture()` API
 * unchanged (4 existing call sites stay verbatim — see analytics.ts
 * docstring) but swapped the underlying transport.
 *
 *   - `capture(name)` → calls `Clarity.event(name)`. No `setTag` calls.
 *   - `capture(name, props)` → calls `Clarity.event(name)` AND
 *     `Clarity.setTag(key, String(value))` for every prop key/value pair.
 *     This preserves the event-with-dimensions intent of the old PostHog
 *     payload shape under Clarity's split API.
 *   - `setView(view)` → calls `Clarity.setTag('view', view)`. The 'view'
 *     dimension lets dashboards filter Clarity sessions by surface
 *     (feed | map | species | detail).
 *
 * The wrapper guards on `window.clarity` being a function — Clarity's
 * injected script wires that during `init`, and direct calls to
 * `Clarity.event/setTag` throw `TypeError: window.clarity is not a function`
 * before init runs. The guard makes the module safe to call from any test
 * (call sites in SpeciesDetailSurface.test, e2e specs) without leaking that
 * SDK internal. These tests stub `window.clarity` so the guard passes and
 * the mocked `Clarity` methods are observed.
 *
 * Module is imported dynamically per-test so each test starts from a fresh
 * module evaluation.
 */

const eventMock = vi.fn();
const setTagMock = vi.fn();

vi.mock('@microsoft/clarity', () => ({
  default: { event: eventMock, setTag: setTagMock, init: vi.fn() },
}));

describe('analytics module', () => {
  beforeEach(() => {
    vi.resetModules();
    eventMock.mockReset();
    setTagMock.mockReset();
    (window as unknown as { clarity: (...args: unknown[]) => void }).clarity =
      () => {};
  });

  afterEach(() => {
    delete (window as unknown as { clarity?: unknown }).clarity;
  });

  it('capture(name) calls Clarity.event with the name', async () => {
    const { analytics } = await import('./analytics.js');
    analytics.capture('panel_opened');
    expect(eventMock).toHaveBeenCalledWith('panel_opened');
    expect(setTagMock).not.toHaveBeenCalled();
  });

  it('capture(name, props) calls Clarity.event then setTag for each prop', async () => {
    const { analytics } = await import('./analytics.js');
    analytics.capture('panel_opened', { species_code: 'haxwo', source: 'feed' });
    expect(eventMock).toHaveBeenCalledWith('panel_opened');
    expect(setTagMock).toHaveBeenCalledWith('species_code', 'haxwo');
    expect(setTagMock).toHaveBeenCalledWith('source', 'feed');
  });

  it('setView(view) calls Clarity.setTag with key "view"', async () => {
    const { analytics } = await import('./analytics.js');
    analytics.setView('species');
    expect(setTagMock).toHaveBeenCalledWith('view', 'species');
  });

  it('capture is a no-op when window.clarity has not been wired', async () => {
    delete (window as unknown as { clarity?: unknown }).clarity;
    const { analytics } = await import('./analytics.js');
    expect(() => analytics.capture('panel_opened', { x: 1 })).not.toThrow();
    expect(eventMock).not.toHaveBeenCalled();
    expect(setTagMock).not.toHaveBeenCalled();
  });

  it('setView is a no-op when window.clarity has not been wired', async () => {
    delete (window as unknown as { clarity?: unknown }).clarity;
    const { analytics } = await import('./analytics.js');
    expect(() => analytics.setView('map')).not.toThrow();
    expect(setTagMock).not.toHaveBeenCalled();
  });
});

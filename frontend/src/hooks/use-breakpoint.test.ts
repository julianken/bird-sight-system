import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBreakpoint } from './use-breakpoint.js';
import { setMatchMedia, getMockMediaQuery } from '../test-setup.js';

/**
 * useBreakpoint maps two `window.matchMedia` queries onto three named tiers:
 *
 *   (max-width: 479px)  matches  → 'compact'
 *   (max-width: 1023px) matches  → 'roomy'   (and compact did NOT match)
 *   neither matches              → 'wide'
 *
 * The token pixel values are BP_COMPACT=480 / BP_WIDE=1024, so the queries
 * are `${480 - 1}` and `${1024 - 1}` px. test-setup mocks `matchMedia` and
 * lets a test flip `matches` via `dispatchChange` to simulate a resize without
 * a real layout engine (mirrors use-media-query.test.ts).
 */

const Q_COMPACT = '(max-width: 479px)';
const Q_ROOMY = '(max-width: 1023px)';

/** Build a matcher for a given viewport width against the two breakpoint queries. */
function matcherForWidth(width: number) {
  return (query: string): boolean => {
    if (query === Q_COMPACT) return width <= 479;
    if (query === Q_ROOMY) return width <= 1023;
    return false;
  };
}

describe('useBreakpoint', () => {
  it("returns 'compact' below 480px (both queries match)", () => {
    setMatchMedia(matcherForWidth(390));
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe('compact');
  });

  it("returns 'roomy' between 480px and 1023px (only the wide query matches)", () => {
    setMatchMedia(matcherForWidth(768));
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe('roomy');
  });

  it("returns 'wide' at 1024px and up (neither query matches)", () => {
    setMatchMedia(matcherForWidth(1440));
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe('wide');
  });

  it("treats the 480px boundary as 'roomy' (compact is < 480, not ≤)", () => {
    setMatchMedia(matcherForWidth(480));
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe('roomy');
  });

  it("treats the 1024px boundary as 'wide' (roomy is < 1024, not ≤)", () => {
    setMatchMedia(matcherForWidth(1024));
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe('wide');
  });

  it("re-evaluates compact → roomy when the compact query transitions to false", () => {
    setMatchMedia(matcherForWidth(390));
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe('compact');

    // Simulate resizing past 480px. The hook's onchange handler re-reads via
    // readBreakpoint(), which re-queries window.matchMedia — so we must move the
    // installed matcher to the new viewport before firing the change event
    // (re-querying with a stale matcher would overwrite our manual .matches).
    act(() => {
      setMatchMedia(matcherForWidth(768));
      getMockMediaQuery(Q_COMPACT)!.dispatchChange(false);
    });

    expect(result.current).toBe('roomy');
  });

  it("re-evaluates roomy → wide when the roomy query transitions to false", () => {
    setMatchMedia(matcherForWidth(768));
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe('roomy');

    act(() => {
      setMatchMedia(matcherForWidth(1440));
      getMockMediaQuery(Q_ROOMY)!.dispatchChange(false);
    });

    expect(result.current).toBe('wide');
  });

  it("falls back to 'wide' when window.matchMedia is unavailable", () => {
    // Defensive SSR / jsdom-without-matchMedia path: the hook must not crash
    // and should report the desktop fallback.
    // @ts-expect-error — deliberately removing the stub for this test.
    delete window.matchMedia;
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe('wide');
  });

  it('removes its resize listeners on unmount without throwing', () => {
    setMatchMedia(matcherForWidth(390));
    const { result, unmount } = renderHook(() => useBreakpoint());
    expect(result.current).toBe('compact');
    unmount();
    // Dispatching a change after unmount must not throw or update state.
    expect(() => {
      getMockMediaQuery(Q_ROOMY)!.dispatchChange(false);
    }).not.toThrow();
  });
});

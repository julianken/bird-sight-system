import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsPhone } from './use-is-phone.js';

/**
 * O5 (#783) — useIsPhone unit tests.
 *
 * Validates:
 *   - Queries the ≤480px overlay breakpoint (P1 token pin)
 *   - Returns true at ≤480px, false at 481px+
 *   - SSR-safe (returns false when window/matchMedia absent)
 *   - Guards against over-trigger at tablet (1024px) and compact (1199px)
 */

describe('useIsPhone', () => {
  let listeners: Array<(e: MediaQueryListEvent) => void>;
  let mql: MediaQueryList;
  let capturedQuery: string | null;

  beforeEach(() => {
    listeners = [];
    capturedQuery = null;
    mql = {
      matches: false,
      media: '(max-width: 480px)',
      onchange: null,
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        if (type === 'change') listeners.push(listener as (e: MediaQueryListEvent) => void);
      }),
      removeEventListener: vi.fn((type: string, listener: EventListener) => {
        const idx = listeners.indexOf(listener as (e: MediaQueryListEvent) => void);
        if (idx >= 0) listeners.splice(idx, 1);
      }),
      dispatchEvent: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    } as unknown as MediaQueryList;
    window.matchMedia = vi.fn((q: string) => {
      capturedQuery = q;
      return mql;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('queries the 480px overlay breakpoint (P1 pin, O5 #783)', () => {
    renderHook(() => useIsPhone());
    expect(capturedQuery).toBe('(max-width: 480px)');
  });

  it('does NOT query the 1199px compact breakpoint (no over-trigger on tablet/laptop)', () => {
    renderHook(() => useIsPhone());
    expect(capturedQuery).not.toBe('(max-width: 1199px)');
  });

  it('returns true when matchMedia.matches is true (≤480px)', () => {
    (mql as { matches: boolean }).matches = true;
    const { result } = renderHook(() => useIsPhone());
    expect(result.current).toBe(true);
  });

  it('returns false when matchMedia.matches is false (≥481px)', () => {
    (mql as { matches: boolean }).matches = false;
    const { result } = renderHook(() => useIsPhone());
    expect(result.current).toBe(false);
  });

  it('updates to true when media query fires (viewport shrinks to ≤480px)', () => {
    (mql as { matches: boolean }).matches = false;
    const { result } = renderHook(() => useIsPhone());
    expect(result.current).toBe(false);

    act(() => {
      (mql as { matches: boolean }).matches = true;
      listeners.forEach(l => l({ matches: true } as MediaQueryListEvent));
    });
    expect(result.current).toBe(true);
  });

  it('updates to false when media query fires (viewport grows to ≥481px)', () => {
    (mql as { matches: boolean }).matches = true;
    const { result } = renderHook(() => useIsPhone());
    expect(result.current).toBe(true);

    act(() => {
      (mql as { matches: boolean }).matches = false;
      listeners.forEach(l => l({ matches: false } as MediaQueryListEvent));
    });
    expect(result.current).toBe(false);
  });

  it('removes the listener on unmount (no memory leak)', () => {
    const { unmount } = renderHook(() => useIsPhone());
    expect(mql.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    unmount();
    expect(mql.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('SSR-safe: returns false when window.matchMedia is undefined', () => {
    const originalMatchMedia = window.matchMedia;
    // Simulate SSR environment where matchMedia is absent
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).matchMedia = undefined;
    try {
      const { result } = renderHook(() => useIsPhone());
      expect(result.current).toBe(false);
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it('guards against over-trigger at 1024px (iPad landscape should NOT be phone)', () => {
    // Simulate a 1024px viewport: matchMedia(≤480px) returns false
    (mql as { matches: boolean }).matches = false;
    const { result } = renderHook(() => useIsPhone());
    // At 1024px the hook must return false — legend must NOT force-collapse on iPad
    expect(result.current).toBe(false);
  });
});

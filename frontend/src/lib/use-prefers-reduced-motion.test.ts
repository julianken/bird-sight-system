import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePrefersReducedMotion } from './use-prefers-reduced-motion.js';

/**
 * usePrefersReducedMotion is a LIVE sensor (#1063): it seeds from matchMedia on
 * mount and subscribes to the `change` event so flipping OS reduce-motion
 * mid-session updates the value without a reload (mirrors use-coarse-pointer).
 * The spec asserts seed-once, SSR-`false` fallback, change-event update, AND
 * unmount removal. (Before #1063 this was a deliberate mount-once `useMemo` with
 * NO listener; that contract was retired so CSS and MapLibre camera flights
 * agree on the live preference for vestibular-sensitive users.)
 */
describe('usePrefersReducedMotion', () => {
  let listeners: Array<(e: MediaQueryListEvent) => void>;
  let mql: MediaQueryList;
  let capturedQuery: string | null;

  beforeEach(() => {
    listeners = [];
    capturedQuery = null;
    mql = {
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
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

  it('queries the (prefers-reduced-motion: reduce) media feature', () => {
    renderHook(() => usePrefersReducedMotion());
    expect(capturedQuery).toBe('(prefers-reduced-motion: reduce)');
  });

  it('returns matchMedia.matches as the initial value', () => {
    (mql as { matches: boolean }).matches = true;
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
  });

  it('returns false when the media feature does not match', () => {
    (mql as { matches: boolean }).matches = false;
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });

  it('updates when the media query changes (live OS reduce-motion toggle)', () => {
    (mql as { matches: boolean }).matches = false;
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);

    act(() => {
      (mql as { matches: boolean }).matches = true;
      listeners.forEach(l => l({ matches: true } as MediaQueryListEvent));
    });
    expect(result.current).toBe(true);
  });

  it('removes the change listener on unmount', () => {
    const { unmount } = renderHook(() => usePrefersReducedMotion());
    expect(mql.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    unmount();
    expect(mql.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('returns false in an SSR context (no window.matchMedia)', () => {
    const original = window.matchMedia;
    // @ts-expect-error — simulate the SSR / no-matchMedia path.
    delete window.matchMedia;
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
    window.matchMedia = original;
  });
});

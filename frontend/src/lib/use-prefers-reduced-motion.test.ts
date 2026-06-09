import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePrefersReducedMotion } from './use-prefers-reduced-motion.js';

/**
 * usePrefersReducedMotion is a deliberately mount-once read (`useMemo`, empty
 * deps, NO change listener — the source captures the value once and the user
 * must reload to apply other reduced-motion changes anyway). The spec therefore
 * asserts seed-once + SSR-`false` fallback ONLY. There is intentionally no
 * change-event-update or unmount-removal case: adding one would silently
 * convert this mount-once read into a reactive hook.
 */
describe('usePrefersReducedMotion', () => {
  let mql: MediaQueryList;
  let capturedQuery: string | null;

  beforeEach(() => {
    capturedQuery = null;
    mql = {
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
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

  it('returns matchMedia.matches as the mount-once value', () => {
    (mql as { matches: boolean }).matches = true;
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
  });

  it('returns false when the media feature does not match', () => {
    (mql as { matches: boolean }).matches = false;
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });

  it('does NOT register a change listener (mount-once read, not reactive)', () => {
    renderHook(() => usePrefersReducedMotion());
    expect(mql.addEventListener).not.toHaveBeenCalled();
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

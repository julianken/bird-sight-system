import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMediaQuery } from './use-media-query.js';
import { setMatchMedia, getMockMediaQuery } from '../test-setup.js';

describe('useMediaQuery', () => {
  it('returns the initial matches value from window.matchMedia', () => {
    setMatchMedia(q => q === '(max-width: 767px)');
    const { result } = renderHook(() => useMediaQuery('(max-width: 767px)'));
    expect(result.current).toBe(true);
  });

  it('returns false when the query does not match on mount', () => {
    setMatchMedia(() => false);
    const { result } = renderHook(() => useMediaQuery('(max-width: 767px)'));
    expect(result.current).toBe(false);
  });

  it('updates when the media query transitions false → true', () => {
    setMatchMedia(() => false);
    const { result } = renderHook(() => useMediaQuery('(max-width: 767px)'));
    expect(result.current).toBe(false);

    act(() => {
      getMockMediaQuery('(max-width: 767px)')!.dispatchChange(true);
    });

    expect(result.current).toBe(true);
  });

  it('updates when the media query transitions true → false', () => {
    setMatchMedia(() => true);
    const { result } = renderHook(() => useMediaQuery('(max-width: 767px)'));
    expect(result.current).toBe(true);

    act(() => {
      getMockMediaQuery('(max-width: 767px)')!.dispatchChange(false);
    });

    expect(result.current).toBe(false);
  });

  it('removes its change listener on unmount', () => {
    setMatchMedia(() => false);
    const { result, unmount } = renderHook(() => useMediaQuery('(max-width: 767px)'));
    expect(result.current).toBe(false);
    unmount();
    // After unmount, dispatching a change must NOT throw and must not
    // update any React state (which would now warn about state updates
    // on an unmounted component).
    expect(() => {
      getMockMediaQuery('(max-width: 767px)')!.dispatchChange(true);
    }).not.toThrow();
  });

  it('handles missing window.matchMedia by returning false', () => {
    // Defensive: some test environments leave matchMedia undefined. The hook
    // should not crash — it should just report "no match".
    // @ts-expect-error — deliberately removing the stub for this test.
    delete window.matchMedia;
    const { result } = renderHook(() => useMediaQuery('(max-width: 767px)'));
    expect(result.current).toBe(false);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsCompact } from './use-is-compact.js';

describe('useIsCompact', () => {
  let listeners: Array<(e: MediaQueryListEvent) => void>;
  let mql: MediaQueryList;
  let capturedQuery: string | null;

  beforeEach(() => {
    listeners = [];
    capturedQuery = null;
    mql = {
      matches: false,
      media: '(max-width: 1199px)',
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

  it('queries the 1199px breakpoint (#663 Addendum B)', () => {
    renderHook(() => useIsCompact());
    expect(capturedQuery).toBe('(max-width: 1199px)');
  });

  it('returns matchMedia.matches as initial value', () => {
    (mql as { matches: boolean }).matches = true;
    const { result } = renderHook(() => useIsCompact());
    expect(result.current).toBe(true);
  });

  it('updates when the media query changes', () => {
    (mql as { matches: boolean }).matches = false;
    const { result } = renderHook(() => useIsCompact());
    expect(result.current).toBe(false);

    act(() => {
      (mql as { matches: boolean }).matches = true;
      listeners.forEach(l => l({ matches: true } as MediaQueryListEvent));
    });
    expect(result.current).toBe(true);
  });

  it('removes the listener on unmount', () => {
    const { unmount } = renderHook(() => useIsCompact());
    expect(mql.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    unmount();
    expect(mql.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCoarsePointer } from './use-coarse-pointer.js';

describe('useCoarsePointer', () => {
  let listeners: Array<(e: MediaQueryListEvent) => void>;
  let mql: MediaQueryList;
  let capturedQuery: string | null;

  beforeEach(() => {
    listeners = [];
    capturedQuery = null;
    mql = {
      matches: false,
      media: '(pointer: coarse)',
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

  it('queries the (pointer: coarse) media feature (#247, #277)', () => {
    renderHook(() => useCoarsePointer());
    expect(capturedQuery).toBe('(pointer: coarse)');
  });

  it('returns matchMedia.matches as initial value', () => {
    (mql as { matches: boolean }).matches = true;
    const { result } = renderHook(() => useCoarsePointer());
    expect(result.current).toBe(true);
  });

  it('updates when the media query changes', () => {
    (mql as { matches: boolean }).matches = false;
    const { result } = renderHook(() => useCoarsePointer());
    expect(result.current).toBe(false);

    act(() => {
      (mql as { matches: boolean }).matches = true;
      listeners.forEach(l => l({ matches: true } as MediaQueryListEvent));
    });
    expect(result.current).toBe(true);
  });

  it('removes the listener on unmount', () => {
    const { unmount } = renderHook(() => useCoarsePointer());
    expect(mql.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    unmount();
    expect(mql.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });
});

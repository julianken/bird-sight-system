import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScrollRestore } from './use-scroll-restore.js';

/**
 * jsdom does not implement scrolling, so we stub window.scrollTo + a
 * mutable `window.scrollY` per test. The point of the hook is simple:
 *
 *   - active: false -> true: capture current scrollY.
 *   - active: true -> false: restore to captured scrollY by calling
 *     window.scrollTo(0, captured) — UNLESS the user has scrolled
 *     materially since capture (>2px delta), in which case preserve
 *     their new position (call nothing).
 *
 * The 2px tolerance is the issue #115 acceptance threshold.
 */

let scrollToCalls: Array<[number, number]> = [];
const originalScrollTo = window.scrollTo;
const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'scrollY');

function setScrollY(value: number) {
  Object.defineProperty(window, 'scrollY', {
    configurable: true,
    get: () => value,
  });
}

beforeEach(() => {
  scrollToCalls = [];
  (window.scrollTo as unknown) = (x: number, y: number) => {
    scrollToCalls.push([x, y]);
    setScrollY(y);
  };
  setScrollY(0);
});

afterEach(() => {
  window.scrollTo = originalScrollTo;
  if (originalDescriptor) {
    Object.defineProperty(window, 'scrollY', originalDescriptor);
  }
});

describe('useScrollRestore', () => {
  it('does not capture on mount when active=false', () => {
    setScrollY(500);
    const { rerender } = renderHook(({ active }) => useScrollRestore(active), {
      initialProps: { active: false },
    });
    // Simulate user scrolling while closed.
    setScrollY(250);
    // Transition stays false — nothing should capture.
    rerender({ active: false });
    // Close → close is a no-op.
    expect(scrollToCalls).toEqual([]);
  });

  it('captures scrollY on false → true and restores on true → false', () => {
    setScrollY(500);
    const { rerender } = renderHook(({ active }) => useScrollRestore(active), {
      initialProps: { active: false },
    });

    // Open the panel. Hook captures 500.
    act(() => {
      rerender({ active: true });
    });

    // No scroll adjustment on open — just capture.
    expect(scrollToCalls).toEqual([]);

    // Close the panel without user scrolling. Hook restores to 500.
    act(() => {
      rerender({ active: false });
    });
    expect(scrollToCalls).toEqual([[0, 500]]);
  });

  it('preserves user position when user scrolled materially while active', () => {
    setScrollY(500);
    const { rerender } = renderHook(({ active }) => useScrollRestore(active), {
      initialProps: { active: false },
    });

    // Open — capture 500.
    act(() => {
      rerender({ active: true });
    });

    // User scrolls to 1200 while panel is open.
    setScrollY(1200);

    // Close — 1200 differs from 500 by > 2px, so preserve user position.
    act(() => {
      rerender({ active: false });
    });
    // scrollTo must NOT have been called.
    expect(scrollToCalls).toEqual([]);
  });

  it('restores when user position drift is within the 2px tolerance', () => {
    setScrollY(500);
    const { rerender } = renderHook(({ active }) => useScrollRestore(active), {
      initialProps: { active: false },
    });

    act(() => {
      rerender({ active: true });
    });

    // Tiny sub-pixel drift — browser rounding, not a real scroll.
    setScrollY(501);

    act(() => {
      rerender({ active: false });
    });
    // 501 - 500 = 1 ≤ 2, so restoration still happens.
    expect(scrollToCalls).toEqual([[0, 500]]);
  });

  it('handles deep-link case where active starts true with scrollY=0', () => {
    // Deep-link scenario: ?species=vermfly on cold load. scrollY=0 at mount
    // because nothing has scrolled yet. Hook mounts with active=true.
    // This isn't a false→true transition so nothing is captured; when the
    // panel closes there's nothing to restore to and it's a no-op.
    setScrollY(0);
    const { rerender } = renderHook(({ active }) => useScrollRestore(active), {
      initialProps: { active: true },
    });

    // User scrolls a bit.
    setScrollY(300);

    // Close. Nothing was captured, so scrollTo is not called.
    act(() => {
      rerender({ active: false });
    });
    expect(scrollToCalls).toEqual([]);
  });

  it('supports multiple open/close cycles with fresh captures', () => {
    setScrollY(100);
    const { rerender } = renderHook(({ active }) => useScrollRestore(active), {
      initialProps: { active: false },
    });

    // Cycle 1: capture 100, close, restore 100.
    act(() => { rerender({ active: true }); });
    act(() => { rerender({ active: false }); });
    expect(scrollToCalls).toEqual([[0, 100]]);

    // User navigates to y=800.
    setScrollY(800);

    // Cycle 2: capture 800, close without scrolling, restore 800.
    act(() => { rerender({ active: true }); });
    act(() => { rerender({ active: false }); });
    expect(scrollToCalls).toEqual([[0, 100], [0, 800]]);
  });
});

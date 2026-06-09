import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTheme } from './use-theme.js';

/**
 * useTheme reads `document.documentElement`'s `[data-theme]` attribute and
 * re-renders on changes via a real `MutationObserver`. The repo's test-setup
 * mocks `window.matchMedia` but NOT `MutationObserver` — jsdom ships a working
 * observer that fires its callback on `setAttribute`, so these tests drive the
 * attribute directly and wait one microtask-ish tick for the observer + React
 * re-render (mirrors AdaptiveGridMarker.test.tsx / MapCanvas.test.tsx).
 */

const originalTheme = document.documentElement.getAttribute('data-theme');

afterEach(() => {
  // Restore the <html> attribute so theme state never leaks between tests.
  if (originalTheme === null) {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', originalTheme);
  }
});

// Let a queued MutationObserver callback flush, then React re-render.
const flushObserver = () => new Promise(r => setTimeout(r, 50));

describe('useTheme', () => {
  it("returns 'dark' when [data-theme] is 'dark' on mount", () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const { result } = renderHook(() => useTheme());
    expect(result.current).toBe('dark');
  });

  it("returns 'light' when [data-theme] is 'light' on mount", () => {
    document.documentElement.setAttribute('data-theme', 'light');
    const { result } = renderHook(() => useTheme());
    expect(result.current).toBe('light');
  });

  it("treats a missing [data-theme] attribute as 'light'", () => {
    document.documentElement.removeAttribute('data-theme');
    const { result } = renderHook(() => useTheme());
    expect(result.current).toBe('light');
  });

  it("treats any non-'dark' value as 'light' (e.g. 'sepia')", () => {
    document.documentElement.setAttribute('data-theme', 'sepia');
    const { result } = renderHook(() => useTheme());
    expect(result.current).toBe('light');
  });

  it('reacts to a light → dark attribute mutation', async () => {
    document.documentElement.setAttribute('data-theme', 'light');
    const { result } = renderHook(() => useTheme());
    expect(result.current).toBe('light');

    await act(async () => {
      document.documentElement.setAttribute('data-theme', 'dark');
      await flushObserver();
    });

    expect(result.current).toBe('dark');
  });

  it('reacts to a dark → light attribute mutation', async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const { result } = renderHook(() => useTheme());
    expect(result.current).toBe('dark');

    await act(async () => {
      document.documentElement.setAttribute('data-theme', 'light');
      await flushObserver();
    });

    expect(result.current).toBe('light');
  });

  it('stops reacting after unmount (observer disconnected)', async () => {
    document.documentElement.setAttribute('data-theme', 'light');
    const { result, unmount } = renderHook(() => useTheme());
    expect(result.current).toBe('light');

    unmount();

    // After unmount the observer is disconnected: flipping the attribute must
    // neither throw nor warn about a state update on an unmounted component.
    await act(async () => {
      document.documentElement.setAttribute('data-theme', 'dark');
      await flushObserver();
    });

    // The last value renderHook captured stays 'light' — no post-unmount update.
    expect(result.current).toBe('light');
  });
});

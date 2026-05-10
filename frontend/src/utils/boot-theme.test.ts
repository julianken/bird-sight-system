import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveInitialTheme, applyInitialTheme } from './boot-theme.js';
import { setMatchMedia, resetMatchMedia } from '../test-setup.js';

/**
 * Tests for the theme-boot resolution logic. Mirrors what the inline
 * blocking script in index.html does — any change to the rules must be
 * applied in both places.
 *
 * The SecurityError tests guard the Safari Private Browsing / sandboxed-
 * iframe failure mode where localStorage.getItem throws synchronously.
 * Without try/catch the inline script would abort, leaving [data-theme]
 * unset and producing a FOUC flash.
 */

describe('resolveInitialTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    resetMatchMedia();
    vi.restoreAllMocks();
  });

  it('returns the stored value when localStorage has "light"', () => {
    localStorage.setItem('theme', 'light');
    expect(resolveInitialTheme()).toBe('light');
  });

  it('returns the stored value when localStorage has "dark"', () => {
    localStorage.setItem('theme', 'dark');
    expect(resolveInitialTheme()).toBe('dark');
  });

  it('falls back to prefers-color-scheme when localStorage is empty', () => {
    setMatchMedia((q) => q === '(prefers-color-scheme: dark)');
    expect(resolveInitialTheme()).toBe('dark');
  });

  it('returns "light" when localStorage is empty and OS prefers light', () => {
    setMatchMedia(() => false);
    expect(resolveInitialTheme()).toBe('light');
  });

  it('does not crash and falls through to OS preference when localStorage.getItem throws SecurityError', () => {
    // Simulate Safari Private Browsing / sandboxed-iframe failure mode.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError');
    });
    setMatchMedia((q) => q === '(prefers-color-scheme: dark)');

    expect(() => resolveInitialTheme()).not.toThrow();
    expect(resolveInitialTheme()).toBe('dark');
  });

  it('returns "light" as last resort when both localStorage and matchMedia throw', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError');
    });
    // Install a matchMedia that throws synchronously on every call.
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error('matchMedia unavailable');
      },
    });

    expect(() => resolveInitialTheme()).not.toThrow();
    expect(resolveInitialTheme()).toBe('light');
  });
});

describe('applyInitialTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    vi.restoreAllMocks();
  });

  it('sets [data-theme] on documentElement to the resolved value', () => {
    localStorage.setItem('theme', 'dark');
    applyInitialTheme();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('still sets [data-theme] when localStorage throws — no FOUC', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError');
    });

    expect(() => applyInitialTheme()).not.toThrow();
    // The attribute MUST be set so first-paint CSS resolves correctly,
    // even when persistence is unavailable.
    const attr = document.documentElement.getAttribute('data-theme');
    expect(attr === 'light' || attr === 'dark').toBe(true);
  });
});

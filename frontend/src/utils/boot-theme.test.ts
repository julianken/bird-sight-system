import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolveInitialTheme,
  applyInitialTheme,
  applyTheme,
  ID_TO_KIND,
  THEME_STORAGE_KEY,
} from './boot-theme.js';
import { THEME_REGISTRY } from '@/components/map/geometry/basemap-style.js';
import { setMatchMedia, resetMatchMedia } from '../test-setup.js';

/**
 * Tests for the theme-boot resolution + the single `applyTheme` write path
 * (C7 · #1219). The active THEME ID is the source of truth; `[data-theme]` is
 * DERIVED from the id's kind. These tests mirror what the inline blocking
 * script in index.html does — any change to the rules must be applied in both
 * places, and the import-both-and-assert-equal test below pins the duplicated
 * id→kind map so it can never drift.
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

  it('returns the persisted id verbatim when localStorage has a known ThemeId ("positron")', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'positron');
    expect(resolveInitialTheme()).toBe('positron');
  });

  it('returns the persisted id verbatim when localStorage has "dark"', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(resolveInitialTheme()).toBe('dark');
  });

  it('returns the persisted id verbatim for a non-default registered id ("bright")', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'bright');
    expect(resolveInitialTheme()).toBe('bright');
  });

  it('back-compat: legacy persisted "light" maps to the "bright" id (C8 #1220 default flip)', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    expect(resolveInitialTheme()).toBe('bright');
  });

  it('back-compat: legacy persisted "dark" maps to the "dark" id', () => {
    // 'dark' is both a legacy chrome value AND a registered id; either path
    // resolves to the dark id.
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(resolveInitialTheme()).toBe('dark');
  });

  it('ignores an unknown persisted value and falls through to OS preference', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    setMatchMedia((q) => q === '(prefers-color-scheme: dark)');
    expect(resolveInitialTheme()).toBe('dark');
  });

  it('falls back to the "dark" id when localStorage is empty and OS prefers dark', () => {
    setMatchMedia((q) => q === '(prefers-color-scheme: dark)');
    expect(resolveInitialTheme()).toBe('dark');
  });

  it('returns "bright" (the C8 light default) when localStorage is empty and OS prefers light', () => {
    setMatchMedia(() => false);
    expect(resolveInitialTheme()).toBe('bright');
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

  it('returns "bright" as last resort when both localStorage and matchMedia throw (C8 default)', () => {
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
    expect(resolveInitialTheme()).toBe('bright');
  });
});

describe('applyTheme (single write path)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    vi.restoreAllMocks();
  });

  it('sets [data-theme] to the descriptor kind and persists the ID (positron → light)', () => {
    const descriptor = applyTheme('positron');
    expect(descriptor.id).toBe('positron');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('positron');
  });

  it('sets [data-theme] to the descriptor kind and persists the ID (dark → dark)', () => {
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('a light-KIND non-positron id derives [data-theme]=light but persists its OWN id (bright)', () => {
    // The chrome attribute diverges from the id here — the C7 contract.
    applyTheme('bright');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('bright');
  });

  it('a dark-KIND non-dark id derives [data-theme]=dark but persists its OWN id (fiord)', () => {
    applyTheme('fiord');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('fiord');
  });

  it('still writes [data-theme] when localStorage.setItem throws — no crash, persistence forfeit', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError');
    });
    expect(() => applyTheme('dark')).not.toThrow();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
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
    resetMatchMedia();
    vi.restoreAllMocks();
  });

  it('sets [data-theme] on documentElement to the resolved id\'s kind', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(applyInitialTheme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('legacy persisted "light" resolves to bright and writes [data-theme]=light (C8 #1220)', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    // bright is light-kind, so [data-theme] stays 'light' — only the resolved id
    // (and therefore the basemap) changes from the old positron default.
    expect(applyInitialTheme()).toBe('bright');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('still sets [data-theme] when localStorage throws — no FOUC', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError');
    });
    setMatchMedia(() => false);

    expect(() => applyInitialTheme()).not.toThrow();
    // The attribute MUST be set so first-paint CSS resolves correctly,
    // even when persistence is unavailable.
    const attr = document.documentElement.getAttribute('data-theme');
    expect(attr === 'light' || attr === 'dark').toBe(true);
  });
});

describe('ID_TO_KIND is derived from THEME_REGISTRY', () => {
  it('matches every registered descriptor\'s kind', () => {
    const fromRegistry = Object.fromEntries(
      Object.values(THEME_REGISTRY).map((d) => [d.id, d.kind]),
    );
    expect(ID_TO_KIND).toEqual(fromRegistry);
  });
});

describe('inline FOUC script mirrors the module (no drift)', () => {
  /**
   * Parse the `ID_TO_KIND` object literal out of the inline blocking
   * <script> in index.html. The inline script CANNOT import the module, so it
   * duplicates the map verbatim; this test imports BOTH and asserts equality so
   * a future edit to one (and not the other) fails CI rather than shipping a
   * FOUC/wrong-polarity drift.
   */
  function readInlineIdToKind(): Record<string, string> {
    // Resolve index.html relative to the working directory. vitest runs from the
    // frontend workspace root (`<repo>/frontend`); the `frontend/` fallback keeps
    // this green if invoked from the repo root.
    const candidates = [
      join(process.cwd(), 'index.html'),
      join(process.cwd(), 'frontend', 'index.html'),
    ];
    const indexHtmlPath = candidates.find((p) => existsSync(p));
    if (!indexHtmlPath) {
      throw new Error(
        `Could not locate index.html (looked in: ${candidates.join(', ')}).`,
      );
    }
    const html = readFileSync(indexHtmlPath, 'utf8');
    const match = html.match(/var ID_TO_KIND = (\{[^}]*\})/);
    if (!match) {
      throw new Error(
        'Could not locate `var ID_TO_KIND = {…}` in index.html — the inline ' +
          'FOUC script must declare the id→kind map for the mirror test.',
      );
    }
    // The literal uses unquoted keys + single quotes — wrap to JS-eval it.
    // eslint-disable-next-line no-new-func
    return Function(`return (${match[1]});`)() as Record<string, string>;
  }

  it('the inline script id→kind map equals the module ID_TO_KIND', () => {
    expect(readInlineIdToKind()).toEqual(ID_TO_KIND);
  });

  it('the inline script id→kind map covers all 5 registered ids', () => {
    expect(Object.keys(readInlineIdToKind()).sort()).toEqual(
      Object.keys(THEME_REGISTRY).sort(),
    );
  });
});

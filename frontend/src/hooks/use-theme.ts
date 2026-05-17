import { useEffect, useState } from 'react';
import type { Theme } from '../utils/boot-theme.js';

/**
 * Reactive [data-theme] watcher.
 *
 * Returns the current theme ('light' | 'dark') by reading
 * `document.documentElement.getAttribute('data-theme')` and watching for
 * mutations via a `MutationObserver`. Mirrors the same observer pattern used
 * by `MapCanvas.tsx` for the basemap-swap effect (Phase 1, #570).
 *
 * Why NOT `useMediaQuery('(prefers-color-scheme: dark)')`:
 *   The repo's theme mechanic uses `[data-theme]` as the single source of
 *   truth. `boot-theme.ts` seeds the attribute on page load from localStorage
 *   or OS preference, and a theme toggle writes to both localStorage and the
 *   attribute. The media query would diverge if the user's explicit preference
 *   overrides the OS setting — the attribute never does.
 *
 * Defensive behavior:
 *   - Returns 'light' when `document.documentElement` is unavailable (e.g.
 *     SSR, very old test envs).
 *   - Cleans up the observer on unmount.
 */
export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof document === 'undefined') return 'light';
    return document.documentElement.getAttribute('data-theme') === 'dark'
      ? 'dark'
      : 'light';
  });

  useEffect(() => {
    if (typeof document === 'undefined') return;

    // Sync on mount in case the attribute changed between the lazy useState
    // initializer and the first effect run (e.g. React 18 concurrent mode).
    const current: Theme =
      document.documentElement.getAttribute('data-theme') === 'dark'
        ? 'dark'
        : 'light';
    setTheme(current);

    const observer = new MutationObserver(() => {
      const next: Theme =
        document.documentElement.getAttribute('data-theme') === 'dark'
          ? 'dark'
          : 'light';
      setTheme(next);
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => observer.disconnect();
  }, []);

  return theme;
}

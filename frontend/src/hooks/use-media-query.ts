import { useEffect, useState } from 'react';

/**
 * Reactive CSS media-query matcher.
 *
 * Returns whether `query` currently matches, and updates when the match
 * state changes. Uses `window.matchMedia` under the hood and listens via
 * `MediaQueryList#addEventListener('change', ...)` (the modern API;
 * `addListener` is deprecated but the mock helper in test-setup.ts keeps
 * a no-op stub so consumers that call either don't break).
 *
 * Defensive behavior:
 * - If `window.matchMedia` is undefined (e.g. very old test envs), the
 *   hook returns `false` and registers no listeners. It does NOT crash.
 * - The effect cleans up its listener on unmount and on query change.
 *
 * Originally used by SpeciesPanel (#115) to drive its drawer-vs-sidebar
 * layout. Retained for future responsive-layout hooks that need React-state-
 * driven conditional DOM (e.g. `data-layout` attributes, conditional siblings).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mql = window.matchMedia(query);
    // Re-sync on effect run in case the initial state was captured before
    // matchMedia was available (e.g. SSR hydration).
    setMatches(mql.matches);
    function onChange(event: MediaQueryListEvent) {
      setMatches(event.matches);
    }
    mql.addEventListener('change', onChange);
    return () => {
      mql.removeEventListener('change', onChange);
    };
  }, [query]);

  return matches;
}

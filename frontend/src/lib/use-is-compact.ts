import { useEffect, useState } from 'react';

const QUERY = '(max-width: 1199px)';

/**
 * Single source of truth for the compact / wide presentation split.
 * The 1199px breakpoint (≤1199px = compact) is set so iPad landscape
 * (1024×768) and small laptops fall into the compact tier and use the
 * bottom-sheet pattern instead of a side rail beside the map (issue #663
 * Addendum B). ≥1200px renders the SpeciesDetailRail.
 *
 * Renamed from `useIsMobile` (was `max-width: 760px`) in #663. If a
 * caller genuinely needs the narrower phone-only definition, introduce
 * a separate `useIsPhone` hook rather than re-tightening this one.
 *
 * SSR-safe: returns `false` when `window` is undefined. First client
 * render reads matchMedia and re-renders if compact.
 */
export function useIsCompact(): boolean {
  const [isCompact, setIsCompact] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsCompact(e.matches);
    mql.addEventListener('change', onChange);
    // Sync once at mount in case the SSR path returned a stale `false`.
    setIsCompact(mql.matches);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isCompact;
}

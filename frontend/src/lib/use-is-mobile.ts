import { useEffect, useState } from 'react';

const QUERY = '(max-width: 760px)';

/**
 * Single source of truth for the desktop / mobile presentation split.
 * The 760px breakpoint mirrors the rest of the codebase (styles.css
 * uses @media (max-width: 760px) extensively — line 282 onward).
 *
 * SSR-safe: returns `false` when `window` is undefined. The first
 * client render reads matchMedia and re-renders if mobile, which is
 * the correct order — the desktop modal is the larger DOM, so a
 * brief desktop render before flipping to sheet would cost more than
 * the inverse.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', onChange);
    // Sync once at mount in case the SSR path returned a stale `false`.
    setIsMobile(mql.matches);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}

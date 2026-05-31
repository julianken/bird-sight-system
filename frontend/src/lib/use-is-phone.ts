import { useEffect, useState } from 'react';

/**
 * P1 overlay breakpoint (≤480px). Pin to 480 here; the CSS token is
 * `--overlay-bp-compact` in `frontend/src/styles/tokens.css`. Keep in lockstep:
 * if P1 changes the token value, update this constant too (O5 #783).
 */
const OVERLAY_BP_PX = 480;
const QUERY = `(max-width: ${OVERLAY_BP_PX}px)`;

/**
 * Phone-only hook: returns `true` at ≤480px (the P1 overlay breakpoint).
 *
 * Deliberately separate from `useIsCompact` (max-width: 1199px). Reusing
 * the 1199px signal would over-trigger on iPad landscape (1024×768) and
 * small laptops — those viewports should NOT force-collapse the legend when
 * a sheet opens. Only phone-sized viewports (≤480px) qualify.
 *
 * `use-is-compact.ts:14` explicitly called for this hook to be introduced
 * rather than re-tightening the 1199px query.
 *
 * SSR-safe: returns `false` when `window` / `matchMedia` is undefined.
 * First client render reads matchMedia and re-renders if phone-sized.
 */
export function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsPhone(e.matches);
    mql.addEventListener('change', onChange);
    // Sync once at mount in case the SSR path returned a stale `false`.
    setIsPhone(mql.matches);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isPhone;
}

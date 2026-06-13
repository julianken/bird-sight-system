import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Live `prefers-reduced-motion` sensor (#1063). Seeds from `matchMedia` on mount
 * and subscribes to the `change` event so flipping the OS reduce-motion setting
 * mid-session updates the value WITHOUT a reload. CSS already responds live
 * (motion.css zeroes durations the instant the media query flips), so the prior
 * mount-once read left MapLibre camera flights — which gate `duration: 0` on
 * this value — at full motion until a reload: a split-brain for vestibular-
 * sensitive users. This makes the JS gate track the live preference too.
 *
 * SSR-safe: returns `false` when `window`/`matchMedia` is undefined. The first
 * client render reads matchMedia and re-renders if reduce-motion is set.
 *
 * Mirrors the `use-coarse-pointer.ts` sensor idiom (useState seed + a `change`
 * listener torn down on unmount). Originally extracted from `MapCanvas.tsx` in
 * #889 (epic #884) as a mount-once `useMemo`; #1063 made it reactive.
 */
export function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(QUERY);
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return prefersReducedMotion;
}

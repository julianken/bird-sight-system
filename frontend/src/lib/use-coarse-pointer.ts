import { useEffect, useState } from 'react';

const QUERY = '(pointer: coarse)';

/**
 * Coarse-pointer detection (#247, mobile; also used by auto-spider hit targets
 * in #277). `matchMedia` is the canonical way; we read it on mount and listen
 * for changes so a device that switches pointer class (e.g. tablet + mouse)
 * updates live.
 *
 * SSR-safe: returns `false` when `window`/`matchMedia` is undefined. The first
 * client render reads matchMedia and re-renders if the pointer is coarse.
 *
 * Extracted verbatim from `MapCanvas.tsx` in #889 (epic #884) — behaviour-
 * preserving; mirrors the `use-is-compact.ts` sensor idiom.
 */
export function useCoarsePointer(): boolean {
  const [isCoarsePointer, setIsCoarsePointer] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(QUERY);
    const handler = (e: MediaQueryListEvent) => setIsCoarsePointer(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isCoarsePointer;
}

import { useMemo } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Phase 0: read `prefers-reduced-motion` once at mount. `useMemo` with an empty
 * dep array captures the value once — intentional. The user must reload to fully
 * apply other reduced-motion changes anyway, and re-checking adds complexity for
 * negligible gain. This deliberately registers NO `change` listener; it is a
 * mount-once read, not a reactive sensor — do not convert it into one.
 *
 * SSR-safe: returns `false` when `window`/`matchMedia` is undefined.
 *
 * Extracted verbatim from `MapCanvas.tsx` in #889 (epic #884) — behaviour-
 * preserving; the no-listener semantics are preserved exactly.
 */
export function usePrefersReducedMotion(): boolean {
  return useMemo(
    () =>
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(QUERY).matches
        : false,
    [],
  );
}

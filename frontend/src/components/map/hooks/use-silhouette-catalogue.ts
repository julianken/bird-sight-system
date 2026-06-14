// Extracted from MapCanvas.tsx for epic #884 (U7 / #891) — a behavior-
// PRESERVING move of the silhouette-catalogue derives out of the god
// component. Two pieces travel together because they share the one input
// (the `silhouettes` prop) and are consumed as a pair downstream:
//
//   1. The monotonic `silhouettesVersion` render-phase ref-counter.
//   2. The `silhouettesById` lookup memo keyed on `[silhouettes]`.
//
// NOTHING about the runtime contract changes: the version counter still seeds
// from the FIRST `silhouettes` value and bumps only on a reference change; the
// memo is still referentially STABLE on `[silhouettes]` (load-bearing — see
// below); the `commonName: string | null` field (#920/#926) is carried
// verbatim. `silhouetteRenderById` is keyed on `[observations, …]` and stays in
// MapCanvas (U8). The render-phase `prevBoundsKeyRef` scope-change block (#872)
// also stays — it is unrelated to the silhouette catalogue.
import { useMemo, useRef } from 'react';
import type { FamilySilhouette } from '@bird-watch/shared-types';
import type { SilhouettesById } from '@/components/map/geometry/adaptive-grid.js';

/**
 * Silhouette-catalogue derives extracted from MapCanvas. Returns the per-family
 * `silhouettesById` lookup plus the monotonic `silhouettesVersion` counter that
 * surfaces in-place catalogue refreshes the memo's `[silhouettes]` key already
 * captures.
 */
export function useSilhouetteCatalogue(silhouettes: FamilySilhouette[]): {
  silhouettesById: SilhouettesById;
  silhouettesVersion: number;
} {
  /**
   * Monotonic `silhouettesVersion` (spec §5.3 Concern C, point 2). This is
   * a strict integer counter, NOT `silhouettes.length` — a length-only
   * proxy misses in-place row replacement (same count, different svgData
   * — Phylopic refreshes, low-res→hi-res swaps). The counter increments
   * each time the silhouettes prop changes by reference, which is the same
   * point where the supercluster catalogue is rebuilt.
   *
   * Carried into the per-grid memo key + the cache-generation effect so
   * an in-place catalogue refresh invalidates render-pass identity and the
   * Concern B promise cache together.
   */
  const silhouettesVersionRef = useRef(0);
  const prevSilhouettesRef = useRef<typeof silhouettes>(silhouettes);
  if (prevSilhouettesRef.current !== silhouettes) {
    silhouettesVersionRef.current += 1;
    prevSilhouettesRef.current = silhouettes;
  }
  const silhouettesVersion = silhouettesVersionRef.current;

  /**
   * Pure per-family lookup used by `buildAdaptiveTiles` (spec §5.3 Concern
   * C, point 3). Resolved once per reconcile from the silhouettes prop —
   * the tile-builder MUST NOT read from a ref, so we thread this
   * explicitly. An empty map signals "catalogue not loaded yet" and
   * produces all-`pending` tiles.
   */
  const silhouettesById = useMemo<SilhouettesById>(() => {
    const map = new Map<
      string,
      { svgData: string | null; color: string; colorDark: string; commonName: string | null }
    >();
    for (const s of silhouettes) {
      map.set(s.familyCode.toLowerCase(), {
        svgData: s.svgData,
        color: s.color,
        colorDark: s.colorDark,
        // #920: carry the curated colloquial name so the tile builders can
        // resolve each tile's `displayName` and the popovers show
        // "Tyrant Flycatchers" instead of the scientific "Tyrannidae".
        commonName: s.commonName,
      });
    }
    return map;
  }, [silhouettes]);

  return { silhouettesById, silhouettesVersion };
}

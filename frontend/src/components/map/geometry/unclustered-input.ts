// Per-observation DeconflictInput builder for VISIBLE unclustered points
// (issue #1296). Extracted from MapCanvas.tsx's reconciler so the
// silhouette-vs-grid decision is pure + unit-testable.
//
// Background: the adaptive-grid reconciler queries every visible
// `unclustered-point` feature and feeds each into `buildGroups`. Historically
// EVERY such lone observation was pushed as a `kind:'silhouette'` input, and
// `buildGroups` EXCLUDES silhouettes from `renderedTotal`. So as zoom de-clusters
// a filtered view into more singletons, the on-screen Σ renderedTotal fell below
// the obs count the lede shows — birds silently missing from the map.
//
// Fix (FILTERED views only): promote each lone observation to a count-bearing
// 1×1 family grid marker. `kind:'grid'` ⇒ deconflict SUMS its `point_count` (1)
// into `renderedTotal`, so Σ renderedTotal === the viewport obs count again. The
// obs renders as a single-leaf family silhouette (AdaptiveGridMarker suppresses
// the count-1 badge per spec §4.3) — a real React marker that is now COUNTED and
// click-routes to the observation popover, instead of an uncounted bare dot.
//
// UNFILTERED views are UNCHANGED: lone obs stay bare silhouettes (no "1"-badge
// spam across thousands of birds in dense high-zoom views).
import {
  buildAdaptiveTiles,
  type ClusterLeafFeature,
  type ResolvedGrid,
  type SilhouettesById,
} from './adaptive-grid.js';
import {
  GRID_SINGLE_ID_BASE,
  hashSubId,
  type DeconflictInput,
} from './deconflict.js';

/** The map-resolved properties a single visible unclustered feature carries. */
export interface UnclusteredFeatureInput {
  /** Observation subId (promoteId key — drives the canvas-twin feature-state). */
  subId: string;
  /** Family code (null when the silhouette join misses). */
  familyCode: string | null;
  /** eBird species code (null for spuh/slash/hybrid). */
  speciesCode: string | null;
  /** Display common name. */
  comName: string;
  /** Whether this observation is in eBird's notable list. */
  isNotable: boolean;
  /** Geographic position. */
  longitude: number;
  latitude: number;
  /** Already-projected pixel center (the shell owns `map.project`). */
  px: number;
  py: number;
}

/** A lone observation is exactly one family → a 1×1 grid. */
const SINGLE_OBS_SHAPE: ResolvedGrid = { tag: 'grid', cols: 1, rows: 1 };

/**
 * Build the `DeconflictInput` for one visible unclustered observation.
 *
 * - `filterActive === false` → a `kind:'silhouette'` input with a NEGATIVE
 *   pseudo-id (`-hashSubId(subId)`), EXACTLY as the pre-#1296 reconciler built
 *   it. Displaced (never suppressed) by deconflict; painted by the canvas
 *   `unclustered-point` SDF layer; EXCLUDED from `renderedTotal`.
 * - `filterActive === true` → a `kind:'grid'` input (1×1 family tile) with a
 *   positive high-band id (see `GRID_SINGLE_ID_BASE`). SUMMED into
 *   `renderedTotal`; the caller hides the canvas twin via feature-state so the
 *   grid marker doesn't double-render over the SDF dot.
 *
 * `isMobile` is accepted for call-site parity with `pickGridShape`; a single
 * family is always a clean 1×1 grid on both tiers, so it is currently unused.
 */
export function buildUnclusteredInput(
  f: UnclusteredFeatureInput,
  filterActive: boolean,
  isMobile: boolean,
  silhouettesById: SilhouettesById,
): DeconflictInput {
  void isMobile; // 1 family ⇒ 1×1 on every tier (see pickGridShape's table).
  if (!filterActive) {
    return {
      cluster_id: -hashSubId(f.subId),
      px: f.px,
      py: f.py,
      rendered: { kind: 'silhouette' },
      point_count: 1,
      uniqueFamilies: 1,
      longitude: f.longitude,
      latitude: f.latitude,
      subId: f.subId,
    };
  }

  // Single-leaf tile, built the SAME way the clustered branch builds its grid
  // tiles (`buildAdaptiveTiles`) — one leaf = this observation's family.
  const leaf: ClusterLeafFeature = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [f.longitude, f.latitude] },
    properties: {
      familyCode: f.familyCode,
      speciesCode: f.speciesCode,
      comName: f.comName,
      isNotable: f.isNotable,
    },
  };
  const tiles = buildAdaptiveTiles([leaf], silhouettesById, SINGLE_OBS_SHAPE);

  return {
    cluster_id: GRID_SINGLE_ID_BASE + hashSubId(f.subId),
    px: f.px,
    py: f.py,
    rendered: { kind: 'grid', shape: SINGLE_OBS_SHAPE },
    point_count: 1,
    uniqueFamilies: 1,
    longitude: f.longitude,
    latitude: f.latitude,
    tiles,
    isNotable: f.isNotable,
    subId: f.subId,
  };
}

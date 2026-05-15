import type { ResolvedGrid } from './adaptive-grid.js';

/**
 * Pure post-clustering deconflict layer (issue #554). Resolves visible
 * marker overlap by grouping rendered clusters via Union-Find on AABB
 * intersection, then surfacing one anchor cluster per group.
 *
 * The module is sync and pure: no React, no MapLibre, no async. The
 * caller projects lng/lat → pixel space and passes a list of resolved
 * cluster entries; this module returns the grouped output.
 *
 * Spec / proposal: docs/plans/2026-05-15-marker-overlap-deconflict.md
 *                  github.com/julianken/bird-sight-system/issues/554
 */

/** Axis-aligned bounding box, in screen pixels. */
export interface AABB {
  /** Pixel x of the top-left corner. */
  x: number;
  /** Pixel y of the top-left corner. */
  y: number;
  /** Width in pixels. */
  w: number;
  /** Height in pixels. */
  h: number;
}

/**
 * Predicted rendered shape of a cluster, plus its `count` for pill
 * width derivation. The deconflict module uses `markerDimensions` /
 * `pillDimensions` (from Task 1) keyed off this type.
 */
export type RenderedShape =
  | { kind: 'grid'; shape: ResolvedGrid }
  | { kind: 'pill'; count: number };

/** A cluster as fed into the deconflict module. */
export interface DeconflictInput {
  /** Real supercluster cluster_id (positive integer). */
  cluster_id: number;
  /** Pixel center of the rendered marker (already projected). */
  px: number;
  py: number;
  /** Predicted rendered shape (from the resolver pass). */
  rendered: RenderedShape;
  /** Total observations in this cluster. */
  point_count: number;
  /** Unique families (for aria-label aggregation). */
  uniqueFamilies: number;
}

/** A group emitted by `buildGroups`. */
export interface DeconflictGroup {
  /** The anchor cluster (the one whose marker actually renders). */
  anchor: DeconflictInput;
  /** Real cluster_ids of every group member (1 if solo, 2+ if merged). */
  memberIds: number[];
  /** Stable React key derived from anchor's spatial bucket. */
  key: string;
  /** ARIA label per spec §4.6 (plus issue #554's "+N nearby" variant). */
  ariaLabel: string;
}

/**
 * AABB intersection predicate with optional safety margin (px).
 * Two AABBs overlap iff their projections overlap on BOTH axes.
 * `margin > 0` widens each box by `margin` pixels on every side before
 * the test — used to compensate for CSS subpixel rounding (the rendered
 * marker can be ±1px off the predicted box).
 */
export function intersect(a: AABB, b: AABB, margin = 0): boolean {
  throw new Error('not implemented');
}

/**
 * Compute the AABB for a rendered shape, centered at the given pixel
 * position. Uses `markerDimensions` (grid) or `pillDimensions` (pill).
 */
export function aabbForShape(rendered: RenderedShape, px: number, py: number): AABB {
  throw new Error('not implemented');
}

/**
 * Standard Union-Find with path compression + union by rank.
 * Returns, for each input index, the canonical component representative.
 *
 * `n` is the number of nodes; `edges` is a list of [i, j] pairs where i
 * and j are node indices that should be in the same component.
 */
export function unionFind(n: number, edges: ReadonlyArray<[number, number]>): number[] {
  throw new Error('not implemented');
}

/**
 * Spatial-bucket React key — derives from anchor pixel position only.
 *
 * Quantization uses `Math.round(px / BUCKET_PX)` (banker's-rounding-free —
 * 0.5 always rounds up under JavaScript semantics). The rounding strategy
 * is load-bearing: Test 8 (`spatial-bucket key changes when anchor crosses
 * a 14px bucket boundary`) asserts the exact boundary at px=105 (round
 * 105/14=7.5 → 8), so implementations using `Math.floor` will fail.
 */
export function bucketKey(px: number, py: number, zoom: number, BUCKET_PX: number): string {
  throw new Error('not implemented');
}

/**
 * Run the full deconflict pipeline. Returns one `DeconflictGroup` per
 * connected component in the AABB-overlap graph. Anchor selection is
 * `min(cluster_id)` (deterministic, pan-stable).
 */
export function buildGroups(
  clusters: ReadonlyArray<DeconflictInput>,
  zoom: number,
): DeconflictGroup[] {
  throw new Error('not implemented');
}

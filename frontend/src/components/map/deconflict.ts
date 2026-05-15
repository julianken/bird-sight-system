import type { AdaptiveTile, ResolvedGrid } from './adaptive-grid.js';
import { markerDimensions, MIN_MARKER_PX } from './AdaptiveGridMarker.js';
import { pillDimensions } from '../ds/ClusterPill.js';

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

// MIN_MARKER_PX must remain even — odd values produce non-integer bucket
// keys (`bucket-7.5-3-8`), which still work for React keys but are fragile.
// MIN_MARKER_PX = 28 today; the AdaptiveGridMarker formula
// 1*CELL_PX + 2*GRID_PADDING_PX = 22 + 6 = 28 keeps it even by construction.
const BUCKET_PX = MIN_MARKER_PX / 2;  // 14

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
  /**
   * Longitude (anchor coord — used by MapCanvas's click handler easeTo and
   * by PresentationMarker positioning). Optional only because Task 2's unit
   * tests don't set it; production callers always pass a value.
   */
  longitude?: number;
  /**
   * Latitude (anchor coord — used by MapCanvas's click handler easeTo and
   * by PresentationMarker positioning). Optional only because Task 2's unit
   * tests don't set it; production callers always pass a value.
   */
  latitude?: number;
  /** Optional render-only: AdaptiveGrid tile array (anchor's resolved data). */
  tiles?: ReadonlyArray<AdaptiveTile>;
  /** Optional render-only: whether this anchor is a single notable observation. */
  isNotable?: boolean;
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
  const ax2 = a.x + a.w + margin;
  const ay2 = a.y + a.h + margin;
  const bx2 = b.x + b.w + margin;
  const by2 = b.y + b.h + margin;
  const ax1 = a.x - margin;
  const ay1 = a.y - margin;
  const bx1 = b.x - margin;
  const by1 = b.y - margin;
  return ax1 < bx2 && bx1 < ax2 && ay1 < by2 && by1 < ay2;
}

/**
 * Compute the AABB for a rendered shape, centered at the given pixel
 * position. Uses `markerDimensions` (grid) or `pillDimensions` (pill).
 */
export function aabbForShape(rendered: RenderedShape, px: number, py: number): AABB {
  const { w, h } = rendered.kind === 'grid'
    ? markerDimensions(rendered.shape)
    : pillDimensions(rendered.count);
  return { x: px - w / 2, y: py - h / 2, w, h };
}

/**
 * Standard Union-Find with path compression + union by rank.
 * Returns, for each input index, the canonical component representative.
 *
 * `n` is the number of nodes; `edges` is a list of [i, j] pairs where i
 * and j are node indices that should be in the same component.
 */
export function unionFind(n: number, edges: ReadonlyArray<[number, number]>): number[] {
  const parent = Array.from({ length: n }, (_, i) => i);
  const rank = new Array(n).fill(0);
  const find = (x: number): number => {
    // noUncheckedIndexedAccess: parent is length-n, x always < n by construction
    while (parent[x] !== x) {
      const grandparent = parent[parent[x]!] as number;
      parent[x] = grandparent; // path halving
      x = parent[x] as number;
    }
    return x;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    // noUncheckedIndexedAccess: ra, rb are valid indices (results of find)
    if ((rank[ra] as number) < (rank[rb] as number)) parent[ra] = rb;
    else if ((rank[ra] as number) > (rank[rb] as number)) parent[rb] = ra;
    else { parent[rb] = ra; (rank[ra] as number)++; }
  };
  for (const [i, j] of edges) union(i, j);
  return parent.map((_, i) => find(i));
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
  const qx = Math.round(px / BUCKET_PX);
  const qy = Math.round(py / BUCKET_PX);
  return `bucket-${qx}-${qy}-${zoom}`;
}

function ariaLabelFor(anchor: DeconflictInput, others: DeconflictInput[]): string {
  if (others.length === 0) {
    const familyWord = anchor.uniqueFamilies === 1 ? 'family' : 'families';
    return `Cluster: ${anchor.point_count} observations, ${anchor.uniqueFamilies} ${familyWord}. Activate to zoom in.`;
  }
  const otherCount = others.reduce((sum, o) => sum + o.point_count, 0);
  const clusterWord = others.length === 1 ? '1 cluster' : `${others.length} clusters`;
  return `Cluster: ${anchor.point_count} observations (+${otherCount} nearby in ${clusterWord}). Activate to zoom in.`;
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
  if (clusters.length === 0) return [];

  // 1. Compute AABBs
  const aabbs = clusters.map((c) => aabbForShape(c.rendered, c.px, c.py));

  // 2. Build edge set (O(N²) — bounded by visible cluster count, ≤~50 in practice)
  const edges: Array<[number, number]> = [];
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      // noUncheckedIndexedAccess: i,j < clusters.length, aabbs same length
      if (intersect(aabbs[i] as AABB, aabbs[j] as AABB, /* margin */ 1)) {
        edges.push([i, j]);
      }
    }
  }

  // 3. Union-Find → component id per node
  const reps = unionFind(clusters.length, edges);

  // 4. Group nodes by component
  const componentMembers = new Map<number, number[]>();
  for (let i = 0; i < reps.length; i++) {
    // noUncheckedIndexedAccess: reps is length clusters.length, i < reps.length
    const r = reps[i] as number;
    if (!componentMembers.has(r)) componentMembers.set(r, []);
    componentMembers.get(r)!.push(i);
  }

  // 5. For each component, pick anchor (min cluster_id) + assemble group
  const groups: DeconflictGroup[] = [];
  for (const indices of componentMembers.values()) {
    // noUncheckedIndexedAccess: indices come from a Map we built above, bounds are guaranteed
    const members = indices.map((i) => clusters[i] as DeconflictInput);
    const anchor = members.reduce((a, b) => (a.cluster_id < b.cluster_id ? a : b)) as DeconflictInput;
    const others = members.filter((m): m is DeconflictInput => m.cluster_id !== anchor.cluster_id);
    const memberIds = members.map((m) => m.cluster_id).sort((a, b) => a - b);
    groups.push({
      anchor,
      memberIds,
      key: bucketKey(anchor.px, anchor.py, zoom, BUCKET_PX),
      ariaLabel: ariaLabelFor(anchor, others),
    });
  }

  return groups;
}

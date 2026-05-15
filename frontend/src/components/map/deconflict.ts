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

/**
 * Silhouette AABB extent (issue #554 scope expansion 2026-05-15).
 * Icon size 0.85 × 32px source SDF ≈ 27.2px, rounded up to MIN_MARKER_PX
 * symmetry. Halo +1.5 absorbed by the existing margin=1 in `intersect`.
 */
export const SILHOUETTE_PX = 28;

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
 *
 * The `silhouette` variant (issue #554 scope expansion 2026-05-15)
 * represents the family-silhouette SDF icons painted by the
 * `unclustered-point` symbol layer. Silhouettes are NEVER suppressed
 * by deconflict — instead `displaceSilhouettes` returns a bounded
 * pixel offset so the silhouette renders BESIDE any overlapping
 * cluster anchor.
 */
export type RenderedShape =
  | { kind: 'grid'; shape: ResolvedGrid }
  | { kind: 'pill'; count: number }
  | { kind: 'silhouette' };

/** A cluster as fed into the deconflict module. */
export interface DeconflictInput {
  /**
   * Real supercluster cluster_id (positive integer) for clusters; a
   * NEGATIVE pseudo-id (e.g. `-hashSubId(subId)`) for silhouettes so
   * silhouette ids never collide with real cluster ids. Anchor selection
   * in `buildGroups` checks `rendered.kind` first (cluster wins over
   * silhouette) before falling back to min(cluster_id) within a kind.
   */
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
  /**
   * Observation subId for silhouette inputs (REQUIRED for the silhouette
   * variant so `displaceSilhouettes` can key its output map). Undefined
   * for cluster inputs.
   */
  subId?: string;
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
 * position. Uses `markerDimensions` (grid), `pillDimensions` (pill), or
 * the static `SILHOUETTE_PX` square (silhouette).
 */
export function aabbForShape(rendered: RenderedShape, px: number, py: number): AABB {
  if (rendered.kind === 'grid') {
    const { w, h } = markerDimensions(rendered.shape);
    return { x: px - w / 2, y: py - h / 2, w, h };
  }
  if (rendered.kind === 'pill') {
    const { w, h } = pillDimensions(rendered.count);
    return { x: px - w / 2, y: py - h / 2, w, h };
  }
  // silhouette — square AABB of fixed extent
  return {
    x: px - SILHOUETTE_PX / 2,
    y: py - SILHOUETTE_PX / 2,
    w: SILHOUETTE_PX,
    h: SILHOUETTE_PX,
  };
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

  // 5. For each component, pick anchor + assemble group.
  //    Rule (issue #554 scope expansion): prefer ANY non-silhouette over a
  //    silhouette regardless of cluster_id sign — silhouettes are NEVER
  //    anchors. Within the same kind (silhouette vs silhouette, or
  //    cluster vs cluster), tiebreak by min(cluster_id) for pan-stability.
  //    Without this rule, silhouettes (with their negative pseudo-ids)
  //    would win min(cluster_id) against any cluster, suppressing the
  //    cluster marker.
  const groups: DeconflictGroup[] = [];
  for (const indices of componentMembers.values()) {
    // noUncheckedIndexedAccess: indices come from a Map we built above, bounds are guaranteed
    const members = indices.map((i) => clusters[i] as DeconflictInput);
    const anchor = members.reduce((a, b) => {
      const aIsSil = a.rendered.kind === 'silhouette';
      const bIsSil = b.rendered.kind === 'silhouette';
      if (aIsSil && !bIsSil) return b;
      if (!aIsSil && bIsSil) return a;
      return a.cluster_id < b.cluster_id ? a : b;
    }) as DeconflictInput;
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

/**
 * Displace silhouettes that share a group with a non-silhouette anchor
 * (issue #554 scope expansion 2026-05-15). Per direct user direction:
 * silhouettes MUST REMAIN VISIBLE — no suppression, no hiding. Instead,
 * each overlapping silhouette is shifted radially outward from the anchor
 * center along the anchor→silhouette vector, just far enough that the
 * silhouette's AABB sits OUTSIDE the anchor's AABB, capped at
 * `maxOffsetPx` (default 20px).
 *
 * Returns a `Map<subId, { dx, dy }>` where `dx`/`dy` are the pixel-space
 * displacement to apply at render time. Callers convert the offset to a
 * lng/lat delta via `map.unproject(map.project([lng,lat]).add([dx,dy]))`.
 *
 * Silhouette-only groups (no cluster anchor in the same component) are
 * left untouched — there's nothing to deconflict against, so the
 * silhouette stays at its geographic position.
 */
export function displaceSilhouettes(
  groups: ReadonlyArray<DeconflictGroup>,
  inputs: ReadonlyArray<DeconflictInput>,
  maxOffsetPx = 20,
): Map<string, { dx: number; dy: number }> {
  const offsets = new Map<string, { dx: number; dy: number }>();
  // Build a quick lookup from cluster_id → input for the silhouette members
  // (so we can read each silhouette's px/py without re-scanning per group).
  const byId = new Map<number, DeconflictInput>();
  for (const inp of inputs) byId.set(inp.cluster_id, inp);

  for (const group of groups) {
    const anchor = group.anchor;
    if (anchor.rendered.kind === 'silhouette') continue;
    // Find silhouette members in this group via memberIds.
    const silhouettes = group.memberIds
      .map((id) => byId.get(id))
      .filter((m): m is DeconflictInput =>
        m !== undefined && m.rendered.kind === 'silhouette',
      );
    if (silhouettes.length === 0) continue;

    const anchorBB = aabbForShape(anchor.rendered, anchor.px, anchor.py);
    // anchorBB extent half-widths along axes — used to compute the
    // minimum displacement that puts the silhouette OUTSIDE the anchor.
    const anchorHalfW = anchorBB.w / 2;
    const anchorHalfH = anchorBB.h / 2;
    const silHalf = SILHOUETTE_PX / 2;

    for (const s of silhouettes) {
      if (s.subId === undefined) {
        // Type contract says silhouettes carry a subId. Defensive guard
        // for unit tests / future regressions — skip + warn.
        // eslint-disable-next-line no-console
        console.warn('[deconflict] silhouette member missing subId; skipping displacement');
        continue;
      }
      // Vector from anchor center → silhouette center.
      let vx = s.px - anchor.px;
      let vy = s.py - anchor.py;
      // Degenerate case: silhouette center === anchor center.
      // Use a stable hash of the subId to pick a direction so coincident
      // silhouettes spread radially instead of stacking on the east flank.
      if (Math.abs(vx) < 1e-6 && Math.abs(vy) < 1e-6) {
        // Hash subId to a stable angle in [0, 2π)
        const seed = s.subId
          ? Array.from(s.subId).reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)
          : 0;
        const angle = (Math.abs(seed) % 360) * (Math.PI / 180);
        vx = Math.cos(angle);
        vy = Math.sin(angle);
      }
      const mag = Math.hypot(vx, vy);
      const ux = vx / mag;
      const uy = vy / mag;
      // Minkowski-sum approach: the silhouette's CENTER must sit outside
      // the anchor's AABB inflated by the silhouette's half-extent. For
      // an axis-aligned box with half-widths (hwExp, hhExp), the ray from
      // the anchor center in direction (ux, uy) exits the inflated box
      // at center-distance `t` where `t * |ux| = hwExp` or `t * |uy| =
      // hhExp` — whichever comes FIRST (min, not max). Axis-aligned rays
      // (one component zero) pick the corresponding non-zero clearance
      // directly; the 1e-6 floor only matters as a divide-by-zero guard
      // and never wins the min.
      const hwExp = anchorHalfW + silHalf;
      const hhExp = anchorHalfH + silHalf;
      const tX = hwExp / Math.max(Math.abs(ux), 1e-6);
      const tY = hhExp / Math.max(Math.abs(uy), 1e-6);
      const requiredCenterDist = Math.min(tX, tY);
      // Need to move the silhouette so its distance from the anchor
      // center becomes `requiredCenterDist`. The displacement magnitude
      // is therefore `requiredCenterDist - mag` (positive → outward).
      // If the silhouette is already outside (mag >= requiredCenterDist),
      // no displacement is needed.
      const needed = requiredCenterDist - mag;
      const displacement = Math.max(0, Math.min(needed, maxOffsetPx));
      if (displacement === 0) continue;
      offsets.set(s.subId, { dx: ux * displacement, dy: uy * displacement });
    }
  }

  return offsets;
}

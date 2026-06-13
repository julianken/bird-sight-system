import type { AdaptiveTile, ResolvedGrid } from './adaptive-grid.js';
import { markerDimensions, MIN_MARKER_PX } from './AdaptiveGridMarker.js';
import { pillDimensions } from '../ds/ClusterPill.js';
import { countNoun, formatCount } from '../../lib/format-count.js';

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
  /**
   * Geographic positions of all group members. Each entry is `{ lng, lat }`
   * derived from the corresponding `DeconflictInput.longitude` / `.latitude`
   * fields. Members without coordinates (where production callers always set
   * both) are omitted.
   */
  leaves: ReadonlyArray<{ lng: number; lat: number }>;
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
    const obsPhrase = countNoun(anchor.point_count, 'observation');
    const familyWord = anchor.uniqueFamilies === 1 ? 'family' : 'families';
    return `Cluster: ${obsPhrase}, ${formatCount(anchor.uniqueFamilies)} ${familyWord}. Activate to zoom in.`;
  }
  // Partition by kind: silhouettes are individual observations, not clusters.
  // Bot review #554: counting silhouettes as clusters produced incorrect aria-labels.
  const nearbyClusters = others.filter((o) => o.rendered.kind !== 'silhouette');
  const nearbySilhouettes = others.filter((o) => o.rendered.kind === 'silhouette');

  const clusterPart =
    nearbyClusters.length > 0
      ? (() => {
          const count = nearbyClusters.reduce((sum, o) => sum + o.point_count, 0);
          const clusterWord =
            nearbyClusters.length === 1 ? '1 cluster' : `${nearbyClusters.length} clusters`;
          return `+${count} nearby in ${clusterWord}`;
        })()
      : null;

  const silhouettePart =
    nearbySilhouettes.length > 0
      ? (() => {
          const count = nearbySilhouettes.length;
          const obsWord = count === 1 ? 'observation' : 'observations';
          return `+${count} nearby ${obsWord}`;
        })()
      : null;

  const parts = [clusterPart, silhouettePart].filter(Boolean).join(', ');
  return `Cluster: ${countNoun(anchor.point_count, 'observation')} (${parts}). Activate to zoom in.`;
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
    const leaves = members
      .filter((m) => m.longitude !== undefined && m.latitude !== undefined)
      .map((m) => ({ lng: m.longitude as number, lat: m.latitude as number }));
    groups.push({
      anchor,
      memberIds,
      key: bucketKey(anchor.px, anchor.py, zoom, BUCKET_PX),
      ariaLabel: ariaLabelFor(anchor, others),
      leaves,
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

/**
 * A displaced silhouette's FINAL pixel center (input position + the offset
 * `displaceSilhouettes` already applied), keyed by subId. Input to the
 * collision/spiral pass below.
 */
export interface DisplacedSilhouette {
  subId: string;
  /** Final pixel x after `displaceSilhouettes` (input px + offset dx). */
  px: number;
  /** Final pixel y after `displaceSilhouettes` (input py + offset dy). */
  py: number;
}

/**
 * Pairwise overlap ratio for two SILHOUETTE_PX-square bboxes centered at the
 * given pixel positions, as `intersectionArea / min(areaA, areaB)`.
 *
 * The denominator is PINNED to the smaller bbox's area (#1058 reviewer addendum
 * #2) — both silhouette bboxes are identical squares today, so `min` equals
 * `SILHOUETTE_PX²`, but pinning the metric here means the AC's "≤25% overlap"
 * is encoded in one place rather than re-derived per test. Returns a value in
 * `[0, 1]`: 1 when the centers coincide, 0 when the boxes are disjoint.
 */
export function pairwiseOverlapRatio(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const ox = Math.max(0, SILHOUETTE_PX - Math.abs(ax - bx));
  const oy = Math.max(0, SILHOUETTE_PX - Math.abs(ay - by));
  const intersection = ox * oy;
  const minArea = SILHOUETTE_PX * SILHOUETTE_PX; // both bboxes are equal squares
  return intersection / minArea;
}

/**
 * Collision/spiral layout pass for displaced silhouette twins (E6 / #1058,
 * M-15 "Yuma clump"). PURE and unit-testable: no React, no MapLibre.
 *
 * `displaceSilhouettes` shifts each silhouette away from ITS OWN group's
 * cluster anchor and never compares two silhouettes' final positions, so at a
 * dense border, twins displaced out of adjacent groups land on top of each
 * other (the count badges then read as belonging to two birds at once). This
 * post-step nudges overlapping twins apart along their center-to-center vector
 * until no pair overlaps by more than 25% of the smaller bbox area (the
 * `pairwiseOverlapRatio` metric), returning ONLY the EXTRA per-subId pixel
 * offset to apply on top of `displaceSilhouettes`' offset.
 *
 * Contract (per #1058):
 *  - no-op for ≤1 twin (`items.length <= 1` → empty map) — nothing to deconflict;
 *  - empty input → empty map, so the silhouette-only-group early-exit upstream
 *    (zero displaced twins) is preserved untouched;
 *  - already-separated twins (every pair ≥ `TWIN_MIN_SEPARATION` apart) → no
 *    offsets emitted, so the common no-collision case is a true no-op;
 *  - offsets stay BOUNDED — the spiral seed places the k-th clump member at
 *    radius ≈ `TWIN_MIN_SEPARATION·√k`, so cumulative displacement grows only as
 *    √(clump size); the spiral relaxes `displaceSilhouettes`' 20px `maxOffsetPx`
 *    cap without becoming unbounded;
 *  - deterministic — fixed iteration count + a stable subId-hash phase for the
 *    spiral seed (so a clump radiates evenly instead of all pushing one axis).
 *
 * Algorithm (two phases):
 *  1. SPIRAL SEED. Connected clumps of mutually-overlapping twins are found via
 *     Union-Find on the `< TWIN_MIN_SEPARATION` graph; each clump's members are
 *     placed on a deterministic sunflower (phyllotaxis) spiral around the clump
 *     centroid, ordered by subId hash. This alone separates exactly-coincident
 *     twins (which a pure pairwise push cannot, having no gradient).
 *  2. RELAXATION. A fixed budget of pairwise passes nudges any remaining
 *     sub-`TWIN_MIN_SEPARATION` pair apart by half the shortfall each — cleans
 *     up near-coincident (not exactly equal) seeds the spiral didn't fully clear.
 *  O(passes·N²), bounded by twin count (<20 in practice).
 */
// Center separation that guarantees ≤25% overlap for two equal SILHOUETTE_PX
// squares in ANY direction. Worst case is axis-aligned with full perpendicular
// overlap: area = SIL·(SIL−d). Setting that ≤ 0.25·SIL² gives d ≥ 0.75·SIL = 21
// at SIL=28. We target a hair above 0.75·SILHOUETTE_PX (a 0.5px epsilon) so
// floating-point relaxation lands strictly inside the ≤25% AC, not exactly on it.
const TWIN_MIN_SEPARATION = SILHOUETTE_PX * 0.75 + 0.5;

export function resolveDisplacedCollisions(
  items: ReadonlyArray<DisplacedSilhouette>,
): Map<string, { dx: number; dy: number }> {
  const extra = new Map<string, { dx: number; dy: number }>();
  if (items.length <= 1) return extra;

  // Mutable working positions (start at the already-displaced centers).
  const pos = items.map((it) => ({ x: it.px, y: it.py }));
  const origin = items.map((it) => ({ x: it.px, y: it.py }));

  // ── Phase 1: spiral-seed each connected clump of overlapping twins ──────────
  // Build the overlap graph (pairs closer than TWIN_MIN_SEPARATION) and group
  // by connected component, so an isolated already-separated twin is its own
  // singleton clump (untouched) and a pile becomes one clump.
  const edges: Array<[number, number]> = [];
  for (let i = 0; i < pos.length; i++) {
    for (let j = i + 1; j < pos.length; j++) {
      if (Math.hypot(pos[i]!.x - pos[j]!.x, pos[i]!.y - pos[j]!.y) < TWIN_MIN_SEPARATION) {
        edges.push([i, j]);
      }
    }
  }
  const reps = unionFind(pos.length, edges);
  const clumps = new Map<number, number[]>();
  for (let i = 0; i < reps.length; i++) {
    const r = reps[i] as number;
    if (!clumps.has(r)) clumps.set(r, []);
    clumps.get(r)!.push(i);
  }

  // Golden-angle sunflower: the k-th point sits at angle k·137.5° and radius
  // proportional to √k, which keeps neighbors ≈ a constant distance apart while
  // the whole pattern stays compact (radius ~ √k, not k). Scale so adjacent
  // ring members clear TWIN_MIN_SEPARATION.
  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ≈ 137.5° in radians
  const RADIAL_STEP = TWIN_MIN_SEPARATION; // r(k) = RADIAL_STEP · √k
  for (const indices of clumps.values()) {
    if (indices.length <= 1) continue; // singleton clump — already clear
    // Centroid of the clump's CURRENT positions — the spiral re-centers here so
    // the seeded ring stays near the twins' true border location.
    let cx = 0;
    let cy = 0;
    for (const i of indices) {
      cx += pos[i]!.x;
      cy += pos[i]!.y;
    }
    cx /= indices.length;
    cy /= indices.length;
    // Deterministic order by subId hash so the seed is pan-stable.
    const ordered = [...indices].sort(
      (a, b) => hashSubId(items[a]!.subId) - hashSubId(items[b]!.subId),
    );
    ordered.forEach((idx, k) => {
      const radius = RADIAL_STEP * Math.sqrt(k);
      const angle = k * GOLDEN_ANGLE;
      pos[idx] = { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
    });
  }

  // ── Phase 2: relaxation cleanup for any residual sub-separation pairs ───────
  const PASSES = 24;
  for (let pass = 0; pass < PASSES; pass++) {
    let movedThisPass = false;
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        const a = pos[i]!;
        const b = pos[j]!;
        let vx = b.x - a.x;
        let vy = b.y - a.y;
        let dist = Math.hypot(vx, vy);
        if (dist >= TWIN_MIN_SEPARATION) continue; // already far enough apart
        if (dist < 1e-6) {
          // Still coincident after the seed (identical subId hash collision is
          // the only way) — pick a stable direction from the pair's subIds.
          const seed = hashSubId(items[i]!.subId + '|' + items[j]!.subId);
          const angle = (seed % 360) * (Math.PI / 180);
          vx = Math.cos(angle);
          vy = Math.sin(angle);
          dist = 1; // unit vector; full shortfall applied below
        } else {
          vx /= dist;
          vy /= dist;
        }
        const shortfall = TWIN_MIN_SEPARATION - dist;
        const half = shortfall / 2;
        a.x -= vx * half;
        a.y -= vy * half;
        b.x += vx * half;
        b.y += vy * half;
        movedThisPass = true;
      }
    }
    if (!movedThisPass) break;
  }

  // Derive the extra offset (final working pos − origin). Only emit non-zero
  // offsets so already-clear twins contribute nothing (true no-op case).
  for (let i = 0; i < pos.length; i++) {
    const dx = pos[i]!.x - origin[i]!.x;
    const dy = pos[i]!.y - origin[i]!.y;
    if (dx !== 0 || dy !== 0) extra.set(items[i]!.subId, { dx, dy });
  }

  return extra;
}

/**
 * Stable string hash for observation subIds (issue #554 silhouette
 * deconflict). Used to derive a NEGATIVE pseudo-`cluster_id` (callers negate
 * the result, e.g. `-hashSubId(subId)`) so silhouette inputs can be carried
 * through `buildGroups` alongside real (positive) supercluster `cluster_id`s
 * without collision. djb2-style. The return value is wrapped through
 * `Math.abs` so negation in the caller produces a deterministic negative id.
 *
 * Extracted from `MapCanvas.tsx` (#888, U4): its negative-pseudo-id contract
 * lives here next to `DeconflictInput.cluster_id` and `buildGroups`, which is
 * where the sign convention is enforced.
 */
export function hashSubId(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

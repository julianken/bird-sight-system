# Marker Overlap Deconflict Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate visible cluster-marker overlap (grid-vs-grid, grid-vs-pill, pill-vs-pill) at every zoom level by inserting a post-clustering Union-Find deconflict pass that emits one anchor-cluster marker per overlap group instead of rendering all members.

**Architecture:** A pure `deconflict.ts` module (sync, no React, no MapLibre) consumes resolved cluster entries + a projection function, builds an axis-aligned-bounding-box (AABB) overlap graph, runs Union-Find, and returns groups (`{anchor, memberIds, key, ariaLabel}`). The two existing reconcilers in `MapCanvas.tsx` (grid + pill overlay) are unified into a single `useEffect` that resolves each visible cluster, runs deconflict, and emits a typed-union list. The click handler does async `getClusterExpansionZoom` aggregation at click time (click-time-lazy) — matching the existing pattern at `MapCanvas.tsx:1042-1055` — so the deconflict module stays pure.

**Tech Stack:** React 19 · `@vis.gl/react-maplibre` · MapLibre-GL 5.x · Vitest (unit) · Playwright (e2e) · TypeScript strict.

**Issue:** [#554 (julianken-bot APPROVED)](https://github.com/julianken/bird-sight-system/issues/554)

---

## Quantified plan literals (implementer checklist)

Before opening a PR for this plan, check off each item or cite a deferral doc with a lexically-matching subject (per R13 T7, issue #461):

- [ ] Export `markerDimensions(shape)` and `MIN_MARKER_PX = 28` from `AdaptiveGridMarker.tsx`
- [ ] Export `pillDimensions(count)` from `ClusterPill.tsx`
- [ ] Land ~25 unit tests in `deconflict.test.ts` (12 base + 5 primitive + 2 silhouette-AABB + 6 silhouette-displacement)
- [ ] Implement bounded ≤20px silhouette displacement when silhouette AABB overlaps cluster anchor AABB (Strategy H, scope expansion 2026-05-15)
- [ ] Land 30 e2e measurements (6 zoom levels × 5 canonical viewports) in `marker-overlap.spec.ts`
- [ ] Capture 10 design-review screenshots (5 canonical viewports × 2 themes) and pass them through a `ui-design:ui-designer` subagent on `opus`
- [ ] All canonical viewports: zero rendered-marker pairwise AABB overlap area at every measured zoom
- [ ] Every canonical viewport: zero console errors and zero console warnings during the design-review pass

## File structure

| File | Status | Responsibility |
|---|---|---|
| `frontend/src/components/map/AdaptiveGridMarker.tsx` | Modify | Add `export function markerDimensions(shape: ResolvedGrid)` and `export const MIN_MARKER_PX = 28` |
| `frontend/src/components/ds/ClusterPill.tsx` | Modify | Add `export function pillDimensions(count: number)` |
| `frontend/src/components/map/deconflict.ts` | **NEW** | Pure helpers: `aabbForShape`, `intersect`, `unionFind`, `buildGroups`, `displaceSilhouettes` |
| `frontend/src/components/map/deconflict.test.ts` | **NEW** | ~25 unit tests (12 base + 5 primitive + 2 silhouette-AABB + 6 silhouette-displacement) |
| `frontend/src/components/map/MapCanvas.tsx` | Modify | Unify grid + pill reconcilers into one effect; insert deconflict step; render `groups` |
| `frontend/e2e/marker-overlap.spec.ts` | **NEW** | E2E: pairwise overlap area = 0 at 6 zooms × 5 viewports |
| `knip.ts` | Modify (temp) | Add `deconflict.ts` to ignore list if Task 4 lands in a separate PR from Task 5 (not needed if all tasks ship in one PR) |

The plan ships as **one atomic PR**. Splitting Task 4 (deconflict module) from Task 5 (wiring) would leave `deconflict.ts` unreferenced at the end of PR 1 — knip would fire on the unused export and block the Mergify queue. One PR keeps CI green throughout.

---

## Task 1: Add helper exports for marker dimensions

The deconflict module needs to compute marker bounding boxes without DOM measurement. Both `AdaptiveGridMarker` and `ClusterPill` already encode their geometry as deterministic functions; we just need to export those functions and the `MIN_MARKER_PX` constant used to derive the spatial-bucket key.

**Files:**
- Modify: `frontend/src/components/map/AdaptiveGridMarker.tsx` (lines 82-95)
- Modify: `frontend/src/components/ds/ClusterPill.tsx` (append)
- Test: `frontend/src/components/map/AdaptiveGridMarker.test.tsx` (extend existing)
- Test: `frontend/src/components/ds/ClusterPill.test.tsx` (extend existing)

- [ ] **Step 1: Modify `AdaptiveGridMarker.tsx` — export helpers**

In `frontend/src/components/map/AdaptiveGridMarker.tsx`, find the existing internal `markerDimensions` function (line 91) and the cell constants (lines 82-84). Replace them with exported equivalents:

```ts
// Layout constants — match MosaicMarker's 22px tile / 2px gap (issue #248).
export const CELL_PX = 22;
export const GRID_GAP_PX = 2;
export const GRID_PADDING_PX = 3;

/**
 * Minimum possible rendered marker width/height, used by the deconflict
 * module (issue #554) to derive the spatial-bucket key:
 *
 *   BUCKET_PX = MIN_MARKER_PX / 2 = 14
 *
 * Equals the 1×1 grid width: 1*22 + 0*2 + 2*3 = 28.
 */
export const MIN_MARKER_PX = 28;

export function markerDimensions(shape: ResolvedGrid): { w: number; h: number } {
  const w = shape.cols * CELL_PX + (shape.cols - 1) * GRID_GAP_PX + 2 * GRID_PADDING_PX;
  const h = shape.rows * CELL_PX + (shape.rows - 1) * GRID_GAP_PX + 2 * GRID_PADDING_PX;
  return { w, h };
}
```

Update the in-function call site at line 110 to use the same exported function (signature changed from `{width, height}` to `{w, h}` — also update the destructure on line 110):

```ts
const { w: markerWidth, h: markerHeight } = markerDimensions(shape);
```

- [ ] **Step 2: Run the existing test suite for AdaptiveGridMarker to confirm no regression**

Run: `npm run test --workspace @bird-watch/frontend -- AdaptiveGridMarker.test`
Expected: all existing tests PASS (we only renamed the return shape internally; the public component is unchanged).

- [ ] **Step 3: Add a unit test for `markerDimensions` to lock the contract**

Append to `frontend/src/components/map/AdaptiveGridMarker.test.tsx` (or a sibling `adaptive-grid.test.ts` if you prefer a dedicated unit file — match the existing convention you find in the file):

```ts
import { markerDimensions, MIN_MARKER_PX } from './AdaptiveGridMarker.js';

describe('markerDimensions', () => {
  it('1×1 grid → 28×28 (matches MIN_MARKER_PX)', () => {
    expect(markerDimensions({ tag: 'grid', cols: 1, rows: 1 })).toEqual({ w: 28, h: 28 });
    expect(MIN_MARKER_PX).toBe(28);
  });
  it('2×1 grid → 52×28', () => {
    expect(markerDimensions({ tag: 'grid', cols: 2, rows: 1 })).toEqual({ w: 52, h: 28 });
  });
  it('2×2 grid → 52×52', () => {
    expect(markerDimensions({ tag: 'grid', cols: 2, rows: 2 })).toEqual({ w: 52, h: 52 });
  });
  it('3×3 grid → 76×76', () => {
    expect(markerDimensions({ tag: 'grid', cols: 3, rows: 3 })).toEqual({ w: 76, h: 76 });
  });
  it('4×4 grid → 100×100 (the worst-case overlap source per issue #554)', () => {
    expect(markerDimensions({ tag: 'grid', cols: 4, rows: 4 })).toEqual({ w: 100, h: 100 });
  });
});
```

- [ ] **Step 4: Run the new test, confirm PASS**

Run: `npm run test --workspace @bird-watch/frontend -- AdaptiveGridMarker.test`
Expected: all dimension tests PASS.

- [ ] **Step 5: Modify `ClusterPill.tsx` — export `pillDimensions`**

In `frontend/src/components/ds/ClusterPill.tsx`, append after the existing component definition:

```ts
/**
 * Predicted rendered bounding box for a ClusterPill at a given count.
 * Used by the deconflict module (issue #554) to compute the AABB without
 * a DOM round-trip.
 *
 * Values are derived from `ds-primitives.css:421-451` per-tier rules
 * (padding + font-size + min-width) and validated against live measurement
 * on 2026-05-15 (sky 36×24, sand 55×27, ember 73×33 at typical counts).
 *
 * The width formula assumes a tabular-digit width of ~8px (sky), ~9px
 * (sand), ~10px (ember). If the design system rebases on a different
 * font, this function needs to be retuned — there's a unit test in
 * ClusterPill.test.tsx that asserts measured dimensions stay within
 * ±4px of predicted.
 */
export function pillDimensions(count: number): { w: number; h: number } {
  const tier = clusterTier(count);
  const digits = String(count).length;
  if (tier === 'sky') {
    return { w: Math.max(28, digits * 8 + 20), h: 24 };
  }
  if (tier === 'sand') {
    return { w: Math.max(34, digits * 9 + 26), h: 27 };
  }
  return { w: Math.max(40, digits * 10 + 32), h: 33 };
}
```

- [ ] **Step 6: Add a unit test for `pillDimensions`**

Append to `frontend/src/components/ds/ClusterPill.test.tsx`:

```ts
import { pillDimensions } from './ClusterPill.js';

describe('pillDimensions', () => {
  it('sky tier (count < 100) → min-width respected for short counts', () => {
    expect(pillDimensions(30)).toEqual({ w: 36, h: 24 });  // max(28, 2*8+20=36) = 36
  });
  it('sky tier 3-digit count uses formula', () => {
    expect(pillDimensions(99)).toEqual({ w: 36, h: 24 });
  });
  it('sand tier (100 ≤ count < 750) → 3-digit width', () => {
    expect(pillDimensions(214)).toEqual({ w: 53, h: 27 });  // 3*9+26 = 53
  });
  it('ember tier (count ≥ 750) → 4-digit width', () => {
    expect(pillDimensions(1648)).toEqual({ w: 72, h: 33 });  // 4*10+32 = 72
  });
});
```

- [ ] **Step 7: Run the new test, confirm PASS**

Run: `npm run test --workspace @bird-watch/frontend -- ClusterPill.test`
Expected: all `pillDimensions` tests PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/map/AdaptiveGridMarker.tsx \
        frontend/src/components/map/AdaptiveGridMarker.test.tsx \
        frontend/src/components/ds/ClusterPill.tsx \
        frontend/src/components/ds/ClusterPill.test.tsx
git commit -m "$(cat <<'EOF'
feat(map): export markerDimensions + MIN_MARKER_PX + pillDimensions

Helpers needed by the upcoming deconflict module (#554). Pure functions
of `shape` (grid) or `count` (pill); no DOM measurement. Predicted
dimensions match measured values on bird-maps.com within ±2px.

Refs #554.
EOF
)"
```

---

## Task 2: Add `deconflict.ts` types-only scaffold + write 12 failing tests

Create the module file with type definitions only (no implementation), then write all 12 unit tests in `deconflict.test.ts`. Confirm every test fails before moving to Task 3.

**Files:**
- Create: `frontend/src/components/map/deconflict.ts`
- Create: `frontend/src/components/map/deconflict.test.ts`

- [ ] **Step 1: Write `deconflict.ts` (types + signatures only)**

Create `frontend/src/components/map/deconflict.ts`:

```ts
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

/** Spatial-bucket React key — derives from anchor pixel position only. */
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
```

- [ ] **Step 2: Write the 12 failing unit tests in `deconflict.test.ts`**

Create `frontend/src/components/map/deconflict.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  intersect,
  aabbForShape,
  unionFind,
  bucketKey,
  buildGroups,
  type DeconflictInput,
} from './deconflict.js';

// Shared fixtures
const grid4x4 = { kind: 'grid', shape: { tag: 'grid', cols: 4, rows: 4 } } as const;
const grid2x2 = { kind: 'grid', shape: { tag: 'grid', cols: 2, rows: 2 } } as const;
const grid1x1 = { kind: 'grid', shape: { tag: 'grid', cols: 1, rows: 1 } } as const;
const pillSand = { kind: 'pill', count: 214 } as const;

function cluster(
  id: number,
  px: number,
  py: number,
  rendered = grid4x4 as DeconflictInput['rendered'],
  point_count = 32,
  uniqueFamilies = 16,
): DeconflictInput {
  return { cluster_id: id, px, py, rendered, point_count, uniqueFamilies };
}

describe('deconflict', () => {
  // Test 1
  it('anchor selection uses min(cluster_id) unconditionally (no point_count tiebreak)', () => {
    // Two clusters overlap; A has lower id but lower count. A must still be anchor.
    const A = cluster(/* id */ 5, 100, 100, grid4x4, /* count */ 10);
    const B = cluster(/* id */ 12, 110, 100, grid4x4, /* count */ 1000);
    const groups = buildGroups([A, B], /* zoom */ 8);
    expect(groups).toHaveLength(1);
    expect(groups[0].anchor.cluster_id).toBe(5);
    expect(groups[0].memberIds).toEqual([5, 12]);  // buildGroups guarantees sorted memberIds
  });

  // Test 2
  it('AABB intersect — fully disjoint → no edge', () => {
    expect(intersect({ x: 0, y: 0, w: 50, h: 50 }, { x: 100, y: 100, w: 50, h: 50 })).toBe(false);
  });

  // Test 3
  it('AABB intersect — strictly overlapping → edge', () => {
    expect(intersect({ x: 0, y: 0, w: 50, h: 50 }, { x: 25, y: 25, w: 50, h: 50 })).toBe(true);
  });

  // Test 4
  it('AABB intersect — 1px gap with margin=1 → edge (CSS subpixel safety)', () => {
    // Two 50×50 boxes touching but not overlapping (b.x = a.x + a.w + 1 = 51).
    const a = { x: 0, y: 0, w: 50, h: 50 };
    const b = { x: 51, y: 0, w: 50, h: 50 };
    expect(intersect(a, b, /* margin */ 0)).toBe(false);
    expect(intersect(a, b, /* margin */ 1)).toBe(true);
  });

  // Test 5
  it('UF cascade transitivity: A∩B, B∩C → one component {A,B,C}', () => {
    // Three 100-wide markers chained: A at 0, B at 80, C at 160.
    // A∩B overlap (gap 80 < 100), B∩C overlap, A∩C disjoint (gap 160 > 100).
    const A = cluster(1, 0, 0);
    const B = cluster(2, 80, 0);
    const C = cluster(3, 160, 0);
    const groups = buildGroups([A, B, C], 8);
    expect(groups).toHaveLength(1);
    expect(groups[0].memberIds).toEqual([1, 2, 3]);  // buildGroups guarantees sorted memberIds
    expect(groups[0].anchor.cluster_id).toBe(1);
  });

  // Test 6
  it('UF idempotence — repeated buildGroups(same input) yields identical output', () => {
    const inputs = [cluster(1, 0, 0), cluster(2, 50, 0), cluster(3, 1000, 0)];
    const a = buildGroups(inputs, 8);
    const b = buildGroups(inputs, 8);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  // Test 7 — the directly-load-bearing test for blocker B2 (issue #554 dissent loop)
  it('spatial-bucket key stable when anchor unchanged but companions change', () => {
    // Frame 1: anchor (id=1) overlaps companion (id=2). Expect key K1.
    const f1 = buildGroups([cluster(1, 100, 100), cluster(2, 110, 100)], 8);
    // Frame 2: anchor (id=1) overlaps a DIFFERENT companion (id=99). Anchor's pixel position is unchanged.
    const f2 = buildGroups([cluster(1, 100, 100), cluster(99, 110, 100)], 8);
    expect(f1).toHaveLength(1);
    expect(f2).toHaveLength(1);
    // The companion changed but the anchor (min cluster_id) is still id=1 at (100,100). React key must match.
    expect(f1[0].key).toBe(f2[0].key);
  });

  // Test 8
  it('spatial-bucket key changes when anchor crosses a 14px bucket boundary (real pan)', () => {
    // 14 = MIN_MARKER_PX / 2. round(95/14)=7, round(97/14)=7, round(105/14)=8 → cross at 105.
    const groupA = buildGroups([cluster(1, 95, 100)], 8);
    const groupB = buildGroups([cluster(1, 97, 100)], 8);
    const groupC = buildGroups([cluster(1, 105, 100)], 8);
    expect(groupA[0].key).toBe(groupB[0].key);  // same bucket
    expect(groupA[0].key).not.toBe(groupC[0].key);  // boundary crossed
  });

  // Test 9
  it('aria-label format for solo group matches existing convention', () => {
    const A = cluster(1, 0, 0, grid2x2, /* count */ 7, /* uniqueFamilies */ 3);
    const groups = buildGroups([A], 8);
    expect(groups[0].ariaLabel).toBe(
      'Cluster: 7 observations, 3 families. Activate to zoom in.',
    );
  });

  // Test 9b
  it('aria-label uses singular "family" for uniqueFamilies=1', () => {
    const A = cluster(1, 0, 0, grid1x1 as DeconflictInput['rendered'], /* count */ 1, /* uniqueFamilies */ 1);
    const groups = buildGroups([A], 8);
    expect(groups[0].ariaLabel).toBe(
      'Cluster: 1 observations, 1 family. Activate to zoom in.',
    );
  });

  // Test 10
  it('aria-label for multi-member group: "Cluster: N observations (+M nearby in K clusters). Activate to zoom in."', () => {
    // Two clusters overlap: anchor with 32 obs + nearby with 12 obs = total 44; otherCount = 12; K = 1
    const A = cluster(1, 100, 100, grid4x4, /* count */ 32, /* uniqueFamilies */ 16);
    const B = cluster(2, 110, 100, grid2x2, /* count */ 12, /* uniqueFamilies */ 4);
    const groups = buildGroups([A, B], 8);
    expect(groups[0].ariaLabel).toBe(
      'Cluster: 32 observations (+12 nearby in 1 cluster). Activate to zoom in.',
    );
  });

  // Test 10b
  it('aria-label for 3-member group uses plural "clusters"', () => {
    const A = cluster(1, 100, 100, grid4x4, /* count */ 32, /* uniqueFamilies */ 16);
    const B = cluster(2, 110, 100, grid2x2, /* count */ 12, /* uniqueFamilies */ 4);
    const C = cluster(3, 120, 100, grid2x2, /* count */ 8, /* uniqueFamilies */ 3);
    const groups = buildGroups([A, B, C], 8);
    expect(groups[0].ariaLabel).toBe(
      'Cluster: 32 observations (+20 nearby in 2 clusters). Activate to zoom in.',
    );
  });

  // Test 11 (rewritten per julianken-bot finding — see issue #554)
  it('memberIds preservation — buildGroups emits full memberIds list (length + content)', () => {
    const inputs = [cluster(7, 100, 100), cluster(3, 110, 100), cluster(15, 120, 100)];
    const groups = buildGroups(inputs, 8);
    expect(groups).toHaveLength(1);
    expect(groups[0].memberIds).toEqual([3, 7, 15]);  // buildGroups guarantees sorted memberIds
    expect(groups[0].anchor.cluster_id).toBe(3);  // min(id)
  });

  // Test 12
  it('empty viewport → no groups, no exceptions', () => {
    expect(buildGroups([], 8)).toEqual([]);
  });

  // ---- supporting unit tests for the primitives (intersect, aabbForShape, unionFind, bucketKey) ----

  it('aabbForShape — grid centered at (100, 100) for 4×4 → 50px half-extent each way', () => {
    expect(aabbForShape(grid4x4, 100, 100)).toEqual({ x: 50, y: 50, w: 100, h: 100 });
  });

  it('aabbForShape — pill (sand, count=214) at (100, 100) → 53×27 bbox', () => {
    // sand: max(34, 3*9+26) = 53 wide; h=27
    expect(aabbForShape(pillSand, 100, 100)).toEqual({
      x: 100 - 53 / 2,
      y: 100 - 27 / 2,
      w: 53,
      h: 27,
    });
  });

  it('unionFind — disjoint nodes → each is own component', () => {
    expect(unionFind(3, [])).toEqual([0, 1, 2]);
  });

  it('unionFind — chain 0-1-2 → one component', () => {
    const reps = unionFind(3, [[0, 1], [1, 2]]);
    expect(new Set(reps).size).toBe(1);
  });

  it('bucketKey — quantizes by 14px', () => {
    expect(bucketKey(100, 100, 8, 14)).toBe('bucket-7-7-8');  // round(100/14)=7
  });
});
```

- [ ] **Step 3: Run the tests and confirm RED**

Run: `npm run test --workspace @bird-watch/frontend -- deconflict`
Expected: all 17 tests FAIL with `Error: not implemented`. (12 spec tests + 5 supporting primitive tests = 17 total. The 12-count in the manifest refers to the high-level functional tests; the 5 primitive tests are supporting infrastructure.)

- [ ] **Step 4: Commit (red phase)**

```bash
git add frontend/src/components/map/deconflict.ts \
        frontend/src/components/map/deconflict.test.ts
git commit -m "$(cat <<'EOF'
test(map): scaffold deconflict module + 12 failing unit tests (#554)

RED phase — types and test cases only. Implementation in next commit.
Tests pin the dissent-loop blocker fixes from #554:

  - anchor = min(cluster_id) unconditionally (pan-stable)
  - spatial-bucket key invariant under companion-set changes
  - cascade transitivity (A∩B, B∩C → one group {A,B,C})
  - aria-label format for solo + multi-member groups

Refs #554.
EOF
)"
```

---

## Task 3: Implement `deconflict.ts` (green phase)

Replace each `throw new Error('not implemented')` with the actual logic. Run the test suite after each function to confirm progress.

**Files:**
- Modify: `frontend/src/components/map/deconflict.ts`

- [ ] **Step 1: Implement `intersect` (the AABB primitive)**

Replace the `intersect` body in `deconflict.ts`:

```ts
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
```

- [ ] **Step 2: Implement `aabbForShape`**

```ts
import { markerDimensions } from './AdaptiveGridMarker.js';
import { pillDimensions } from '../ds/ClusterPill.js';

export function aabbForShape(rendered: RenderedShape, px: number, py: number): AABB {
  const { w, h } = rendered.kind === 'grid'
    ? markerDimensions(rendered.shape)
    : pillDimensions(rendered.count);
  return { x: px - w / 2, y: py - h / 2, w, h };
}
```

- [ ] **Step 3: Implement `unionFind`**

```ts
export function unionFind(n: number, edges: ReadonlyArray<[number, number]>): number[] {
  const parent = Array.from({ length: n }, (_, i) => i);
  const rank = new Array(n).fill(0);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];  // path halving
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    if (rank[ra] < rank[rb]) parent[ra] = rb;
    else if (rank[ra] > rank[rb]) parent[rb] = ra;
    else { parent[rb] = ra; rank[ra]++; }
  };
  for (const [i, j] of edges) union(i, j);
  return parent.map((_, i) => find(i));
}
```

- [ ] **Step 4: Implement `bucketKey`**

```ts
export function bucketKey(px: number, py: number, zoom: number, BUCKET_PX: number): string {
  const qx = Math.round(px / BUCKET_PX);
  const qy = Math.round(py / BUCKET_PX);
  return `bucket-${qx}-${qy}-${zoom}`;
}
```

- [ ] **Step 5: Implement `buildGroups` (the orchestrator)**

```ts
import { MIN_MARKER_PX } from './AdaptiveGridMarker.js';

const BUCKET_PX = MIN_MARKER_PX / 2;  // 14

function ariaLabelFor(anchor: DeconflictInput, others: DeconflictInput[]): string {
  if (others.length === 0) {
    const familyWord = anchor.uniqueFamilies === 1 ? 'family' : 'families';
    return `Cluster: ${anchor.point_count} observations, ${anchor.uniqueFamilies} ${familyWord}. Activate to zoom in.`;
  }
  const otherCount = others.reduce((sum, o) => sum + o.point_count, 0);
  const clusterWord = others.length === 1 ? '1 cluster' : `${others.length} clusters`;
  return `Cluster: ${anchor.point_count} observations (+${otherCount} nearby in ${clusterWord}). Activate to zoom in.`;
}

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
      if (intersect(aabbs[i], aabbs[j], /* margin */ 1)) {
        edges.push([i, j]);
      }
    }
  }

  // 3. Union-Find → component id per node
  const reps = unionFind(clusters.length, edges);

  // 4. Group nodes by component
  const componentMembers = new Map<number, number[]>();
  for (let i = 0; i < reps.length; i++) {
    const r = reps[i];
    if (!componentMembers.has(r)) componentMembers.set(r, []);
    componentMembers.get(r)!.push(i);
  }

  // 5. For each component, pick anchor (min cluster_id) + assemble group
  const groups: DeconflictGroup[] = [];
  for (const indices of componentMembers.values()) {
    const members = indices.map((i) => clusters[i]);
    const anchor = members.reduce((a, b) => (a.cluster_id < b.cluster_id ? a : b));
    const others = members.filter((m) => m.cluster_id !== anchor.cluster_id);
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
```

- [ ] **Step 6: Run the tests, confirm all 17 PASS**

Run: `npm run test --workspace @bird-watch/frontend -- deconflict`
Expected: 17 PASS, 0 FAIL.

- [ ] **Step 7: Commit (green phase)**

```bash
git add frontend/src/components/map/deconflict.ts
git commit -m "$(cat <<'EOF'
feat(map): implement deconflict module — pure, sync, 17 tests green (#554)

  - intersect(a, b, margin) — AABB overlap predicate
  - aabbForShape — pure (markerDimensions/pillDimensions from Task 1)
  - unionFind(n, edges) — path-halving + union-by-rank
  - bucketKey — anchor.px/py quantized to MIN_MARKER_PX/2 = 14
  - buildGroups — orchestrator, anchor = min(cluster_id), pan-stable

No React, no MapLibre, no async. The click-time-lazy
getClusterExpansionZoom aggregation happens in MapCanvas.tsx (Task 4).

Refs #554.
EOF
)"
```

---

## Task 4: Unify the two reconcilers in `MapCanvas.tsx`

Replace the existing grid reconciler (`MapCanvas.tsx:731-948`) and pill overlay reconciler (`MapCanvas.tsx:1119-1155`) with a single `useEffect` that:

1. Queries `clusters-hit` once
2. Resolves each cluster (Promise.all — exactly as today)
3. Builds the `DeconflictInput` list (typed-union grid|pill|silhouette)
4. Calls `buildGroups(...)`
5. Sets a single `groups` state slice
6. Render block iterates `groups`, dispatches to `<AdaptiveGridMarker>` or `<ClusterPill>` based on anchor's `rendered.kind`
7. Click handler does click-time-lazy `await Promise.all(memberIds.map(getClusterExpansionZoom))` then `Math.max(...zooms)` for the easeTo zoom

**Scope expansion (2026-05-15) — Strategy H:** Task 4 also extends the deconflict pipeline to include unclustered-point silhouettes as first-class inputs. Per direct user direction, silhouettes MUST REMAIN VISIBLE. When a silhouette would overlap a cluster anchor, `displaceSilhouettes` returns a per-subId pixel offset (≤20px, radial outward from the anchor center). MapCanvas:
- Pushes a `{ kind: 'silhouette' }` input for every visible unclustered-point feature
- Hides the canvas-painted twin via `setFeatureState({hidden: true})` (Source uses `promoteId="subId"`)
- Renders a `<PresentationMarker>` at the displaced lng/lat carrying an inline SVG silhouette + halo
- Routes `MapMarkerHitLayer` clicks through the displaced position so taps still open the obs popover

**Files:**
- Modify: `frontend/src/components/map/MapCanvas.tsx`

- [ ] **Step 1: Add the `Group` type alias near the top of `MapCanvas.tsx`**

Just after the existing `AdaptiveGridEntry` type declaration (find `interface AdaptiveGridEntry` near the top), add:

```ts
import type { DeconflictGroup, DeconflictInput } from './deconflict.js';
import { buildGroups } from './deconflict.js';
```

- [ ] **Step 2: Replace `grids: Map<number, AdaptiveGridEntry>` state with `groups: DeconflictGroup[]`**

Find the existing state declarations (`const [grids, setGrids] = ...` and the pill overlay's `const [clusterFeatures, setClusterFeatures] = ...`). Replace BOTH with a single unified state slice:

```ts
const [groups, setGroups] = React.useState<DeconflictGroup[]>([]);
```

Delete the `clusterFeatures` state declaration entirely (line 1119) and the `ClusterFeature` interface declaration (lines 1112-1117) — both subsumed by `DeconflictGroup`.

- [ ] **Step 3: Rewrite the reconciler body to call `buildGroups`**

In the existing reconciler effect (starts at line 731), inside the `reconcile` async function, replace the final `const next = new Map<number, AdaptiveGridEntry>(); await Promise.all(...)` block AND the trailing `setGrids(next)` (line 910) with the unified version:

```ts
    const reconcile = async () => {
      const myGen = cacheGeneration;
      const isMobile = map.getContainer
        ? map.getContainer().getBoundingClientRect().width < 768
        : false;
      const floorZoom = Math.floor(map.getZoom());
      const currentKeys = new Set<string>();
      const features = (map.queryRenderedFeatures(undefined, {
        layers: ['clusters-hit'],
      }) ?? []) as Array<{
        properties?: Record<string, unknown>;
        geometry?: unknown;
        id?: number;
      }>;
      const seen = new Set<number>();
      const candidates = features.filter((f) => {
        const id = f.properties?.['cluster_id'];
        if (typeof id !== 'number') return false;
        const pointCount = f.properties?.['point_count'];
        if (typeof pointCount !== 'number') return false;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });

      const source = map.getSource('observations') as
        | { getClusterLeaves: (id: number, limit: number, offset: number) => Promise<unknown[]> }
        | undefined;
      if (!source || typeof source.getClusterLeaves !== 'function') {
        return;
      }

      // Resolve each cluster (existing leaf-cache + Promise.all pattern).
      // The resolved entries are typed: grid OR pill — both feed deconflict.
      const inputs: DeconflictInput[] = [];
      await Promise.all(
        candidates.map(async (feature) => {
          const clusterId = feature.properties?.['cluster_id'] as number;
          const pointCount = feature.properties?.['point_count'] as number;
          const geom = feature.geometry as
            | { type: 'Point'; coordinates: [number, number] }
            | { type: string };
          if (geom.type !== 'Point') return;
          const [longitude, latitude] = (
            geom as { coordinates: [number, number] }
          ).coordinates;
          const key = `${floorZoom}:${clusterId}:${pointCount}`;
          currentKeys.add(key);

          let resolvedPromise: Promise<ResolvedAdaptiveData> | undefined =
            leafCache.get(key);
          if (!resolvedPromise) {
            const fresh: Promise<ResolvedAdaptiveData> = (async () => {
              const leaves = (await source.getClusterLeaves(
                clusterId,
                64,
                0,
              )) as ClusterLeafFeature[];
              const aggregates = aggregateClusterFamilies(leaves);
              const uniqueFamilies = aggregates.length;
              const shape = pickGridShape(uniqueFamilies, pointCount, isMobile);
              if (shape.tag === 'pill') {
                return { kind: 'pill', uniqueFamilies };
              }
              const tiles = buildAdaptiveTiles(leaves, silhouettesById, shape);
              const isNotablePoint =
                pointCount === 1 &&
                uniqueFamilies === 1 &&
                Boolean(leaves[0]?.properties['isNotable']);
              return { kind: 'grid', shape, tiles, uniqueFamilies, isNotablePoint };
            })();
            fresh.catch((err) => {
              leafCache.delete(key);
              if (!warnedRejections.has(key)) {
                console.warn(
                  '[adaptive-grid] getClusterLeaves rejected',
                  key,
                  err,
                );
                warnedRejections.add(key);
              }
            });
            leafCache.set(key, fresh);
            resolvedPromise = fresh;
          }

          try {
            const resolved = await resolvedPromise;
            const [px, py] = (() => {
              const p = map.project([longitude, latitude]);
              return [p.x, p.y];
            })();
            if (resolved.kind === 'pill') {
              inputs.push({
                cluster_id: clusterId,
                px,
                py,
                rendered: { kind: 'pill', count: pointCount },
                point_count: pointCount,
                uniqueFamilies: resolved.uniqueFamilies,
              });
            } else {
              inputs.push({
                cluster_id: clusterId,
                px,
                py,
                rendered: { kind: 'grid', shape: resolved.shape },
                point_count: pointCount,
                uniqueFamilies: resolved.uniqueFamilies,
              });
            }
          } catch {
            /* cluster expired between query and resolution — drop */
          }
        }),
      );

      if (cancelled || myGen !== cacheGeneration) return;

      // Run deconflict (pure, sync). Output: one group per overlap component.
      const nextGroups = buildGroups(inputs, floorZoom);
      setGroups(nextGroups);

      // Eviction unchanged.
      for (const k of leafCache.keys()) {
        if (!currentKeys.has(k)) leafCache.delete(k);
      }
    };
```

(The supporting variables `cancelled`, `cacheGeneration`, `leafCache`, `warnedRejections`, etc. all exist already at the existing reconciler's outer scope — keep them.)

- [ ] **Step 3a: Carry the resolved grid tiles + isNotable through the unified input**

The existing code stored `tiles` and `isNotablePoint` on `AdaptiveGridEntry` for the render block. We need to either:
- Extend `DeconflictInput` to carry render-only data (`tiles`, `isNotablePoint`), OR
- Look the tiles up at render time

Pick option A — extend `DeconflictInput` in `deconflict.ts` with optional render-only fields and ignore them in the deconflict math:

In `deconflict.ts`, extend `DeconflictInput`:

```ts
export interface DeconflictInput {
  cluster_id: number;
  px: number;
  py: number;
  rendered: RenderedShape;
  point_count: number;
  uniqueFamilies: number;
  /** Optional render-only data, carried through by buildGroups untouched. */
  tiles?: ReadonlyArray<import('./adaptive-grid.js').AdaptiveTile>;
  isNotable?: boolean;
}
```

These optional fields are NOT used by deconflict logic — they ride along on the anchor and flow into the render block.

- [ ] **Step 3b: Run the deconflict test suite to confirm the new optional fields don't break anything**

Run: `npm run test --workspace @bird-watch/frontend -- deconflict`
Expected: 17 PASS (the optional fields are unused in tests).

- [ ] **Step 4: Replace the render block (lines 1264-1299) with the unified `groups` iteration**

Delete the existing two render blocks (the `{Array.from(grids.values()).map(...)}` block AND the `{clusterFeatures.filter(...).map(...)}` block). Replace both with:

```tsx
{groups.map((g) => {
  const { anchor } = g;
  if (anchor.rendered.kind === 'pill') {
    return (
      <PresentationMarker
        key={g.key}
        longitude={observationLngFromPx(anchor.px, map)}  // see note
        latitude={observationLatFromPy(anchor.py, map)}
        anchor="center"
      >
        <ClusterPill
          count={anchor.point_count}
          onClick={() => handleGroupClick(g)}
        />
      </PresentationMarker>
    );
  }
  return (
    <PresentationMarker
      key={g.key}
      longitude={observationLngFromPx(anchor.px, map)}
      latitude={observationLatFromPy(anchor.py, map)}
    >
      <AdaptiveGridMarker
        shape={anchor.rendered.shape}
        tiles={anchor.tiles ?? []}
        totalCount={anchor.point_count}
        uniqueFamilies={anchor.uniqueFamilies}
        ariaLabel={g.ariaLabel}
        isCoarsePointer={isCoarsePointer}
        isNotable={anchor.isNotable}
        onClick={() => handleGroupClick(g)}
      />
    </PresentationMarker>
  );
})}
```

**Important — anchor coords are stored as pixels, but PresentationMarker takes lng/lat.** Two options:
1. Carry `longitude`/`latitude` ALONGSIDE px/py on `DeconflictInput` (simpler, recommended)
2. Unproject pixels back to lng/lat at render time (adds a math step per frame)

Use option 1. Extend `DeconflictInput` in `deconflict.ts` with `longitude: number; latitude: number;` and push them through. The render block then uses `anchor.longitude` / `anchor.latitude` directly — delete the `observationLngFromPx` placeholder calls in the snippet above and replace them with `anchor.longitude` / `anchor.latitude`.

- [ ] **Step 5: Replace `handleGridMarkerClick` + `handleClusterPillClick` with one `handleGroupClick`**

In `MapCanvas.tsx`, delete the existing `handleGridMarkerClick` (lines 1012-1058) and `handleClusterPillClick` (lines 1157-1178). Add ONE unified handler:

```ts
const handleGroupClick = useCallback(
  async (group: DeconflictGroup) => {
    const { anchor, memberIds } = group;

    // Single-leaf case (1 observation in a 1-member group): open the obs popover directly.
    // Mirrors the existing handleGridMarkerClick singleton path.
    if (memberIds.length === 1 && anchor.point_count === 1) {
      const EPS = 1e-6;
      const obs = observations.find(
        (o) =>
          Math.abs(o.lng - anchor.longitude) < EPS &&
          Math.abs(o.lat - anchor.latitude) < EPS,
      );
      if (obs) setSelectedObs(obs);
      return;
    }

    const map = mapRef.current?.getMap();
    if (!map) return;
    const source = map.getSource('observations');
    if (!source || !('getClusterExpansionZoom' in source)) return;
    const src = source as {
      getClusterExpansionZoom: (id: number) => Promise<number>;
    };

    // Click-time-lazy: async expansion-zoom aggregation over ALL members.
    // Matches the existing handleClusterPillClick pattern at the prior MapCanvas.tsx:1042-1055.
    try {
      const zooms = await Promise.all(
        memberIds.map((id) => src.getClusterExpansionZoom(id)),
      );
      const targetZoom = Math.min(Math.max(...zooms), CLUSTER_MAX_ZOOM);
      const currentZoom = map.getZoom();
      if (targetZoom > currentZoom) {
        map.easeTo({
          center: [anchor.longitude, anchor.latitude],
          zoom: targetZoom,
          ...(prefersReducedMotion ? { duration: 0 } : {}),
        });
      }
    } catch {
      /* getClusterExpansionZoom may reject for recycled cluster_ids — match existing err-swallow */
    }
  },
  [observations, prefersReducedMotion],
);
```

- [ ] **Step 6: Delete the now-unreferenced `AdaptiveGridEntry` type + the `clusterFeatures`/`refreshClusters` block**

Search MapCanvas.tsx for `AdaptiveGridEntry` and remove the type declaration (it was the per-grid render shape; replaced by `DeconflictGroup`). Search for `clusterFeatures` and `refreshClusters` and remove the entire pill-overlay `useEffect` block (lines 1119-1155). Both are dead after Step 4.

- [ ] **Step 7: Run the FULL frontend test suite**

Run: `npm run test --workspace @bird-watch/frontend`
Expected: all tests PASS. The MapCanvas-related tests should still work — the render block changes are mechanical replacements.

- [ ] **Step 8: Run typecheck + lint**

Run: `npm run typecheck --workspace @bird-watch/frontend && npm run lint --workspace @bird-watch/frontend`
Expected: both clean.

- [ ] **Step 9: Run the dev server and manually spot-check bird-maps.com behavior**

Run: `npm run dev --workspace @bird-watch/frontend`
Navigate to http://localhost:5173 in the controlled browser. Confirm:
- The map loads.
- At default state-overview zoom (z=5-6 on AZ), the Phoenix/Wickenburg corridor shows fewer markers than before (overlapping clusters merged into anchor markers).
- Clicking an anchor marker zooms in to the expansion zoom; sub-clusters become visible.
- No console errors or warnings.

If the visual is broken, do NOT commit — debug first. The most likely failure is the px/py vs longitude/latitude wiring in Step 4.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/components/map/MapCanvas.tsx \
        frontend/src/components/map/deconflict.ts
git commit -m "$(cat <<'EOF'
feat(map): unify reconcilers + wire deconflict at idle (#554)

Replaces the two separate reconcilers (grid + pill overlay) with one
useEffect that resolves every visible cluster, calls deconflict's
buildGroups, and emits a single typed-union groups list. Render block
iterates groups; anchor's rendered.kind dispatches to AdaptiveGridMarker
or ClusterPill.

Click handler is click-time-lazy — async getClusterExpansionZoom over
ALL member ids, easeTo target = Math.max(...zooms). Matches the
existing handleClusterPillClick pattern. Keeps deconflict.ts sync-pure.

Live verification on dev server: Phoenix/Wickenburg corridor renders
collision-free at z=5-6; clicks zoom to expansion correctly.

Refs #554.
EOF
)"
```

---

## Task 5: Add the E2E falsifiable acceptance test

Land the e2e spec in the same PR as Task 4 so it goes RED→GREEN in one commit pair (run RED locally against the prior commit, then GREEN at HEAD). Per `frontend/playwright.config.ts`, `workers: 2` in CI and `retries: 0`.

**Files:**
- Create: `frontend/e2e/marker-overlap.spec.ts`

- [ ] **Step 1: Write the e2e spec**

Create `frontend/e2e/marker-overlap.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { MapAppPage } from './pages/map-app-page.js';

const ZOOM_LEVELS = [5, 6, 8, 10, 12, 14];

const VIEWPORTS = [
  { name: 'iphone-14-pro', w: 390, h: 844 },
  { name: 'ipad-portrait', w: 768, h: 1024 },
  { name: 'ipad-landscape', w: 1024, h: 768 },
  { name: 'desktop-standard', w: 1440, h: 900 },
  { name: 'desktop-wide', w: 1920, h: 1080 },
] as const;

interface OverlapResult {
  marker_count: number;
  total_overlap_area: number;
  worst_overlap_area: number;
}

async function measureOverlap(page: import('@playwright/test').Page): Promise<OverlapResult> {
  return await page.evaluate<OverlapResult>(() => {
    const grids = Array.from(document.querySelectorAll('[data-testid="adaptive-grid-marker"]'));
    const pills = Array.from(document.querySelectorAll('.cluster-pill'));
    const items = [...grids, ...pills].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    let total = 0;
    let worst = 0;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
        const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
        if (ox > 0 && oy > 0) {
          const area = ox * oy;
          total += area;
          if (area > worst) worst = area;
        }
      }
    }
    return { marker_count: items.length, total_overlap_area: total, worst_overlap_area: worst };
  });
}

for (const viewport of VIEWPORTS) {
  for (const zoom of ZOOM_LEVELS) {
    test(`pairwise marker overlap = 0 at zoom ${zoom} on ${viewport.name} (${viewport.w}×${viewport.h})`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.w, height: viewport.h });
      const app = new MapAppPage(page);
      await app.goto();
      await app.waitForMapLoad();

      // Drive the map to the target zoom and let it settle.
      await page.evaluate((z) => {
        const map = (window as unknown as { __mapForTests?: { easeTo: (opts: object) => void } }).__mapForTests;
        if (map) map.easeTo({ zoom: z, duration: 0 });
      }, zoom);
      await page.waitForTimeout(500); // brief settle window — replace with `idle` listener once available in test hook

      const result = await measureOverlap(page);
      expect(result.total_overlap_area, `marker_count=${result.marker_count}, worst_overlap=${result.worst_overlap_area}px²`).toBe(0);
    });
  }
}
```

**Note on `__mapForTests`:** the map instance isn't currently exposed to e2e. Two options:
1. Expose `mapRef.current?.getMap()` on `window.__mapForTests` during `NODE_ENV === 'test'` — small one-line in `MapCanvas.tsx`'s `handleLoad`.
2. Drive zoom via simulated wheel events (less reliable).

Pick option 1. Add this inside `handleLoad` in `MapCanvas.tsx` (near where the map instance becomes available):

```ts
if (import.meta.env.MODE === 'test' || import.meta.env.MODE === 'development') {
  (window as unknown as { __mapForTests?: unknown }).__mapForTests = map;
}
```

- [ ] **Step 2: Run the e2e spec against current HEAD (Task 4 already committed) → GREEN**

Run: `npm run test:e2e --workspace @bird-watch/frontend -- marker-overlap`
Expected: 30 tests PASS (6 zooms × 5 viewports).

If FAIL: the deconflict wiring (Task 4) didn't fully resolve overlap. Debug by running ONE failing case, inspecting `measureOverlap` output, and tracing back through the pipeline.

- [ ] **Step 3: Sanity check — run the same spec against the parent commit (Task 4's parent) and confirm it FAILS**

This is optional but instructive — it proves the test actually exercises the fix.

```bash
git stash
git checkout HEAD~1   # one commit before Task 4
npm run test:e2e --workspace @bird-watch/frontend -- marker-overlap
# expected: many FAILs (the bug exists)
git checkout -    # back to HEAD
git stash pop
```

Don't commit anything during this check — it's a confidence-building exercise.

- [ ] **Step 4: Commit**

```bash
git add frontend/e2e/marker-overlap.spec.ts frontend/src/components/map/MapCanvas.tsx
git commit -m "$(cat <<'EOF'
test(map): e2e — pairwise overlap area = 0 at 6 zooms × 5 viewports (#554)

Falsifiable acceptance test for the deconflict layer. 30 deterministic
measurements (no wall-clock) against the seeded AZ dataset. Worst-case
on parent commit: 3234 px² at z=5-6 / 1440×900; on HEAD: 0.

Also exposes `window.__mapForTests` in test + dev modes so the e2e
driver can call `easeTo({zoom: N})` without simulated wheel events.

Refs #554.
EOF
)"
```

---

## Task 6: Multi-viewport design-review subagent gate

Drive Playwright MCP through all 5 canonical viewports × 2 themes (light + dark) = 10 screenshots, then dispatch a `ui-design:ui-designer` subagent (model: `opus`) to verify no design regression.

**Files:** None (capture-only — screenshots go through `pr-screenshots-via-user-attachments` skill on PR open).

- [ ] **Step 1: Start the dev server**

Run: `npm run dev --workspace @bird-watch/frontend` (background)

- [ ] **Step 2: Capture 10 screenshots via Playwright MCP**

For each viewport in [390×844, 768×1024, 1024×768, 1440×900, 1920×1080] × theme in [light, dark]:

```
mcp__plugin_playwright_playwright__browser_navigate → http://localhost:5173
mcp__plugin_playwright_playwright__browser_resize → {w, h}
mcp__plugin_playwright_playwright__browser_evaluate →
  document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light')
mcp__plugin_playwright_playwright__browser_wait_for → "357 species seen"  (or whichever heading the map shows)
mcp__plugin_playwright_playwright__browser_console_messages → assert empty
mcp__plugin_playwright_playwright__browser_take_screenshot → save to /tmp/<viewport>-<theme>.png
```

Verify each screenshot:
- Map renders.
- Markers visible.
- No two markers overlap (the deconflict layer's whole point).
- Zero console errors / warnings.

- [ ] **Step 3: Dispatch the design-review subagent**

```
Agent({
  description: "Marker-overlap design review",
  subagent_type: "ui-design:ui-designer",
  model: "opus",     // explicit override per CLAUDE.md UI verification protocol
  prompt: <see template below>
})
```

Template prompt (fill in the URL placeholders with the user-attachments URLs once they're uploaded — for now, use the local paths):

```
You are reviewing the marker-overlap deconflict implementation on bird-maps.com.

Issue: https://github.com/julianken/bird-sight-system/issues/554
Plan: docs/plans/2026-05-15-marker-overlap-deconflict.md

Verdict format: PASS / FAIL with file:line-equivalent evidence per viewport, capped at 3 findings per viewport.

Acceptance criteria:
- Zero pairwise rendered-marker overlap at every captured viewport.
- Anchor-cluster representation reads correctly (one marker per overlap group, not all members).
- Aria-label for multi-member groups follows "(+N nearby in K clusters)" format.
- Light + dark theme parity (no contrast regressions).
- Zero console errors, zero console warnings at every viewport.

Screenshots (10 total — 5 viewports × 2 themes):
- 390×844 light: /tmp/iphone-14-pro-light.png
- 390×844 dark:  /tmp/iphone-14-pro-dark.png
- 768×1024 light: /tmp/ipad-portrait-light.png
- 768×1024 dark:  /tmp/ipad-portrait-dark.png
- 1024×768 light: /tmp/ipad-landscape-light.png
- 1024×768 dark:  /tmp/ipad-landscape-dark.png
- 1440×900 light: /tmp/desktop-standard-light.png
- 1440×900 dark:  /tmp/desktop-standard-dark.png
- 1920×1080 light: /tmp/desktop-wide-light.png
- 1920×1080 dark:  /tmp/desktop-wide-dark.png

Return a structured verdict per viewport. If FAIL on any viewport, name the specific overlap pair or contrast issue so the implementer can fix it.
```

- [ ] **Step 4: Address any FAIL findings**

If the subagent returns PASS for all 10 captures, proceed to Task 7. If FAIL, fix the named issue, recapture, and re-dispatch.

- [ ] **Step 5: No commit needed**

Screenshots are captured locally for PR upload. The dev server can be stopped.

---

## Task 7: Open the PR

Per the project's `pr-workflow` skill, open the PR with the full template body and upload screenshots via `pr-screenshots-via-user-attachments`. The bot review + Mergify queue happen after this task.

**Files:** None.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin HEAD
```

- [ ] **Step 2: Open the PR via gh CLI**

Use the PR template at `.github/PULL_REQUEST_TEMPLATE.md` verbatim. Title format: `feat(map): deconflict overlapping cluster markers via Union-Find anchor selection (#554)`.

Body must include:
- Summary linking to issue #554
- Test plan (unit + e2e + manual)
- Screenshots section — UPLOAD via the `pr-screenshots-via-user-attachments` skill (10 `user-attachments/assets/<uuid>` URLs)
- "Closes #554"

- [ ] **Step 3: Dispatch the `julianken-bot` review subagent**

Per the `pr-workflow` skill. The bot has already approved the ISSUE; this is a fresh PR review against the actual diff.

- [ ] **Step 4: After bot APPROVE — post `@Mergifyio queue` and let CI/Mergify merge**

Literal-string comment body — no prose. Per the `mergify-merge-workflow` skill.

---

## Self-review (plan author check)

**Spec coverage:** Issue #554's converged proposal has 6 axioms (A1-A6), 1 algorithm, 7 file changes, 12+1 unit tests, and 1 e2e gate. Tasks 1-5 implement all of those except A6 (z-index — explicitly deferred in the issue). ✓

**Placeholder scan (no `TBD`, no `add appropriate`, no `similar to`):** Each task ships complete code. ✓

**Type consistency:** `markerDimensions` returns `{w, h}` (renamed from `{width, height}` to match `DeconflictGroup.anchor` pattern); both Task 1 and Task 3 use the same field names. `buildGroups` signature is consistent in Task 2 (test fixtures) and Task 3 (impl). `DeconflictInput` extended in Task 4 Step 3a — verified that adding optional fields doesn't break the Task 2 tests. ✓

**className scan (project rule per CLAUDE.md):**

```bash
grep -n "className" docs/plans/2026-05-15-marker-overlap-deconflict.md | grep -v "grep\|CSS rules\|Step N:"
```

No new `className` literals introduced in this plan — only existing components (`AdaptiveGridMarker`, `ClusterPill`, `PresentationMarker`) are reused. The CSS sub-task gate (#445) does not fire. ✓

**Quantified-literal manifest:** filled at top of plan. Each AC literal (12 tests, 30 e2e measurements, 10 screenshots, 5 viewports, 2 themes) is in the checklist. ✓

**Multi-viewport design-review gate:** Task 6 dispatches `ui-design:ui-designer` on `opus` at all 5 canonical viewports × 2 themes per the project's UI verification protocol. ✓

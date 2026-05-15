/**
 * Adaptive cluster-grid logic for the `<AdaptiveGridMarker>` component
 * (epic #539, spec `docs/specs/2026-05-14-adaptive-cluster-grid-design.md`).
 *
 * This module is the pure-logic + types layer that backs the marker.
 * Phase 1A scope: branded `PositiveInt`, the `GridShape` discriminated
 * union, `pickGridShape` encoding the §4.1 sizing-rules table, and
 * `visibleCapacity`. `buildAdaptiveTiles` + `aggregateClusterFamilies`
 * land in the next commit.
 */

export type PositiveInt = number & { readonly __brand: 'PositiveInt' };

export function toPositiveInt(n: number): PositiveInt {
  if (!Number.isInteger(n) || n < 1) {
    throw new TypeError(`Expected a positive integer, got ${n}. Value must be a positive integer.`);
  }
  return n as PositiveInt;
}

export type Dim = 1 | 2 | 3 | 4;

export type GridShape =
  | { tag: 'grid'; cols: Dim; rows: Dim }
  | { tag: 'grid-overflow'; cols: Dim; rows: Dim; hiddenCount: PositiveInt }
  | { tag: 'pill' };

/** What `<AdaptiveGridMarker>` accepts — pill is rendered by a sibling component. */
export type ResolvedGrid = Exclude<GridShape, { tag: 'pill' }>;

/**
 * Helper, not a stored field — derived deterministically from the shape's
 * dimensions. `grid` uses every cell; `grid-overflow` reserves the last
 * cell for the "+N more" indicator.
 */
export function visibleCapacity(shape: ResolvedGrid): number {
  return shape.tag === 'grid'
    ? shape.cols * shape.rows
    : shape.cols * shape.rows - 1;
}

const MAX_FAMILIES = 16;
const MAX_OBSERVATIONS = 64;
const MOBILE_GRID_OVERFLOW_VISIBLE = 8;

/**
 * Pick the grid shape for a cluster, per spec §4.1.
 *
 * Order of precedence:
 *   1. Pill fallback when uniqueFamilies > 16 OR pointCount > 64.
 *   2. Mobile cap: on isMobile, families > 8 → 3×3 grid-overflow.
 *   3. Desktop sizing table (1, 2, 3-4, 5-9, 10-16).
 */
export function pickGridShape(
  uniqueFamilies: number,
  pointCount: number,
  isMobile: boolean,
): GridShape {
  if (uniqueFamilies > MAX_FAMILIES || pointCount > MAX_OBSERVATIONS) {
    return { tag: 'pill' };
  }
  if (isMobile && uniqueFamilies > MOBILE_GRID_OVERFLOW_VISIBLE) {
    return {
      tag: 'grid-overflow',
      cols: 3,
      rows: 3,
      hiddenCount: toPositiveInt(uniqueFamilies - MOBILE_GRID_OVERFLOW_VISIBLE),
    };
  }
  if (uniqueFamilies === 1) return { tag: 'grid', cols: 1, rows: 1 };
  if (uniqueFamilies === 2) return { tag: 'grid', cols: 2, rows: 1 };
  if (uniqueFamilies <= 4) return { tag: 'grid', cols: 2, rows: 2 };
  if (uniqueFamilies <= 9) return { tag: 'grid', cols: 3, rows: 3 };
  return { tag: 'grid', cols: 4, rows: 4 };
}

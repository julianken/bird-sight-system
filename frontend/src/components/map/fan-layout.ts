/**
 * Fan-layout geometry — pure circle and Archimedean spiral math used by the
 * Spider v2 auto-fan reconciler (`stack-fanout.ts` + `MapCanvas.tsx`).
 *
 * Renamed from `spiderfy.ts` after Spider v2 (#280) deleted the click-driven
 * spider. The old name was a misnomer — what remains is just per-leaf offset
 * geometry plus the leader-line paint constants the auto-spider layer reads
 * (the auto-spider is no longer a "click to spider out" interaction; it's a
 * reconciler-driven fan-out of co-located markers, hence "fan-layout").
 *
 * Surface kept:
 *
 *   - Geometry primitive: `computeSpiderfyLayout` — `stack-fanout.ts`'s
 *     `fanPositions` reuses it.
 *   - Geometry constants: `SPIDERFY_RADIUS_PX`, `SPIDERFY_MAX_LEAVES`,
 *     `CIRCLE_THRESHOLD`, `SPIRAL_BASE_RADIUS`, `SPIRAL_GROWTH`.
 *   - Leader-line paint constants: `SPIDER_LEADER_COLOR`, `SPIDER_LEADER_WIDTH` —
 *     consumed by `MapCanvas.tsx`'s auto-spider layer paint properties.
 *
 * Removed in the rename: `computePrePanOffset` and its `PrePanInput` /
 * `PrePanOffset` types. Pre-pan was a click-spiderfy concern — the
 * reconciler-driven auto-spider doesn't need to nudge the viewport because
 * it only fans markers that are already inside the viewport.
 *
 * Removed in #295 review fixup: `buildSpiderfyLeaderLineFeatures` and its
 * `SpiderfyLeaf` / `SpiderfyLeaderLineFeatureCollection` types. Same
 * disposition as `computePrePanOffset` — zero production callers, only the
 * colocated test imported it. `MapCanvas.tsx`'s auto-spider reconciler builds
 * leader features inline.
 */

export const SPIDERFY_RADIUS_PX = 70;
export const SPIDERFY_MAX_LEAVES = 8;
export const SPIDERFY_DURATION_MS = 200;
/** Shared with auto-spider reconciler in MapCanvas.tsx — keep in sync. */
export const SPIDER_LEADER_COLOR = '#444';
export const SPIDER_LEADER_WIDTH = 2;

/* Threshold below which a circle layout is used; above which a spiral is. */
const CIRCLE_THRESHOLD = 6;

/* Spiral parameters tuned to the 70px radius. The Archimedean spiral is
   r(θ) = a + b·θ; we pick `a` slightly below the circle radius and a small
   `b` so the 7th and 8th leaves sit just outside the circle ring without
   overlapping. */
const SPIRAL_BASE_RADIUS = SPIDERFY_RADIUS_PX * 0.65;
const SPIRAL_GROWTH = 8; // px per radian — keeps the 7th/8th points readable

export type SpiderfyKind = 'circle' | 'spiral';

export interface SpiderfyOffset {
  kind: SpiderfyKind;
  /** X offset in pixels from cluster center (right is positive). */
  dx: number;
  /** Y offset in pixels from cluster center (down is positive). */
  dy: number;
}

/**
 * Compute pixel offsets from cluster center for each leaf marker.
 *
 * - 0 leaves → empty array.
 * - 1-6 leaves → circle layout, evenly spaced. First leaf placed at θ=−π/2
 *   (top), subsequent leaves clockwise. This puts the first marker above
 *   the cluster, which reads more naturally than 3 o'clock.
 * - 7-8 leaves → Archimedean spiral. Same starting angle, monotonically
 *   increasing radius.
 *
 * Counts >SPIDERFY_MAX_LEAVES are capped at SPIDERFY_MAX_LEAVES — defensive
 * guard against a caller that didn't enforce the threshold.
 */
export function computeSpiderfyLayout(count: number): SpiderfyOffset[] {
  if (count <= 0) return [];
  const n = Math.min(count, SPIDERFY_MAX_LEAVES);

  if (n <= CIRCLE_THRESHOLD) {
    const offsets: SpiderfyOffset[] = [];
    const step = (2 * Math.PI) / n;
    for (let i = 0; i < n; i += 1) {
      const theta = -Math.PI / 2 + i * step;
      offsets.push({
        kind: 'circle',
        dx: SPIDERFY_RADIUS_PX * Math.cos(theta),
        dy: SPIDERFY_RADIUS_PX * Math.sin(theta),
      });
    }
    return offsets;
  }

  // Spiral: 7-8 leaves. Step angle slightly less than 2π/n keeps adjacent
  // leaves visually distinct as the radius grows.
  const offsets: SpiderfyOffset[] = [];
  const angleStep = (2 * Math.PI) / n;
  for (let i = 0; i < n; i += 1) {
    const theta = -Math.PI / 2 + i * angleStep;
    const r = SPIRAL_BASE_RADIUS + SPIRAL_GROWTH * (i + 1);
    offsets.push({
      kind: 'spiral',
      dx: r * Math.cos(theta),
      dy: r * Math.sin(theta),
    });
  }
  return offsets;
}


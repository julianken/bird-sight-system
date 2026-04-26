/**
 * Spiderfy layout math — circle and Archimedean spiral geometry used by the
 * Spider v2 auto-fan reconciler (`stack-fanout.ts` + `MapCanvas.tsx`).
 *
 * The click-driven `spiderfyCluster` orchestrator was removed in Spider v2
 * (issue #277, Task 5). `computeSpiderfyLayout`, `buildSpiderfyLeaderLineFeatures`,
 * `computePrePanOffset`, and the associated pure helper types remain because
 * `stack-fanout.ts`'s `fanPositions` reuses the geometry primitives.
 *
 * Leader-line style constants (`SPIDER_LEADER_COLOR`, `SPIDER_LEADER_WIDTH`)
 * are kept here and consumed by `MapCanvas.tsx`'s auto-spider layer.
 */

export const SPIDERFY_RADIUS_PX = 70;
export const SPIDERFY_MAX_LEAVES = 8;
export const SPIDERFY_DURATION_MS = 200;
export const SPIDERFY_LEADER_SOURCE_ID = 'spiderfy-leaves';
export const SPIDERFY_LEADER_LAYER_ID = 'spiderfy-leaves-line';
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

/* Pre-pan trigger: if the cluster sits within (radius + edgeBuffer) of any
   viewport edge, pan to bring the spider into view. The buffer keeps a small
   gutter between the outermost leaf and the viewport boundary. */
const EDGE_BUFFER_PX = 16;

export type SpiderfyKind = 'circle' | 'spiral';

export interface SpiderfyOffset {
  kind: SpiderfyKind;
  /** X offset in pixels from cluster center (right is positive). */
  dx: number;
  /** Y offset in pixels from cluster center (down is positive). */
  dy: number;
}

/**
 * Geographic coordinates the spiderfy layer needs. `originLngLat` is the
 * cluster center; `leafLngLat` is where the leaf appears after spiderfy
 * (origin + projected pixel offset).
 */
export interface SpiderfyLeaf {
  subId: string;
  comName: string;
  familyCode: string | null;
  locName: string | null;
  obsDt: string;
  isNotable: boolean;
  originLngLat: [number, number];
  leafLngLat: [number, number];
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

/* GeoJSON-shaped output of `buildSpiderfyLeaderLineFeatures`. Intentionally
   kept local — `@types/geojson` is not on the import path. */
export interface SpiderfyLeaderLineFeatureCollection {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: { type: 'LineString'; coordinates: [number, number][] };
    properties: { subId: string };
  }>;
}

/**
 * Build a GeoJSON FeatureCollection of LineString features (one per leaf),
 * each running from cluster origin → leaf coord. Used as the data for the
 * transient leader-line source.
 */
export function buildSpiderfyLeaderLineFeatures(
  leaves: SpiderfyLeaf[],
): SpiderfyLeaderLineFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: leaves.map((l) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'LineString' as const,
        coordinates: [l.originLngLat, l.leafLngLat],
      },
      properties: { subId: l.subId },
    })),
  };
}

export interface PrePanInput {
  clusterScreen: { x: number; y: number };
  viewport: { width: number; height: number };
}

export interface PrePanOffset {
  /** Positive dx pans the map content right (exposes more of the right side). */
  dx: number;
  dy: number;
}

/**
 * Decide whether the spider would overflow a viewport edge, and if so, the
 * pixel offset to nudge the map back into safe territory. Null when no pan
 * is needed.
 *
 * Returned dx/dy are in the same convention as `map.panBy` / the inverse of
 * `easeTo({ center: ... })` deltas — positive dx pans the content right
 * (cluster moves left in the viewport, exposing the right side).
 */
export function computePrePanOffset(input: PrePanInput): PrePanOffset | null {
  const { clusterScreen, viewport } = input;
  const safeRadius = SPIDERFY_RADIUS_PX + EDGE_BUFFER_PX;

  let dx = 0;
  let dy = 0;

  // Right edge: cluster too close to the right side.
  if (clusterScreen.x + safeRadius > viewport.width) {
    dx = clusterScreen.x + safeRadius - viewport.width;
  } else if (clusterScreen.x - safeRadius < 0) {
    dx = clusterScreen.x - safeRadius;
  }

  if (clusterScreen.y + safeRadius > viewport.height) {
    dy = clusterScreen.y + safeRadius - viewport.height;
  } else if (clusterScreen.y - safeRadius < 0) {
    dy = clusterScreen.y - safeRadius;
  }

  if (dx === 0 && dy === 0) return null;
  return { dx, dy };
}


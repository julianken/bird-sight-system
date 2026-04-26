/**
 * Cluster spiderfy — fan small clusters (≤8 points) out radially with leader
 * lines so each marker is individually clickable. MapLibre has no built-in
 * spiderfy; this module supplies the layout math + a thin maplibre wrapper
 * that adds a transient leader-line layer and projects each leaf so the
 * caller can render an HTML hit-target overlay.
 *
 * Why split layout from maplibre integration:
 *   - The layout math (circle + Archimedean spiral) is unit-testable in
 *     pure jsdom — no WebGL, no projection.
 *   - The orchestrator (`spiderfyCluster`) takes a duck-typed map + source,
 *     so it tests cleanly with vi.fn() stubs without needing a real
 *     `maplibre-gl.Map`.
 *
 * Spec (issue #247):
 *   - 70px radius (issue: "70px radius").
 *   - ≤6 leaves → circle. 7-8 → Archimedean spiral.
 *   - 200ms ease-out (used for pre-pan; the leader-line layer renders
 *     instantly — a transient layer doesn't have an ease).
 *   - Pre-pan with `easeTo` if the spider would overflow the viewport edge.
 */

export const SPIDERFY_RADIUS_PX = 70;
export const SPIDERFY_MAX_LEAVES = 8;
export const SPIDERFY_DURATION_MS = 200;
export const SPIDERFY_LEADER_SOURCE_ID = 'spiderfy-leaves';
export const SPIDERFY_LEADER_LAYER_ID = 'spiderfy-leaves-line';

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

export interface SpiderfyState {
  /** The cluster_id whose leaves are currently fanned. Consumers can use
      this to suppress duplicate visuals (e.g. hide the cluster's own
      mosaic marker while it's spidered) so the user gets a clean
      "stack opened" feedback. */
  clusterId: number;
  leaves: SpiderfyLeaf[];
  /** Removes the transient leader-line layer + source. Idempotent. */
  teardown: () => void;
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

/* ── Maplibre integration ──────────────────────────────────────────────── */

/**
 * Minimal MapLibre surface this module touches. Duck-typed so that tests
 * can supply vi.fn() stubs without dragging in the full maplibre-gl module
 * (which has no jsdom story).
 */
export interface SpiderfyMap {
  project(lngLat: [number, number]): { x: number; y: number };
  unproject(point: { x: number; y: number }): [number, number];
  easeTo(options: Record<string, unknown>): unknown;
  getCanvas(): { clientWidth: number; clientHeight: number };
  getLayer(id: string): unknown;
  getSource(id: string): unknown;
  addSource(id: string, spec: Record<string, unknown>): void;
  removeSource(id: string): unknown;
  addLayer(spec: Record<string, unknown>): void;
  removeLayer(id: string): void;
}

/**
 * MapLibre 5.x cluster source. `getClusterLeaves` returns a Promise — never
 * pass a callback (silently no-ops, see PR #165 / issue #166 regression).
 */
export interface SpiderfySource {
  getClusterLeaves(
    clusterId: number,
    limit: number,
    offset: number,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any[]>;
}

export interface SpiderfyClusterArgs {
  map: SpiderfyMap;
  source: SpiderfySource;
  clusterId: number;
  clusterLngLat: [number, number];
}

/**
 * Spider-out a cluster:
 *   1. Fetch leaves via `source.getClusterLeaves(clusterId, 8, 0)`.
 *   2. Project the cluster center to screen pixels.
 *   3. Compute the per-leaf layout (circle ≤6, spiral 7-8).
 *   4. Convert each pixel offset back to lng/lat via `map.unproject`.
 *   5. Add a transient `geojson` source + `line` layer with leader lines.
 *   6. Pre-pan with `easeTo` if the spider would overflow the viewport.
 *
 * Returns the projected leaves + a teardown function. The caller (MapCanvas)
 * uses the leaves to render an HTML hit-target overlay; teardown removes
 * the leader-line layer + source on outside-click / Escape / re-cluster.
 */
export async function spiderfyCluster(
  args: SpiderfyClusterArgs,
): Promise<SpiderfyState> {
  const { map, source, clusterId, clusterLngLat } = args;

  // (1) Fetch leaves. Critical: this is `await`-ed; passing a callback as a
  // 4th arg silently no-ops in maplibre 5.x (see PR #165 / issue #166).
  const features = await source.getClusterLeaves(
    clusterId,
    SPIDERFY_MAX_LEAVES,
    0,
  );

  // (2) Project cluster center.
  const clusterScreen = map.project(clusterLngLat);

  // (3) Compute layout.
  const offsets = computeSpiderfyLayout(features.length);

  // (4) Project each leaf back to lng/lat.
  const leaves: SpiderfyLeaf[] = features
    .slice(0, offsets.length)
    .map((f, i) => {
      const offset = offsets[i]!;
      const leafScreen = {
        x: clusterScreen.x + offset.dx,
        y: clusterScreen.y + offset.dy,
      };
      const leafLngLat = map.unproject(leafScreen);
      const props = (f.properties ?? {}) as Record<string, unknown>;
      return {
        subId: String(props.subId ?? ''),
        comName: String(props.comName ?? ''),
        familyCode: (props.familyCode as string | null | undefined) ?? null,
        locName: (props.locName as string | null | undefined) ?? null,
        obsDt: String(props.obsDt ?? ''),
        isNotable: Boolean(props.isNotable),
        originLngLat: clusterLngLat,
        leafLngLat,
      };
    });

  // (5) Add transient leader-line source + layer. Defensively remove first
  // in case a previous spiderfy didn't tear down (e.g. fast double-click).
  removeSpiderfyLayer(map);
  const data = buildSpiderfyLeaderLineFeatures(leaves);
  map.addSource(SPIDERFY_LEADER_SOURCE_ID, { type: 'geojson', data });
  map.addLayer({
    id: SPIDERFY_LEADER_LAYER_ID,
    type: 'line',
    source: SPIDERFY_LEADER_SOURCE_ID,
    paint: {
      // Darker + thicker than the original 1px #888: against the light
      // OpenFreeMap positron basemap, 1px gray reads as background noise.
      // 2px #444 gives the user a clear "yes, the cluster fanned" signal
      // even before they notice the (currently invisible) hit-targets at
      // the leaf positions. Spider v2 (#277) will add visible silhouettes
      // at leaf positions; until then, leader-line visibility is the
      // primary cue.
      'line-color': '#444',
      'line-width': 2,
    },
  });

  // (6) Pre-pan if needed.
  const canvas = map.getCanvas();
  const prePan = computePrePanOffset({
    clusterScreen,
    viewport: { width: canvas.clientWidth, height: canvas.clientHeight },
  });
  if (prePan) {
    // Convert the pixel offset to a target lng/lat: pan by inverting the
    // cluster's screen position.
    const targetScreen = {
      x: clusterScreen.x - prePan.dx,
      y: clusterScreen.y - prePan.dy,
    };
    const targetLngLat = map.unproject(targetScreen);
    map.easeTo({
      center: targetLngLat,
      duration: SPIDERFY_DURATION_MS,
      easing: easeOut,
    });
  }

  return {
    clusterId,
    leaves,
    teardown: () => removeSpiderfyLayer(map),
  };
}

/**
 * Tear down the transient leader-line layer + source. Safe to call when no
 * spider is active (silently no-ops on missing layer/source).
 */
function removeSpiderfyLayer(map: SpiderfyMap): void {
  try {
    if (map.getLayer(SPIDERFY_LEADER_LAYER_ID)) {
      map.removeLayer(SPIDERFY_LEADER_LAYER_ID);
    }
  } catch {
    /* no-op — layer absent */
  }
  try {
    if (map.getSource(SPIDERFY_LEADER_SOURCE_ID)) {
      map.removeSource(SPIDERFY_LEADER_SOURCE_ID);
    }
  } catch {
    /* no-op — source absent */
  }
}

/* Standard ease-out cubic. Matches the 200ms ease-out the issue spec calls
   out and mirrors the spirit of MapLibre's default `defaultEasing`. */
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

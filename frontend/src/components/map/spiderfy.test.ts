import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  computeSpiderfyLayout,
  buildSpiderfyLeaderLineFeatures,
  computePrePanOffset,
  SPIDERFY_RADIUS_PX,
  SPIDERFY_MAX_LEAVES,
  SPIDERFY_DURATION_MS,
  spiderfyCluster,
  type SpiderfyLeaf,
} from './spiderfy.js';

/* ── Pure layout helpers ──────────────────────────────────────────────────
   These functions take pixel coordinates (or screen-projected leaves) and
   return offset/anchor data. They have no maplibre / DOM dependencies, so
   they exercise cleanly in jsdom. */

describe('computeSpiderfyLayout', () => {
  it('places ≤6 markers on a circle at SPIDERFY_RADIUS_PX', () => {
    // Six leaves → circle layout. Each offset has magnitude == radius.
    const layout = computeSpiderfyLayout(6);
    expect(layout).toHaveLength(6);
    expect(layout[0]).toEqual({ kind: 'circle', dx: expect.any(Number), dy: expect.any(Number) });
    for (const offset of layout) {
      const r = Math.hypot(offset.dx, offset.dy);
      expect(r).toBeCloseTo(SPIDERFY_RADIUS_PX, 5);
    }
  });

  it('uses spiral layout for 7-8 markers (radii vary)', () => {
    const layout = computeSpiderfyLayout(8);
    expect(layout).toHaveLength(8);
    expect(layout[0]?.kind).toBe('spiral');

    const radii = layout.map((o) => Math.hypot(o.dx, o.dy));
    // Spiral is monotonically increasing in radius — assert the last
    // marker is strictly farther from origin than the first.
    expect(radii[radii.length - 1]).toBeGreaterThan(radii[0]!);
  });

  it('returns no overlapping placements (every marker has a unique angle)', () => {
    const layout = computeSpiderfyLayout(8);
    const angles = layout.map((o) => Math.atan2(o.dy, o.dx));
    const unique = new Set(angles.map((a) => a.toFixed(3)));
    expect(unique.size).toBe(angles.length);
  });

  it('returns empty array for count === 0', () => {
    expect(computeSpiderfyLayout(0)).toEqual([]);
  });

  it('caps at SPIDERFY_MAX_LEAVES (>8 returns 8 placements)', () => {
    // The cluster-click handler is only supposed to invoke spiderfy
    // when point_count <= 8, but defensive layout caps the array at 8.
    const layout = computeSpiderfyLayout(15);
    expect(layout).toHaveLength(SPIDERFY_MAX_LEAVES);
  });
});

describe('buildSpiderfyLeaderLineFeatures', () => {
  it('emits one LineString feature per leaf (origin → leaf coord)', () => {
    const leaves: SpiderfyLeaf[] = [
      {
        subId: 'S1',
        comName: 'House Finch',
        familyCode: 'fringillidae',
        locName: 'Sabino Canyon',
        obsDt: '2026-04-15T10:00:00Z',
        isNotable: false,
        originLngLat: [-111, 34],
        leafLngLat: [-110.99, 34.01],
      },
      {
        subId: 'S2',
        comName: 'Verdin',
        familyCode: 'remizidae',
        locName: null,
        obsDt: '2026-04-15T11:00:00Z',
        isNotable: true,
        originLngLat: [-111, 34],
        leafLngLat: [-111.01, 33.99],
      },
    ];
    const fc = buildSpiderfyLeaderLineFeatures(leaves);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0]?.geometry.type).toBe('LineString');
    expect(fc.features[0]?.geometry.coordinates).toEqual([[-111, 34], [-110.99, 34.01]]);
    expect(fc.features[1]?.geometry.coordinates).toEqual([[-111, 34], [-111.01, 33.99]]);
  });

  it('includes the leaf subId in each line feature properties for trace/hover', () => {
    const leaves: SpiderfyLeaf[] = [
      {
        subId: 'S99',
        comName: 'X',
        familyCode: null,
        locName: null,
        obsDt: '2026-04-15T11:00:00Z',
        isNotable: false,
        originLngLat: [0, 0],
        leafLngLat: [1, 1],
      },
    ];
    const fc = buildSpiderfyLeaderLineFeatures(leaves);
    expect(fc.features[0]?.properties.subId).toBe('S99');
  });
});

describe('computePrePanOffset', () => {
  // The cluster point is in screen-pixel coordinates relative to the map's
  // canvas origin (top-left). The function returns a `{dx, dy}` pan in
  // pixels needed to bring the spider into view, or `null` if the spider
  // already fits.
  it('returns null when the spider fits comfortably inside the viewport', () => {
    const offset = computePrePanOffset({
      clusterScreen: { x: 700, y: 400 },
      viewport: { width: 1440, height: 900 },
    });
    expect(offset).toBeNull();
  });

  it('returns positive dx when the cluster sits within radius of the right edge', () => {
    const offset = computePrePanOffset({
      clusterScreen: { x: 1430, y: 400 },
      viewport: { width: 1440, height: 900 },
    });
    // Spider would overflow right edge; pan map content rightward (positive dx
    // moves the map content right which exposes the right side).
    expect(offset).not.toBeNull();
    expect(offset!.dx).toBeGreaterThan(0);
    expect(offset!.dy).toBe(0);
  });

  it('returns negative dx when the cluster sits within radius of the left edge', () => {
    const offset = computePrePanOffset({
      clusterScreen: { x: 5, y: 400 },
      viewport: { width: 1440, height: 900 },
    });
    expect(offset).not.toBeNull();
    expect(offset!.dx).toBeLessThan(0);
  });

  it('returns positive dy when the cluster is near the bottom edge', () => {
    const offset = computePrePanOffset({
      clusterScreen: { x: 200, y: 870 },
      viewport: { width: 390, height: 900 },
    });
    expect(offset).not.toBeNull();
    expect(offset!.dy).toBeGreaterThan(0);
  });

  it('returns negative dy when the cluster is near the top edge', () => {
    const offset = computePrePanOffset({
      clusterScreen: { x: 200, y: 5 },
      viewport: { width: 390, height: 900 },
    });
    expect(offset).not.toBeNull();
    expect(offset!.dy).toBeLessThan(0);
  });
});

describe('exported constants', () => {
  it('SPIDERFY_RADIUS_PX matches issue spec (70px)', () => {
    expect(SPIDERFY_RADIUS_PX).toBe(70);
  });

  it('SPIDERFY_MAX_LEAVES matches issue spec (8)', () => {
    expect(SPIDERFY_MAX_LEAVES).toBe(8);
  });

  it('SPIDERFY_DURATION_MS matches issue spec (200ms)', () => {
    expect(SPIDERFY_DURATION_MS).toBe(200);
  });
});

/* ── Integration: spiderfyCluster orchestrator ──────────────────────────── */

describe('spiderfyCluster (maplibre integration)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let map: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let source: any;

  beforeEach(() => {
    map = {
      project: vi.fn((lngLat: [number, number]) => ({
        x: 700 + lngLat[0] * 10,
        y: 400 + lngLat[1] * 10,
      })),
      unproject: vi.fn((p: { x: number; y: number }) => [
        (p.x - 700) / 10,
        (p.y - 400) / 10,
      ]),
      easeTo: vi.fn(),
      getCanvas: vi.fn(() => ({ clientWidth: 1440, clientHeight: 900 })),
      getStyle: vi.fn(() => ({})),
      getLayer: vi.fn(),
      getSource: vi.fn(),
      addSource: vi.fn(),
      removeSource: vi.fn(),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
    };
    source = {
      getClusterLeaves: vi.fn(),
    };
  });

  it('awaits getClusterLeaves (Promise API) and projects each leaf', async () => {
    // Five leaves → circle layout.
    const leaves = Array.from({ length: 5 }, (_, i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-111 + i * 0.001, 34] as [number, number] },
      properties: {
        subId: `S${i}`,
        comName: `Bird ${i}`,
        familyCode: null,
        locName: 'Loc',
        obsDt: '2026-04-15T10:00:00Z',
        isNotable: false,
      },
    }));
    source.getClusterLeaves.mockResolvedValue(leaves);

    await spiderfyCluster({
      map,
      source,
      clusterId: 42,
      clusterLngLat: [-111, 34],
    });

    expect(source.getClusterLeaves).toHaveBeenCalledWith(42, SPIDERFY_MAX_LEAVES, 0);
    // Critical regression guard (matches MapCanvas.tsx:104-107 pattern):
    // arity must be exactly 3 — a 4th callback argument silently no-ops in
    // maplibre 5.x. Pinning the call shape here is the test that would
    // catch the regression.
    expect(source.getClusterLeaves.mock.calls[0]).toHaveLength(3);
    // Spiderfy adds one source + one layer for leader lines.
    expect(map.addSource).toHaveBeenCalled();
    expect(map.addLayer).toHaveBeenCalled();
  });

  it('returns the spiderfy state (leaves with leafLngLat) so the caller can render hit targets', async () => {
    const leaves = Array.from({ length: 4 }, (_, i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-111 + i * 0.001, 34] as [number, number] },
      properties: {
        subId: `S${i}`,
        comName: `Bird ${i}`,
        familyCode: null,
        locName: 'Loc',
        obsDt: '2026-04-15T10:00:00Z',
        isNotable: false,
      },
    }));
    source.getClusterLeaves.mockResolvedValue(leaves);

    // Once the spiderfy layer + source are added, getLayer/getSource return
    // truthy so teardown actually runs removeLayer/removeSource. Without
    // this the teardown short-circuits in the absent-layer guard.
    map.getLayer.mockReturnValue({ id: 'spiderfy-leaves-line' });
    map.getSource.mockReturnValue({ id: 'spiderfy-leaves' });

    const result = await spiderfyCluster({
      map,
      source,
      clusterId: 7,
      clusterLngLat: [-111, 34],
    });

    expect(result.leaves).toHaveLength(4);
    for (const leaf of result.leaves) {
      expect(leaf.subId).toBeDefined();
      expect(leaf.leafLngLat).toBeDefined();
      expect(leaf.originLngLat).toEqual([-111, 34]);
    }
    // The teardown function removes the leader-line layer + source.
    expect(typeof result.teardown).toBe('function');
    result.teardown();
    expect(map.removeLayer).toHaveBeenCalled();
    expect(map.removeSource).toHaveBeenCalled();
  });

  it('pre-pans with easeTo when the cluster sits near a viewport edge', async () => {
    // Project the cluster near the right edge.
    map.project.mockReturnValue({ x: 1435, y: 400 });
    source.getClusterLeaves.mockResolvedValue([
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-111, 34] as [number, number] },
        properties: {
          subId: 'S1',
          comName: 'X',
          familyCode: null,
          locName: null,
          obsDt: '2026-04-15T10:00:00Z',
          isNotable: false,
        },
      },
    ]);

    await spiderfyCluster({
      map,
      source,
      clusterId: 1,
      clusterLngLat: [-111, 34],
    });

    expect(map.easeTo).toHaveBeenCalled();
    const arg = (map.easeTo.mock.calls[0] as [Record<string, unknown>])[0];
    expect(arg.duration).toBe(SPIDERFY_DURATION_MS);
  });

  it('does NOT pre-pan when the cluster is already comfortably inside the viewport', async () => {
    map.project.mockReturnValue({ x: 700, y: 400 });
    source.getClusterLeaves.mockResolvedValue([
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-111, 34] as [number, number] },
        properties: {
          subId: 'S1',
          comName: 'X',
          familyCode: null,
          locName: null,
          obsDt: '2026-04-15T10:00:00Z',
          isNotable: false,
        },
      },
    ]);

    await spiderfyCluster({
      map,
      source,
      clusterId: 1,
      clusterLngLat: [-111, 34],
    });

    expect(map.easeTo).not.toHaveBeenCalled();
  });
});

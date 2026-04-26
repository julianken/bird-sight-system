import { describe, it, expect } from 'vitest';
import {
  computeSpiderfyLayout,
  buildSpiderfyLeaderLineFeatures,
  computePrePanOffset,
  SPIDERFY_RADIUS_PX,
  SPIDERFY_MAX_LEAVES,
  SPIDERFY_DURATION_MS,
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


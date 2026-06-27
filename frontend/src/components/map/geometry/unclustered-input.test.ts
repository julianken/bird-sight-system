import { describe, it, expect } from 'vitest';
import { buildUnclusteredInput, type UnclusteredFeatureInput } from './unclustered-input.js';
import {
  buildGroups,
  isSyntheticSingleId,
  type DeconflictInput,
} from './deconflict.js';
import type { ResolvedGrid, SilhouettesById } from './adaptive-grid.js';

/**
 * Render-completeness regression for issue #1296.
 *
 * The "Greater Roadrunner, Phoenix AZ" repro: 8 observations, obs #1 & #4
 * COINCIDENT. At tile zoom 10 the real `supercluster` (radius 800, extent 8192,
 * maxZoom 22) decomposes the in-viewport subset (obs 1-7; obs 8 is out of the
 * viewport) into TWO clusters + TWO raw singletons:
 *
 *   cluster(3) = [obs 1, 4, 7]   (point_count 3)
 *   cluster(2) = [obs 2, 3]      (point_count 2)
 *   raw idx5   = obs 5           (singleton)
 *   raw idx6   = obs 6           (singleton)
 *
 * That decomposition is pinned here as deterministic fixtures (the proven
 * values from the issue) so the test exercises EXACTLY the changed code — the
 * reconciler's per-feature input-building + `buildGroups` — without a live map
 * or the `supercluster`/`maplibre` worker.
 *
 * Before #1296 the two singletons were pushed as `kind:'silhouette'` inputs,
 * which `buildGroups` EXCLUDES from `renderedTotal` → Σ renderedTotal = 5 while
 * the lede counts 7 → 2 birds silently missing on screen, worsening as zoom
 * de-clusters more singletons.
 */

// The 8-coordinate roadrunner fixture (issue #1296). 1-indexed in the issue;
// obs #1 & #4 are coincident; obs #8 is the far-NW point outside the z10 viewport.
const ROADRUNNER_COORDS: ReadonlyArray<[number, number]> = [
  [33.4741, -111.9596], // 1
  [33.43348, -111.94868], // 2
  [33.44809, -111.93719], // 3
  [33.4741, -111.9596], // 4  (coincident with #1)
  [33.51206, -111.88502], // 5  raw singleton
  [33.51743, -111.85052], // 6  raw singleton
  [33.46182, -111.94363], // 7
  [33.65492, -112.18361], // 8  out of viewport at z10
];

const CUCULIDAE: SilhouettesById = new Map([
  ['cuculidae', { svgData: '<path d="M0 0" />', color: '#a33', colorDark: '#f88', commonName: 'Cuckoos' }],
]);

/** A clustered grid input as the clustered branch assembles it (real positive id). */
function clusterGridInput(id: number, px: number, py: number, pointCount: number): DeconflictInput {
  const shape: ResolvedGrid = { tag: 'grid', cols: 1, rows: 1 };
  return {
    cluster_id: id,
    px,
    py,
    rendered: { kind: 'grid', shape },
    point_count: pointCount,
    uniqueFamilies: 1,
    longitude: -111.94,
    latitude: 33.46,
  };
}

/** Singleton feature input (obs #5 / #6), with a deliberately well-separated px/py. */
function singletonFeature(idx: number, px: number, py: number): UnclusteredFeatureInput {
  const [lat, lng] = ROADRUNNER_COORDS[idx - 1] as [number, number];
  return {
    subId: `obsSL${idx}`,
    familyCode: 'cuculidae',
    speciesCode: 'greroa',
    comName: 'Greater Roadrunner',
    isNotable: false,
    longitude: lng,
    latitude: lat,
    px,
    py,
  };
}

/**
 * Build the full reconciler input list for the z10 decomposition. Positions are
 * spread ≥300px apart so no marker AABBs overlap → 4 distinct deconflict groups.
 */
function buildInputs(filterActive: boolean): DeconflictInput[] {
  return [
    clusterGridInput(11, 100, 100, 3), // cluster(3) = [1,4,7]
    clusterGridInput(12, 100, 400, 2), // cluster(2) = [2,3]
    buildUnclusteredInput(singletonFeature(5, 400, 100), filterActive, false, CUCULIDAE),
    buildUnclusteredInput(singletonFeature(6, 400, 400), filterActive, false, CUCULIDAE),
  ];
}

function sumRenderedTotal(inputs: DeconflictInput[]): number {
  return buildGroups(inputs, 10).reduce((sum, g) => sum + g.renderedTotal, 0);
}

describe('unclustered-input — filtered-view render completeness (#1296)', () => {
  it('filterActive=true conserves the count: Σ renderedTotal === 7 (the 2 singletons now contribute)', () => {
    expect(sumRenderedTotal(buildInputs(true))).toBe(7);
  });

  it('filterActive=false is UNCHANGED: singletons stay silhouettes, Σ renderedTotal === 5', () => {
    expect(sumRenderedTotal(buildInputs(false))).toBe(5);
  });

  it('promotes each lone obs to a 1×1 family grid marker only when filtered', () => {
    const filtered = buildUnclusteredInput(singletonFeature(5, 400, 100), true, false, CUCULIDAE);
    expect(filtered.rendered.kind).toBe('grid');
    expect(filtered.rendered).toEqual({ kind: 'grid', shape: { tag: 'grid', cols: 1, rows: 1 } });
    expect(filtered.point_count).toBe(1);
    expect(filtered.tiles).toHaveLength(1);
    expect(filtered.tiles?.[0]).toMatchObject({ kind: 'rendered', familyCode: 'cuculidae' });
    // Positive high-band id so a real overlapping cluster wins the min() anchor
    // tiebreak, and the click handlers can exclude it from getClusterLeaves.
    expect(filtered.cluster_id).toBeGreaterThan(0);
    expect(isSyntheticSingleId(filtered.cluster_id)).toBe(true);

    const unfiltered = buildUnclusteredInput(singletonFeature(5, 400, 100), false, false, CUCULIDAE);
    expect(unfiltered.rendered.kind).toBe('silhouette');
    expect(unfiltered.cluster_id).toBeLessThan(0); // negative pseudo-id (unchanged path)
    expect(isSyntheticSingleId(unfiltered.cluster_id)).toBe(false);
  });
});

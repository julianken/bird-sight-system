import { describe, it, expect } from 'vitest';
import type { FamilySilhouette } from '@bird-watch/shared-types';
import {
  aggregateClusterFamilies,
  buildMosaicTiles,
  MOSAIC_TILE_COUNT,
  type ClusterLeafFeature,
} from './cluster-mosaic.js';

const SILHOUETTES: FamilySilhouette[] = [
  {
    familyCode: 'tyrannidae',
    color: '#C77A2E',
    svgData: 'M0 0L1 1Z',
    source: 'placeholder',
    license: 'CC0',
    commonName: 'Tyrant Flycatchers',
    creator: null,
  },
  {
    familyCode: 'trochilidae',
    color: '#7B2D8E',
    svgData: 'M2 2L3 3Z',
    source: 'placeholder',
    license: 'CC0',
    commonName: 'Hummingbirds',
    creator: null,
  },
  {
    familyCode: 'picidae',
    color: '#FF0808',
    svgData: 'M4 4L5 5Z',
    source: 'placeholder',
    license: 'CC0',
    commonName: 'Woodpeckers',
    creator: null,
  },
  {
    familyCode: 'corvidae',
    color: '#222222',
    svgData: 'M6 6L7 7Z',
    source: 'placeholder',
    license: 'CC0',
    commonName: 'Crows & Jays',
    creator: null,
  },
  {
    familyCode: 'anatidae',
    color: '#3A6B8E',
    svgData: 'M8 8L9 9Z',
    source: 'placeholder',
    license: 'CC0',
    commonName: 'Ducks',
    creator: null,
  },
  // Uncurated row — svgData null. Mosaic falls back to a generic
  // placeholder shape at 50% opacity per the issue spec.
  {
    familyCode: 'uncurated',
    color: '#888888',
    svgData: null,
    source: null,
    license: null,
    commonName: null,
    creator: null,
  },
];

function leaf(familyCode: string | null): ClusterLeafFeature {
  return { type: 'Feature', properties: { familyCode } };
}

describe('aggregateClusterFamilies', () => {
  it('counts leaves grouped by familyCode', () => {
    const result = aggregateClusterFamilies([
      leaf('tyrannidae'),
      leaf('tyrannidae'),
      leaf('trochilidae'),
    ]);
    expect(result).toEqual([
      { familyCode: 'tyrannidae', count: 2 },
      { familyCode: 'trochilidae', count: 1 },
    ]);
  });

  it('sorts by descending count, then ascending familyCode for ties', () => {
    const result = aggregateClusterFamilies([
      leaf('picidae'),
      leaf('picidae'),
      // Tie at 1 — alphabetic by code wins (corvidae < tyrannidae).
      leaf('tyrannidae'),
      leaf('corvidae'),
    ]);
    expect(result).toEqual([
      { familyCode: 'picidae', count: 2 },
      { familyCode: 'corvidae', count: 1 },
      { familyCode: 'tyrannidae', count: 1 },
    ]);
  });

  it('skips leaves with null familyCode (LEFT JOIN miss per Observation contract)', () => {
    const result = aggregateClusterFamilies([
      leaf(null),
      leaf('tyrannidae'),
      leaf(null),
    ]);
    expect(result).toEqual([{ familyCode: 'tyrannidae', count: 1 }]);
  });

  it('returns an empty array for an empty cluster', () => {
    expect(aggregateClusterFamilies([])).toEqual([]);
  });
});

describe('buildMosaicTiles', () => {
  it('returns up to 4 tiles populated TL → TR → BL → BR (issue spec)', () => {
    const families = [
      { familyCode: 'tyrannidae', count: 4 },
      { familyCode: 'trochilidae', count: 3 },
      { familyCode: 'picidae', count: 2 },
      { familyCode: 'corvidae', count: 1 },
      { familyCode: 'anatidae', count: 1 }, // truncated — only 4 tiles
    ];
    const tiles = buildMosaicTiles(families, SILHOUETTES);
    expect(tiles).toHaveLength(4);
    expect(tiles[0]?.familyCode).toBe('tyrannidae');
    expect(tiles[1]?.familyCode).toBe('trochilidae');
    expect(tiles[2]?.familyCode).toBe('picidae');
    expect(tiles[3]?.familyCode).toBe('corvidae');
  });

  it('returns fewer than 4 tiles when fewer families are present', () => {
    const families = [
      { familyCode: 'tyrannidae', count: 5 },
      { familyCode: 'trochilidae', count: 1 },
    ];
    const tiles = buildMosaicTiles(families, SILHOUETTES);
    expect(tiles).toHaveLength(2);
  });

  it('threads silhouette path data + color through each tile from the silhouettes prop', () => {
    const tiles = buildMosaicTiles(
      [{ familyCode: 'tyrannidae', count: 1 }],
      SILHOUETTES,
    );
    expect(tiles[0]?.svgData).toBe('M0 0L1 1Z');
    expect(tiles[0]?.color).toBe('#C77A2E');
  });

  it('marks tiles with null svgData as fallback (uncurated per #245)', () => {
    const tiles = buildMosaicTiles(
      [{ familyCode: 'uncurated', count: 1 }],
      SILHOUETTES,
    );
    expect(tiles[0]?.isFallback).toBe(true);
    expect(tiles[0]?.color).toBe('#888888');
  });

  it('marks tiles with no matching silhouette as fallback', () => {
    const tiles = buildMosaicTiles(
      [{ familyCode: 'unknownidae', count: 1 }],
      SILHOUETTES,
    );
    expect(tiles[0]?.isFallback).toBe(true);
    expect(tiles[0]?.familyCode).toBe('unknownidae');
  });

  it('exposes the mosaic tile cap as a named constant (4 = 2x2 grid)', () => {
    // Pin the grid shape in the public API. If the design ever shifts to a
    // 3x3, this constant — not a magic number deep in MapCanvas — moves.
    expect(MOSAIC_TILE_COUNT).toBe(4);
  });
});

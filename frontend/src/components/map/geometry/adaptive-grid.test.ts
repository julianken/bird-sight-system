import { describe, expect, it } from 'vitest';
import {
  aggregateClusterFamilies,
  aggregateClusterSpecies,
  buildAdaptiveTiles,
  tilesFromAggregates,
  pickGridShape,
  toPositiveInt,
  visibleCapacity,
  type AdaptiveTile,
  type ClusterLeafFeature,
  type FamilyAggregate,
  type ResolvedGrid,
  type SilhouettesById,
  type SpeciesAggregate,
} from './adaptive-grid';

function leaf(familyCode: string | null): ClusterLeafFeature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-110, 32] },
    properties: {
      familyCode,
      speciesCode: 'test1',
      comName: 'Test Species',
    },
  };
}

/** Build `n` leaves cycling through `familyCodes` in round-robin order. */
function leafBatch(n: number, familyCodes: string[]): ClusterLeafFeature[] {
  const out: ClusterLeafFeature[] = [];
  for (let i = 0; i < n; i++) {
    out.push(leaf(familyCodes[i % familyCodes.length]));
  }
  return out;
}

const SHAPE_4x4: ResolvedGrid = { tag: 'grid', cols: 4, rows: 4 };
const SHAPE_2x2: ResolvedGrid = { tag: 'grid', cols: 2, rows: 2 };

describe('toPositiveInt', () => {
  it('returns the value for a positive integer', () => {
    expect(toPositiveInt(1)).toBe(1);
    expect(toPositiveInt(42)).toBe(42);
  });
  it('throws on zero', () => {
    expect(() => toPositiveInt(0)).toThrow(/must be a positive integer/i);
  });
  it('throws on negative', () => {
    expect(() => toPositiveInt(-1)).toThrow(/must be a positive integer/i);
  });
  it('throws on non-integer', () => {
    expect(() => toPositiveInt(1.5)).toThrow(/must be a positive integer/i);
  });
});

describe('pickGridShape', () => {
  // Desktop, no overflow
  it('1 family → 1×1', () => {
    expect(pickGridShape(1, 1, false)).toEqual({ tag: 'grid', cols: 1, rows: 1 });
  });
  it('2 families → 2×1', () => {
    expect(pickGridShape(2, 2, false)).toEqual({ tag: 'grid', cols: 2, rows: 1 });
  });
  it('3 families → 2×2', () => {
    expect(pickGridShape(3, 3, false)).toEqual({ tag: 'grid', cols: 2, rows: 2 });
  });
  it('4 families → 2×2', () => {
    expect(pickGridShape(4, 4, false)).toEqual({ tag: 'grid', cols: 2, rows: 2 });
  });
  it('5 families → 3×3', () => {
    expect(pickGridShape(5, 5, false)).toEqual({ tag: 'grid', cols: 3, rows: 3 });
  });
  it('9 families → 3×3', () => {
    expect(pickGridShape(9, 9, false)).toEqual({ tag: 'grid', cols: 3, rows: 3 });
  });
  it('10 families → 4×4', () => {
    expect(pickGridShape(10, 10, false)).toEqual({ tag: 'grid', cols: 4, rows: 4 });
  });
  it('16 families → 4×4', () => {
    expect(pickGridShape(16, 16, false)).toEqual({ tag: 'grid', cols: 4, rows: 4 });
  });

  // Pill caps — family-cap alone
  it('family cap fires alone (17 families, 30 obs)', () => {
    expect(pickGridShape(17, 30, false)).toEqual({ tag: 'pill' });
  });

  // Pill caps — count-cap alone
  it('count cap fires alone (8 families, 65 obs)', () => {
    expect(pickGridShape(8, 65, false)).toEqual({ tag: 'pill' });
  });

  // Boundary: count=64 inclusive
  it('count = 64 inclusive does NOT trigger pill', () => {
    expect(pickGridShape(8, 64, false)).toEqual({ tag: 'grid', cols: 3, rows: 3 });
  });

  // Boundary: count=65 with families=16 (locks > vs >= mutation)
  it('count = 65 with families = 16 → pill', () => {
    expect(pickGridShape(16, 65, false)).toEqual({ tag: 'pill' });
  });

  // Boundary: max grid
  it('families = 16, count = 64 → 4×4 (max grid, no pill)', () => {
    expect(pickGridShape(16, 64, false)).toEqual({ tag: 'grid', cols: 4, rows: 4 });
  });

  // Mobile cap
  it('mobile cap: 12 families → grid-overflow 3×3 with hiddenCount 4', () => {
    expect(pickGridShape(12, 12, true)).toEqual({
      tag: 'grid-overflow', cols: 3, rows: 3, hiddenCount: 4,
    });
  });

  // Mobile boundary: 8 families (no overflow)
  it('mobile: 8 families fits 3×3 exactly, no overflow', () => {
    expect(pickGridShape(8, 8, true)).toEqual({ tag: 'grid', cols: 3, rows: 3 });
  });

  // Mobile boundary: 9 families (first overflow)
  it('mobile: 9 families → grid-overflow with hiddenCount 1', () => {
    expect(pickGridShape(9, 9, true)).toEqual({
      tag: 'grid-overflow', cols: 3, rows: 3, hiddenCount: 1,
    });
  });
});

describe('visibleCapacity', () => {
  it('grid → cols * rows', () => {
    expect(visibleCapacity({ tag: 'grid', cols: 4, rows: 4 })).toBe(16);
    expect(visibleCapacity({ tag: 'grid', cols: 2, rows: 1 })).toBe(2);
  });
  it('grid-overflow → cols * rows - 1 (reserved for "+N")', () => {
    expect(
      visibleCapacity({ tag: 'grid-overflow', cols: 3, rows: 3, hiddenCount: toPositiveInt(4) }),
    ).toBe(8);
  });
});

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
    // Copied verbatim from `cluster-mosaic.test.ts:101` per spec §4.2 — the
    // null-familyCode dropout invariant is load-bearing for the Observation
    // wire contract and must survive the move to adaptive-grid.ts.
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

describe('buildAdaptiveTiles', () => {
  // 20 unique families, full svgData coverage. Reused across several tests.
  const FULL_CATALOGUE: SilhouettesById = new Map(
    Array.from({ length: 20 }, (_, i) => {
      const color = `#${i.toString(16).padStart(2, '0').repeat(3)}`;
      return [
        `fam-${String(i).padStart(2, '0')}`,
        { svgData: `M${i} ${i}Z`, color, colorDark: color },
      ];
    }),
  );

  it('200 leaves with 20 families, capacity=16 → 16 tiles in descending count', () => {
    // Even distribution: round-robin 200 leaves across 20 families gives 10
    // each, so the descending-count tie-break is alphabetical. We assert
    // count and order separately.
    const leaves = leafBatch(200, Array.from(FULL_CATALOGUE.keys()));
    const tiles = buildAdaptiveTiles(leaves, FULL_CATALOGUE, SHAPE_4x4);
    expect(tiles).toHaveLength(16);
    // Descending count (all equal 10 here) then alphabetic on familyCode.
    const counts = tiles.map((t) => t.count);
    expect(counts).toEqual(Array(16).fill(10));
    const codes = tiles.map((t) => t.familyCode);
    expect(codes).toEqual([...codes].sort());
  });

  it('descending count order with uneven distribution', () => {
    const leaves: ClusterLeafFeature[] = [
      ...Array(5).fill(leaf('fam-00')),
      ...Array(3).fill(leaf('fam-01')),
      ...Array(2).fill(leaf('fam-02')),
      leaf('fam-03'),
    ];
    const tiles = buildAdaptiveTiles(leaves, FULL_CATALOGUE, SHAPE_2x2);
    expect(tiles.map((t) => t.count)).toEqual([5, 3, 2, 1]);
  });

  it('drops leaves with null familyCode (preserves cluster-mosaic invariant)', () => {
    const leaves: ClusterLeafFeature[] = [
      leaf(null),
      leaf('fam-00'),
      leaf(null),
      leaf('fam-00'),
      leaf(null),
    ];
    const tiles = buildAdaptiveTiles(leaves, FULL_CATALOGUE, SHAPE_2x2);
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({ familyCode: 'fam-00', count: 2 });
  });

  it('under-capacity: 5 leaves over 2 families, capacity=4 → 2 tiles (caller pads visually)', () => {
    const leaves: ClusterLeafFeature[] = [
      ...Array(3).fill(leaf('fam-00')),
      ...Array(2).fill(leaf('fam-01')),
    ];
    const tiles = buildAdaptiveTiles(leaves, FULL_CATALOGUE, SHAPE_2x2);
    expect(tiles).toHaveLength(2);
  });

  it('null svgData → kind: "fallback" (preserves cluster-mosaic fallback behaviour)', () => {
    const partial: SilhouettesById = new Map([
      ['fam-00', { svgData: 'M0 0Z', color: '#111', colorDark: '#111' }],
      ['fam-01', { svgData: null, color: '#222', colorDark: '#222' }], // catalogue row exists, art missing
    ]);
    const leaves = [leaf('fam-00'), leaf('fam-01')];
    const tiles = buildAdaptiveTiles(leaves, partial, SHAPE_2x2);
    const byFam = new Map(tiles.map((t) => [t.familyCode, t]));
    expect(byFam.get('fam-00')?.kind).toBe('rendered');
    expect(byFam.get('fam-01')?.kind).toBe('fallback');
    // Fallback tile keeps the catalogue's color even though svgData is null.
    const fb = byFam.get('fam-01') as AdaptiveTile & { kind: 'fallback' };
    expect(fb.color).toBe('#222');
  });

  it('empty silhouettesById → every tile is kind: "pending"', () => {
    // Distinguishes "catalogue not loaded yet" from "loaded but no art for
    // this family" (spec §5.1 type comment + §7 component-test manifest).
    const leaves = [leaf('fam-00'), leaf('fam-01'), leaf('fam-02')];
    const tiles = buildAdaptiveTiles(leaves, new Map(), SHAPE_2x2);
    expect(tiles).toHaveLength(3);
    for (const t of tiles) {
      expect(t.kind).toBe('pending');
    }
  });

  it('upstream silhouette resolution: identical leaves + different catalogues → different tiles', () => {
    // Spec §5.3 Concern C, point 3: the builder is pure — does NOT read
    // any module-scoped ref. Two catalogues with the same family but
    // different svgData must produce differently-resolved tiles.
    const catalogueA: SilhouettesById = new Map([
      ['fam-00', { svgData: 'M0 0Z', color: '#A0A0A0', colorDark: '#A0A0A0' }],
    ]);
    const catalogueB: SilhouettesById = new Map([
      ['fam-00', { svgData: 'M9 9Z', color: '#B0B0B0', colorDark: '#B0B0B0' }],
    ]);
    const leaves = [leaf('fam-00')];
    const a = buildAdaptiveTiles(leaves, catalogueA, SHAPE_2x2)[0];
    const b = buildAdaptiveTiles(leaves, catalogueB, SHAPE_2x2)[0];
    expect(a.kind).toBe('rendered');
    expect(b.kind).toBe('rendered');
    if (a.kind === 'rendered' && b.kind === 'rendered') {
      expect(a.svgData).toBe('M0 0Z');
      expect(b.svgData).toBe('M9 9Z');
      expect(a.color).not.toBe(b.color);
    }
  });

  it('threads per-family species arrays onto each rendered tile (#557)', () => {
    const leaves = [
      speciesLeaf('hummingbirds', "Anna's Hummingbird"),
      speciesLeaf('hummingbirds', "Anna's Hummingbird"),
      speciesLeaf('hummingbirds', "Costa's Hummingbird"),
      speciesLeaf('hawks', "Cooper's Hawk"),
    ];
    const silhouettes: SilhouettesById = new Map([
      ['hummingbirds', { svgData: 'M0 0L1 1Z', color: '#7B2D8E', colorDark: '#9637ad' }],
      ['hawks', { svgData: 'M0 0L1 1Z', color: '#444', colorDark: '#626262' }],
    ]);
    const tiles = buildAdaptiveTiles(
      leaves,
      silhouettes,
      { tag: 'grid', cols: 2, rows: 2 },
    );
    // First tile = hummingbirds (count 3, descending order)
    expect(tiles[0]?.species).toEqual([
      { comName: "Anna's Hummingbird", speciesCode: "anna's1", count: 2 },
      { comName: "Costa's Hummingbird", speciesCode: "costa'1", count: 1 },
    ]);
    // Second tile = hawks
    expect(tiles[1]?.species).toEqual([
      { comName: "Cooper's Hawk", speciesCode: "cooper1", count: 1 },
    ]);
    // Count invariant
    expect(tiles[0]?.count).toBe(3);
    expect(tiles[0]?.species.reduce((s, x) => s + x.count, 0)).toBe(tiles[0]?.count);
  });

  it('resolves a colloquial displayName per tile from the catalogue commonName (#920)', () => {
    const leaves = [leaf('fam-00'), leaf('fam-01')];
    const catalogue: SilhouettesById = new Map([
      ['fam-00', { svgData: 'M0 0Z', color: '#111', colorDark: '#111', commonName: 'Tyrant Flycatchers' }],
      // No commonName → resolver falls through to prettyFamily(familyCode).
      ['fam-01', { svgData: 'M1 1Z', color: '#222', colorDark: '#222', commonName: null }],
    ]);
    const tiles = buildAdaptiveTiles(leaves, catalogue, SHAPE_2x2);
    const byFam = new Map(tiles.map((t) => [t.familyCode, t]));
    expect(byFam.get('fam-00')?.displayName).toBe('Tyrant Flycatchers');
    expect(byFam.get('fam-01')?.displayName).toBe('Fam-01');
  });

  it('pending tiles still carry a displayName from the resolver (#920)', () => {
    // Empty catalogue → pending, but the header must NOT be blank: it falls
    // through to prettyFamily(familyCode).
    const tiles = buildAdaptiveTiles([leaf('fam-00')], new Map(), SHAPE_2x2);
    expect(tiles[0]?.kind).toBe('pending');
    expect(tiles[0]?.displayName).toBe('Fam-00');
  });
});

describe('tilesFromAggregates (#859 — bucket-mode tile builder)', () => {
  const CAT: SilhouettesById = new Map([
    ['tyrannidae', { svgData: 'M0 0Z', color: '#c3772d', colorDark: '#c3772d' }],
    ['cardinalidae', { svgData: null, color: '#b5202a', colorDark: '#b5202a' }],
  ]);

  it('builds tiles directly from pre-merged family aggregates + species map (no leaf re-count)', () => {
    const families: FamilyAggregate[] = [
      { familyCode: 'tyrannidae', count: 9 },
      { familyCode: 'cardinalidae', count: 4 },
    ];
    const speciesByFamily = new Map<string, ReadonlyArray<SpeciesAggregate>>([
      ['tyrannidae', [{ comName: 'Vermilion Flycatcher', speciesCode: 'vermfly', count: 9 }]],
      ['cardinalidae', [{ comName: 'Northern Cardinal', speciesCode: 'norcar', count: 4 }]],
    ]);
    const tiles = tilesFromAggregates(families, speciesByFamily, CAT, SHAPE_2x2);
    // Counts come straight from the aggregates — NOT a per-leaf recount.
    expect(tiles.map(t => t.count)).toEqual([9, 4]);
    expect(tiles[0]?.familyCode).toBe('tyrannidae');
    expect(tiles[0]?.kind).toBe('rendered');
    // svgData null → fallback (family-color preserved).
    expect(tiles[1]?.kind).toBe('fallback');
    // Real resolved species threaded onto the tile.
    expect(tiles[0]?.species[0]?.comName).toBe('Vermilion Flycatcher');
  });

  it('caps to visibleCapacity(shape) and empty catalogue yields pending tiles', () => {
    const families: FamilyAggregate[] = Array.from({ length: 6 }, (_, i) => ({
      familyCode: `fam-${i}`, count: 6 - i,
    }));
    const tiles = tilesFromAggregates(families, new Map(), new Map(), SHAPE_2x2);
    expect(tiles).toHaveLength(4); // 2x2 capacity
    expect(tiles.every(t => t.kind === 'pending')).toBe(true);
  });

  it('threads the per-family true speciesCount onto each tile when supplied (#859)', () => {
    const families: FamilyAggregate[] = [
      { familyCode: 'tyrannidae', count: 9 },
      { familyCode: 'cardinalidae', count: 4 },
    ];
    const speciesByFamily = new Map<string, ReadonlyArray<SpeciesAggregate>>([
      ['tyrannidae', [{ comName: 'Vermilion Flycatcher', speciesCode: 'vermfly', count: 9 }]],
      ['cardinalidae', [{ comName: 'Northern Cardinal', speciesCode: 'norcar', count: 4 }]],
    ]);
    const speciesCountByFamily = new Map<string, number>([
      ['tyrannidae', 14], // true distinct count exceeds the single shown row
      ['cardinalidae', 4],
    ]);
    const tiles = tilesFromAggregates(
      families, speciesByFamily, CAT, SHAPE_2x2, speciesCountByFamily,
    );
    expect(tiles[0]?.speciesCount).toBe(14);
    expect(tiles[1]?.speciesCount).toBe(4);
  });

  it('omits speciesCount on the tile when no count map is supplied (per-observation path stays legacy)', () => {
    const families: FamilyAggregate[] = [{ familyCode: 'tyrannidae', count: 9 }];
    const speciesByFamily = new Map<string, ReadonlyArray<SpeciesAggregate>>([
      ['tyrannidae', [{ comName: 'Vermilion Flycatcher', speciesCode: 'vermfly', count: 9 }]],
    ]);
    const tiles = tilesFromAggregates(families, speciesByFamily, CAT, SHAPE_2x2);
    expect(tiles[0]?.speciesCount).toBeUndefined();
  });

  it('resolves a colloquial displayName per tile from the catalogue commonName (#920)', () => {
    const families: FamilyAggregate[] = [
      { familyCode: 'tyrannidae', count: 9 },
      { familyCode: 'cardinalidae', count: 4 },
    ];
    const cat: SilhouettesById = new Map([
      ['tyrannidae', { svgData: 'M0 0Z', color: '#c3772d', colorDark: '#c3772d', commonName: 'Tyrant Flycatchers' }],
      // fallback kind (svgData null) still resolves a display name.
      ['cardinalidae', { svgData: null, color: '#b5202a', colorDark: '#b5202a', commonName: 'Cardinals & Allies' }],
    ]);
    const tiles = tilesFromAggregates(families, new Map(), cat, SHAPE_2x2);
    expect(tiles[0]?.displayName).toBe('Tyrant Flycatchers');
    expect(tiles[1]?.kind).toBe('fallback');
    expect(tiles[1]?.displayName).toBe('Cardinals & Allies');
  });
});

// Test fixture helper — local to aggregateClusterSpecies describe block.
// Named `speciesLeaf` to avoid collision with the `leaf(familyCode)` helper above.
function speciesLeaf(
  familyCode: string | null,
  comName: string,
  speciesCode: string | null = `${comName.slice(0, 6).toLowerCase()}1`,
): ClusterLeafFeature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-110, 32] },
    properties: { familyCode, speciesCode, comName },
  };
}

// Suppress unused-import lint for SpeciesAggregate — it's used as a type annotation
// within the describe block's inline variables; TS erases it at runtime.
void (undefined as unknown as SpeciesAggregate);

describe('aggregateClusterSpecies', () => {
  it('groups leaves by comName within familyCode', () => {
    const out = aggregateClusterSpecies([
      speciesLeaf('hummingbirds', "Anna's Hummingbird"),
      speciesLeaf('hummingbirds', "Anna's Hummingbird"),
      speciesLeaf('hummingbirds', "Costa's Hummingbird"),
    ]);
    expect(out.get('hummingbirds')).toEqual([
      { comName: "Anna's Hummingbird", speciesCode: "anna's1", count: 2 },
      { comName: "Costa's Hummingbird", speciesCode: "costa'1", count: 1 },
    ]);
  });

  it('sorts within family: descending count, ascending comName tiebreak', () => {
    const out = aggregateClusterSpecies([
      speciesLeaf('flycatchers', 'Vermilion Flycatcher'),
      speciesLeaf('flycatchers', 'Black Phoebe'),
      speciesLeaf('flycatchers', 'Black Phoebe'),
      speciesLeaf('flycatchers', "Say's Phoebe"),
    ]);
    const fams = out.get('flycatchers')!;
    expect(fams.map((s) => s.comName)).toEqual([
      'Black Phoebe',         // count 2
      "Say's Phoebe",         // count 1, S < V
      'Vermilion Flycatcher', // count 1
    ]);
  });

  it('drops leaves with null familyCode', () => {
    const out = aggregateClusterSpecies([
      speciesLeaf(null, 'Unknown bird sp.'),
      speciesLeaf('hummingbirds', "Anna's Hummingbird"),
    ]);
    expect(Array.from(out.keys())).toEqual(['hummingbirds']);
  });

  it('preserves leaves with null speciesCode (spuh/slash/hybrid)', () => {
    const out = aggregateClusterSpecies([
      speciesLeaf('sandpipers', 'Sandpiper sp.', null),
      speciesLeaf('sandpipers', 'Sandpiper sp.', null),
    ]);
    expect(out.get('sandpipers')).toEqual([
      { comName: 'Sandpiper sp.', speciesCode: null, count: 2 },
    ]);
  });

  it('merges multiple comName entries — first non-null speciesCode wins', () => {
    const out = aggregateClusterSpecies([
      speciesLeaf('hawks', 'Cooper\'s Hawk', null),
      speciesLeaf('hawks', 'Cooper\'s Hawk', 'coohaw'),
      speciesLeaf('hawks', 'Cooper\'s Hawk', 'coohaw'),
    ]);
    expect(out.get('hawks')).toEqual([
      { comName: "Cooper's Hawk", speciesCode: 'coohaw', count: 3 },
    ]);
  });

  it('count reconciliation: sum of family aggregate equals leaf count', () => {
    const leaves = [
      speciesLeaf('hummingbirds', "Anna's Hummingbird"),
      speciesLeaf('hummingbirds', "Anna's Hummingbird"),
      speciesLeaf('hummingbirds', "Costa's Hummingbird"),
      speciesLeaf('hawks', "Cooper's Hawk"),
    ];
    const out = aggregateClusterSpecies(leaves);
    const hummSum = out.get('hummingbirds')!.reduce((s, x) => s + x.count, 0);
    const hawkSum = out.get('hawks')!.reduce((s, x) => s + x.count, 0);
    expect(hummSum).toBe(3);
    expect(hawkSum).toBe(1);
  });

  it('empty leaves → empty map', () => {
    expect(aggregateClusterSpecies([])).toEqual(new Map());
  });

  it('single leaf → single-species single-family entry', () => {
    const out = aggregateClusterSpecies([speciesLeaf('hummingbirds', "Anna's Hummingbird")]);
    expect(out.size).toBe(1);
    expect(out.get('hummingbirds')).toEqual([
      { comName: "Anna's Hummingbird", speciesCode: "anna's1", count: 1 },
    ]);
  });

  it('degenerate: same comName with conflicting speciesCodes — first non-null wins', () => {
    const out = aggregateClusterSpecies([
      speciesLeaf('warblers', 'Yellow Warbler', 'yelwar'),
      speciesLeaf('warblers', 'Yellow Warbler', 'yelwar2'),  // hypothetical bad data
    ]);
    expect(out.get('warblers')).toEqual([
      { comName: 'Yellow Warbler', speciesCode: 'yelwar', count: 2 },
    ]);
  });
});

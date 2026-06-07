import { describe, it, expect } from 'vitest';
import type { AggregatedBucket, AggregatedFamily } from '@bird-watch/shared-types';
import {
  mergeBucketFamilies,
  resolveSpeciesRows,
  familyCountsFromBuckets,
  deriveFamiliesFromBuckets,
  totalCountFromBuckets,
  mergeLeafBuckets,
  TOP_SPECIES_PER_FAMILY,
} from './bucket-aggregates.js';

const dict = new Map<string, { comName: string; familyCode: string }>([
  ['vermfly', { comName: 'Vermilion Flycatcher', familyCode: 'tyrannidae' }],
  ['wesfly', { comName: 'Western Flycatcher', familyCode: 'tyrannidae' }],
  ['norcar', { comName: 'Northern Cardinal', familyCode: 'cardinalidae' }],
]);

function fam(
  code: string,
  count: number,
  speciesCount: number,
  species: Array<{ code: string; count: number }>,
): AggregatedFamily {
  return { code, count, speciesCount, species };
}

describe('mergeBucketFamilies', () => {
  it('merges the same family across buckets, summing counts and re-capping species top-8 by summed count', () => {
    const a: AggregatedFamily[] = [
      fam('tyrannidae', 5, 2, [{ code: 'vermfly', count: 3 }, { code: 'wesfly', count: 2 }]),
    ];
    const b: AggregatedFamily[] = [
      fam('tyrannidae', 4, 2, [{ code: 'wesfly', count: 3 }, { code: 'vermfly', count: 1 }]),
    ];
    const merged = mergeBucketFamilies([a, b]);
    expect(merged).toHaveLength(1);
    const t = merged[0]!;
    expect(t.code).toBe('tyrannidae');
    // count is the EXACT summed family observation count.
    expect(t.count).toBe(9);
    // species merged by code: wesfly 2+3=5, vermfly 3+1=4 → sorted desc.
    expect(t.species.map(s => s.code)).toEqual(['wesfly', 'vermfly']);
    expect(t.species[0]).toEqual({ code: 'wesfly', count: 5 });
    expect(t.species[1]).toEqual({ code: 'vermfly', count: 4 });
  });

  it('orders families by summed observation count descending (ties by code asc)', () => {
    const a: AggregatedFamily[] = [
      fam('tyrannidae', 3, 1, [{ code: 'vermfly', count: 3 }]),
      fam('cardinalidae', 3, 1, [{ code: 'norcar', count: 3 }]),
    ];
    const b: AggregatedFamily[] = [fam('tyrannidae', 5, 1, [{ code: 'vermfly', count: 5 }])];
    const merged = mergeBucketFamilies([a, b]);
    expect(merged.map(f => f.code)).toEqual(['tyrannidae', 'cardinalidae']);
    expect(merged[0]!.count).toBe(8);
  });

  it('caps the merged species list at TOP_SPECIES_PER_FAMILY', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ code: `sp${i}`, count: 12 - i }));
    const a: AggregatedFamily[] = [fam('tyrannidae', 78, 12, many)];
    const merged = mergeBucketFamilies([a]);
    expect(merged[0]!.species).toHaveLength(TOP_SPECIES_PER_FAMILY);
    // top-8 by count: sp0..sp7.
    expect(merged[0]!.species.map(s => s.code)).toEqual(
      ['sp0', 'sp1', 'sp2', 'sp3', 'sp4', 'sp5', 'sp6', 'sp7'],
    );
  });

  it('sums speciesCount across buckets (approximate across cells — documented behaviour)', () => {
    const a: AggregatedFamily[] = [fam('tyrannidae', 5, 2, [{ code: 'vermfly', count: 5 }])];
    const b: AggregatedFamily[] = [fam('tyrannidae', 4, 3, [{ code: 'wesfly', count: 4 }])];
    const merged = mergeBucketFamilies([a, b]);
    // 2 + 3 — an across-cell approximation (a species split across two cells
    // is double-counted). Accepted per #859; only used for the "+N more" hint.
    expect(merged[0]!.speciesCount).toBe(5);
  });
});

describe('resolveSpeciesRows', () => {
  it('resolves codes to comName via the dictionary, preserving count and code, sorted desc', () => {
    const f = fam('tyrannidae', 9, 2, [
      { code: 'wesfly', count: 5 },
      { code: 'vermfly', count: 4 },
    ]);
    const rows = resolveSpeciesRows(f, dict);
    expect(rows).toEqual([
      { speciesCode: 'wesfly', comName: 'Western Flycatcher', count: 5 },
      { speciesCode: 'vermfly', comName: 'Vermilion Flycatcher', count: 4 },
    ]);
  });

  it('falls back to the bare code (never a Latin family code, never a crash) when the dictionary lacks the species', () => {
    const f = fam('tyrannidae', 2, 1, [{ code: 'unksp', count: 2 }]);
    const rows = resolveSpeciesRows(f, dict);
    expect(rows[0]!.comName).toBe('unksp');
    expect(rows[0]!.speciesCode).toBe('unksp');
    // Must NOT be the family code ("tyrannidae") — the old synthetic bug.
    expect(rows[0]!.comName).not.toBe('tyrannidae');
  });
});

describe('familyCountsFromBuckets / deriveFamiliesFromBuckets', () => {
  const buckets: AggregatedBucket[] = [
    {
      lat: 31, lng: -111, count: 9, speciesCount: 3,
      families: [
        fam('tyrannidae', 5, 2, [{ code: 'vermfly', count: 5 }]),
        fam('cardinalidae', 4, 1, [{ code: 'norcar', count: 4 }]),
      ],
    },
    {
      lat: 40, lng: -100, count: 6, speciesCount: 1,
      families: [fam('tyrannidae', 6, 1, [{ code: 'vermfly', count: 6 }])],
    },
  ];

  it('returns EXACT per-family counts summed from families[].count (never the capped species list)', () => {
    const counts = familyCountsFromBuckets(buckets);
    // tyrannidae present in both buckets: 5 + 6 = 11 (exact family count).
    expect(counts.get('tyrannidae')).toBe(11);
    expect(counts.get('cardinalidae')).toBe(4);
  });

  it('a family present in ANY bucket appears in the derived legend options', () => {
    const fams = deriveFamiliesFromBuckets(buckets);
    expect(fams.map(f => f.code).sort()).toEqual(['cardinalidae', 'tyrannidae']);
    // Cold call (no name source): prettyFamily-capitalised scientific code is
    // the terminal fallback — never blank.
    expect(fams.find(f => f.code === 'tyrannidae')?.name).toBe('Tyrannidae');
  });

  it('resolves the curated colloquial name from the silhouette name source (#921)', () => {
    const names = new Map<string, string | null>([
      ['tyrannidae', 'Tyrant Flycatchers'],
      ['cardinalidae', 'Cardinals & Allies'],
    ]);
    const fams = deriveFamiliesFromBuckets(buckets, names);
    expect(fams.find(f => f.code === 'tyrannidae')?.name).toBe('Tyrant Flycatchers');
    expect(fams.find(f => f.code === 'cardinalidae')?.name).toBe('Cardinals & Allies');
    // Switching scientific→colloquial reorders the options (sort is by display
    // name): Cardinals & Allies (C) before Tyrant Flycatchers (T).
    expect(fams.map(f => f.code)).toEqual(['cardinalidae', 'tyrannidae']);
  });

  it('prefers the server AggregatedFamily.name over the silhouette name source (#921 PR4 forward-compat)', () => {
    // A bucket family carrying a server-projected `name` (PR4) wins over the
    // silhouette commonName, per the chain name ?? commonName ?? prettyFamily.
    const serverNamed: AggregatedBucket[] = [
      {
        lat: 31, lng: -111, count: 5, speciesCount: 1,
        families: [{ code: 'tyrannidae', count: 5, speciesCount: 1, species: [], name: 'Server Flycatchers' }],
      },
    ];
    const names = new Map<string, string | null>([['tyrannidae', 'Tyrant Flycatchers']]);
    const fams = deriveFamiliesFromBuckets(serverNamed, names);
    expect(fams.find(f => f.code === 'tyrannidae')?.name).toBe('Server Flycatchers');
  });

  it('falls back to prettyFamily when the name source lacks the family (#921 cold load)', () => {
    const names = new Map<string, string | null>([['cardinalidae', 'Cardinals & Allies']]);
    const fams = deriveFamiliesFromBuckets(buckets, names);
    // tyrannidae absent from the name source → terminal prettyFamily fallback.
    expect(fams.find(f => f.code === 'tyrannidae')?.name).toBe('Tyrannidae');
  });

  it('totalCountFromBuckets sums the exact bucket totals', () => {
    expect(totalCountFromBuckets(buckets)).toBe(15);
  });
});

describe('mergeLeafBuckets (cluster of bucket-features → popover data)', () => {
  // Each "leaf" is a maplibre cluster leaf carrying its bucket's families[]
  // serialized in `properties.familiesJson` (as bucketsToGeoJson emits).
  function leaf(families: AggregatedFamily[]) {
    return { properties: { familiesJson: JSON.stringify(families) } };
  }

  it('merges member-bucket families, resolves names, and emits families + speciesByFamily + overflow', () => {
    const leaves = [
      leaf([fam('tyrannidae', 5, 2, [{ code: 'vermfly', count: 5 }])]),
      leaf([
        fam('tyrannidae', 4, 1, [{ code: 'wesfly', count: 4 }]),
        fam('cardinalidae', 3, 1, [{ code: 'norcar', count: 3 }]),
      ]),
    ];
    const merged = mergeLeafBuckets(leaves, dict);

    // families: ordered by summed count desc — tyrannidae (9) then cardinalidae (3).
    expect(merged.families.map(f => f.familyCode)).toEqual(['tyrannidae', 'cardinalidae']);
    expect(merged.families[0]!.count).toBe(9);

    // speciesByFamily: REAL resolved names, working codes.
    const tyr = merged.speciesByFamily.get('tyrannidae')!;
    expect(tyr.map(s => s.comName)).toEqual(['Vermilion Flycatcher', 'Western Flycatcher']);
    expect(tyr[0]!.speciesCode).toBe('vermfly');

    // overflowByFamily: tyrannidae speciesCount 2+1=3, shown 2 → overflow 1.
    expect(merged.overflowByFamily.get('tyrannidae')).toBe(1);

    // speciesCountByFamily: the merged TRUE distinct-species count per family,
    // threaded onto tiles so the per-family CellPopover sizes its "+N more"
    // (#859). tyrannidae 2+1=3; cardinalidae 1.
    expect(merged.speciesCountByFamily.get('tyrannidae')).toBe(3);
    expect(merged.speciesCountByFamily.get('cardinalidae')).toBe(1);
  });

  it('tolerates a leaf with malformed/absent familiesJson (never throws)', () => {
    const leaves = [
      { properties: { familiesJson: '[' } },     // malformed
      { properties: {} },                         // missing
      leaf([fam('tyrannidae', 2, 1, [{ code: 'vermfly', count: 2 }])]),
    ];
    const merged = mergeLeafBuckets(leaves, dict);
    expect(merged.families.map(f => f.familyCode)).toEqual(['tyrannidae']);
    expect(merged.families[0]!.count).toBe(2);
  });
});

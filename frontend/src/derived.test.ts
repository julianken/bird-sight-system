import { describe, it, expect } from 'vitest';
import type { Observation } from '@bird-watch/shared-types';
import { deriveFamilies, deriveSpeciesIndex, resolveFamilyName } from './derived.js';

function obs(partial: Partial<Observation>): Observation {
  return {
    subId: partial.subId ?? 'S000',
    speciesCode: partial.speciesCode ?? 'vermfly',
    comName: partial.comName ?? 'Vermilion Flycatcher',
    lat: 32.2,
    lng: -110.9,
    obsDt: partial.obsDt ?? '2026-04-15T15:00:00Z',
    locId: 'L001',
    locName: partial.locName ?? 'Sabino Canyon',
    howMany: partial.howMany ?? 1,
    isNotable: partial.isNotable ?? false,
    silhouetteId: partial.silhouetteId ?? null,
    familyCode: partial.familyCode ?? null,
    ...(partial.taxonOrder !== undefined ? { taxonOrder: partial.taxonOrder } : {}),
  };
}

describe('deriveSpeciesIndex', () => {
  it('returns one entry per unique speciesCode', () => {
    const index = deriveSpeciesIndex([
      obs({ speciesCode: 'vermfly', comName: 'Vermilion Flycatcher' }),
      obs({ speciesCode: 'cacwre', comName: 'Cactus Wren' }),
      obs({ speciesCode: 'vermfly', comName: 'Vermilion Flycatcher' }),
    ]);
    expect(index).toHaveLength(2);
  });

  it('exposes taxonOrder and familyCode on each entry', () => {
    const index = deriveSpeciesIndex([
      obs({
        speciesCode: 'vermfly',
        comName: 'Vermilion Flycatcher',
        familyCode: 'tyrannidae',
        taxonOrder: 30501,
      }),
    ]);
    expect(index[0]).toEqual({
      code: 'vermfly',
      comName: 'Vermilion Flycatcher',
      familyCode: 'tyrannidae',
      taxonOrder: 30501,
    });
  });

  it('emits null familyCode when the observation carries no familyCode', () => {
    // #57: silhouetteId is NO LONGER a fallback for familyCode. A species
    // missing from species_meta yields null, and callers (deriveFamilies)
    // skip those rows rather than bucketing under a synthetic family.
    const index = deriveSpeciesIndex([
      obs({
        speciesCode: 'annhum',
        comName: "Anna's Hummingbird",
        silhouetteId: 'trochilidae',
        familyCode: null,
      }),
    ]);
    expect(index[0]?.familyCode).toBeNull();
  });

  it('emits null taxonOrder when the observation carries no taxonOrder', () => {
    const index = deriveSpeciesIndex([
      obs({ speciesCode: 'abc', comName: 'A Bird' }),
    ]);
    expect(index[0]?.taxonOrder).toBeNull();
  });

  it('sorts entries alphabetically by comName (existing contract)', () => {
    const index = deriveSpeciesIndex([
      obs({ speciesCode: 'vermfly', comName: 'Vermilion Flycatcher' }),
      obs({ speciesCode: 'cacwre', comName: 'Cactus Wren' }),
    ]);
    expect(index.map(s => s.code)).toEqual(['cacwre', 'vermfly']);
  });
});

describe('deriveFamilies', () => {
  it('groups by familyCode', () => {
    const families = deriveFamilies([
      obs({ speciesCode: 'vermfly', familyCode: 'tyrannidae' }),
    ]);
    expect(families.map(f => f.code)).toEqual(['tyrannidae']);
  });

  it('ignores silhouetteId entirely — two families sharing a silhouette id still bucket by familyCode', () => {
    // Regression guard for #57: the old code fell back to silhouetteId,
    // which meant two distinct families rendered under one bucket if
    // they happened to share a silhouette id. Now familyCode drives the
    // bucket, so a shared silhouette id has no effect on grouping.
    const families = deriveFamilies([
      obs({ speciesCode: 'a', familyCode: 'tyrannidae', silhouetteId: 'shared' }),
      obs({ speciesCode: 'b', familyCode: 'trochilidae', silhouetteId: 'shared' }),
    ]);
    expect(families.map(f => f.code).sort()).toEqual(['trochilidae', 'tyrannidae']);
  });

  it('de-dupes across observations that share the same family', () => {
    const families = deriveFamilies([
      obs({ speciesCode: 'vermfly', familyCode: 'tyrannidae' }),
      obs({ speciesCode: 'cacwre', familyCode: 'tyrannidae' }),
    ]);
    expect(families).toHaveLength(1);
  });

  it('skips observations whose familyCode is null rather than bucketing them under a synthetic family', () => {
    const families = deriveFamilies([
      obs({ speciesCode: 'mystery', familyCode: null, silhouetteId: 'orphan' }),
      obs({ speciesCode: 'vermfly', familyCode: 'tyrannidae' }),
    ]);
    expect(families.map(f => f.code)).toEqual(['tyrannidae']);
  });

  it('skips observations with no family at all', () => {
    const families = deriveFamilies([
      obs({ speciesCode: 'mystery', familyCode: null, silhouetteId: null }),
    ]);
    expect(families).toEqual([]);
  });

  it('resolves the curated colloquial name from the name source (#921)', () => {
    const names = new Map<string, string | null>([
      ['tyrannidae', 'Tyrant Flycatchers'],
      ['ardeidae', 'Herons & Egrets'],
    ]);
    const families = deriveFamilies(
      [
        obs({ speciesCode: 'vermfly', familyCode: 'tyrannidae' }),
        obs({ speciesCode: 'greheR', familyCode: 'ardeidae' }),
      ],
      names,
    );
    // Sorted by display name: Herons & Egrets (H) before Tyrant Flycatchers (T).
    expect(families.map(f => f.code)).toEqual(['ardeidae', 'tyrannidae']);
    expect(families.find(f => f.code === 'tyrannidae')?.name).toBe('Tyrant Flycatchers');
    expect(families.find(f => f.code === 'ardeidae')?.name).toBe('Herons & Egrets');
  });

  it('falls back to prettyFamily when the name source is absent or lacks the family (#921 cold load)', () => {
    // No name source at all.
    const cold = deriveFamilies([obs({ speciesCode: 'vermfly', familyCode: 'tyrannidae' })]);
    expect(cold.find(f => f.code === 'tyrannidae')?.name).toBe('Tyrannidae');
    // Name source present but missing this family.
    const partial = deriveFamilies(
      [obs({ speciesCode: 'vermfly', familyCode: 'tyrannidae' })],
      new Map<string, string | null>([['ardeidae', 'Herons & Egrets']]),
    );
    expect(partial.find(f => f.code === 'tyrannidae')?.name).toBe('Tyrannidae');
  });
});

describe('resolveFamilyName', () => {
  // The 3-way precedence chain (issue #920): family.name (server, PR4) wins,
  // then silhouette.commonName (the entire visible win today), then the
  // prettyFamily capitalized-code fallback.
  it('prefers `name` over `commonName` over `prettyFamily`', () => {
    expect(
      resolveFamilyName('tyrannidae', {
        name: 'Tyrant Flycatchers (server)',
        commonName: 'Tyrant Flycatchers (silhouette)',
      }),
    ).toBe('Tyrant Flycatchers (server)');
  });

  it('falls through to `commonName` when `name` is absent', () => {
    expect(
      resolveFamilyName('tyrannidae', { commonName: 'Tyrant Flycatchers' }),
    ).toBe('Tyrant Flycatchers');
  });

  it('falls through to `commonName` when `name` is null/undefined', () => {
    expect(
      resolveFamilyName('tyrannidae', { name: null, commonName: 'Tyrant Flycatchers' }),
    ).toBe('Tyrant Flycatchers');
    expect(
      resolveFamilyName('tyrannidae', { name: undefined, commonName: 'Tyrant Flycatchers' }),
    ).toBe('Tyrant Flycatchers');
  });

  it('falls through to `prettyFamily(familyCode)` when both names are absent', () => {
    expect(resolveFamilyName('tyrannidae')).toBe('Tyrannidae');
    expect(resolveFamilyName('tyrannidae', {})).toBe('Tyrannidae');
    expect(
      resolveFamilyName('tyrannidae', { name: null, commonName: null }),
    ).toBe('Tyrannidae');
  });

  it('returns "" for empty/undefined familyCode when no names are supplied — matching prettyFamily', () => {
    expect(resolveFamilyName('')).toBe('');
    expect(resolveFamilyName('', {})).toBe('');
    expect(resolveFamilyName('', { name: null, commonName: null })).toBe('');
  });

  it('a supplied name still wins even when the familyCode is empty', () => {
    // Defensive: the resolver trusts the explicit name over the (empty) code.
    expect(resolveFamilyName('', { commonName: 'Tyrant Flycatchers' })).toBe(
      'Tyrant Flycatchers',
    );
  });
});

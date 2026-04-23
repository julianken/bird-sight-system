import { describe, it, expect } from 'vitest';
import type { Observation } from '@bird-watch/shared-types';
import { deriveFamilies, deriveSpeciesIndex } from './derived.js';

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
    regionId: null,
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
});

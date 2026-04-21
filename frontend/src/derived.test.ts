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
    ...(partial.familyCode !== undefined ? { familyCode: partial.familyCode } : {}),
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

  it('falls back to silhouetteId for familyCode when familyCode is absent', () => {
    const index = deriveSpeciesIndex([
      obs({
        speciesCode: 'annhum',
        comName: "Anna's Hummingbird",
        silhouetteId: 'trochilidae',
        // familyCode intentionally omitted — schema back-compat path.
      }),
    ]);
    expect(index[0]?.familyCode).toBe('trochilidae');
  });

  it('prefers familyCode over silhouetteId when both are present', () => {
    const index = deriveSpeciesIndex([
      obs({
        speciesCode: 'vermfly',
        comName: 'Vermilion Flycatcher',
        familyCode: 'tyrannidae',
        silhouetteId: 'legacy-silhouette',
      }),
    ]);
    expect(index[0]?.familyCode).toBe('tyrannidae');
  });

  it('emits null taxonOrder when the observation carries no taxonOrder', () => {
    const index = deriveSpeciesIndex([
      obs({ speciesCode: 'abc', comName: 'A Bird' }),
    ]);
    expect(index[0]?.taxonOrder).toBeNull();
  });

  it('emits null familyCode when neither familyCode nor silhouetteId is present', () => {
    const index = deriveSpeciesIndex([
      obs({ speciesCode: 'mystery', comName: 'Mystery Bird' }),
    ]);
    expect(index[0]?.familyCode).toBeNull();
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
  it('reads familyCode first when present', () => {
    const families = deriveFamilies([
      obs({ speciesCode: 'vermfly', familyCode: 'tyrannidae', silhouetteId: 'legacy' }),
    ]);
    expect(families.map(f => f.code)).toEqual(['tyrannidae']);
  });

  it('falls back to silhouetteId when familyCode is absent', () => {
    const families = deriveFamilies([
      obs({ speciesCode: 'annhum', silhouetteId: 'trochilidae' }),
    ]);
    expect(families.map(f => f.code)).toEqual(['trochilidae']);
  });

  it('de-dupes across observations that share the same family', () => {
    const families = deriveFamilies([
      obs({ speciesCode: 'vermfly', familyCode: 'tyrannidae' }),
      obs({ speciesCode: 'cacwre', familyCode: 'tyrannidae' }),
    ]);
    expect(families).toHaveLength(1);
  });

  it('ignores observations whose family cannot be resolved', () => {
    const families = deriveFamilies([
      obs({ speciesCode: 'mystery', silhouetteId: null }),
    ]);
    expect(families).toEqual([]);
  });
});

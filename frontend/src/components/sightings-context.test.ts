import { describe, it, expect } from 'vitest';
import type { Observation } from '@bird-watch/shared-types';
import {
  observationToSightingRow,
  leafToSightingRow,
  gridMultiplierForZoom,
  type SightingRow,
} from './sightings-context.js';

/**
 * A full Observation as returned by /api/observations (zoom >= 6 per-observation
 * path). `locId` is present here — but the narrow SightingRow deliberately drops
 * it (cluster leaves never carry it, so the two seams must agree on the same
 * narrow projection).
 */
const OBS: Observation = {
  subId: 'OBS-1',
  speciesCode: 'vermfly',
  comName: 'Vermilion Flycatcher',
  lat: 32.22,
  lng: -110.97,
  obsDt: '2026-04-15T10:00:00Z',
  locId: 'L9',
  locName: 'Sweetwater Wetlands',
  howMany: 3,
  isNotable: true,
  silhouetteId: 'tyrannidae',
  familyCode: 'tyrannidae',
  taxonOrder: 4400,
};

describe('observationToSightingRow', () => {
  it('projects the six rendered fields from a full Observation', () => {
    const row = observationToSightingRow(OBS);
    expect(row).toEqual<SightingRow>({
      subId: 'OBS-1',
      speciesCode: 'vermfly',
      obsDt: '2026-04-15T10:00:00Z',
      locName: 'Sweetwater Wetlands',
      howMany: 3,
      isNotable: true,
    });
  });

  it('does NOT carry locId or silhouetteId onto the narrow row', () => {
    const row = observationToSightingRow(OBS) as Record<string, unknown>;
    expect('locId' in row).toBe(false);
    expect('silhouetteId' in row).toBe(false);
  });

  it('preserves a null locName / null howMany', () => {
    const row = observationToSightingRow({ ...OBS, locName: null, howMany: null });
    expect(row.locName).toBeNull();
    expect(row.howMany).toBeNull();
  });
});

describe('leafToSightingRow', () => {
  it('reads subId/speciesCode/obsDt/locName/howMany/isNotable off stamped leaf properties', () => {
    const row = leafToSightingRow({
      geometry: { coordinates: [-110.85, 32.27] },
      properties: {
        subId: 'S001',
        speciesCode: 'verdin',
        comName: 'Verdin',
        obsDt: '2026-04-15T11:30:00Z',
        locName: 'Tucson, AZ',
        howMany: 2,
        isNotable: false,
        // sprite-remapped fallback id — must NOT be trusted/used.
        silhouetteId: '_FALLBACK',
        familyCode: 'remizidae',
      },
    });
    expect(row).toEqual<SightingRow>({
      subId: 'S001',
      speciesCode: 'verdin',
      obsDt: '2026-04-15T11:30:00Z',
      locName: 'Tucson, AZ',
      howMany: 2,
      isNotable: false,
    });
  });

  it('tolerates a null locName / null howMany / null speciesCode (spuh leaf)', () => {
    const row = leafToSightingRow({
      geometry: { coordinates: [0, 0] },
      properties: {
        subId: 'S002',
        speciesCode: null,
        comName: 'gull sp.',
        obsDt: '2026-04-15T09:00:00Z',
        locName: null,
        howMany: null,
        isNotable: false,
      },
    });
    expect(row.locName).toBeNull();
    expect(row.howMany).toBeNull();
    // a null species code maps to '' — it can never match a real species code,
    // so such a leaf is silently excluded from any per-species log.
    expect(row.speciesCode).toBe('');
  });
});

describe('gridMultiplierForZoom', () => {
  // The SINGLE frontend copy of the read-api app.ts zoom->grid_multiplier switch
  // (`zoom <= 3 ? 2 : zoom === 4 ? 4 : 8`). These cases pin it byte-for-byte
  // against that switch so it can never silently drift into a half/double cell.
  it('maps zoom <= 3 to 2', () => {
    expect(gridMultiplierForZoom(0)).toBe(2);
    expect(gridMultiplierForZoom(3)).toBe(2);
  });
  it('maps zoom === 4 to 4', () => {
    expect(gridMultiplierForZoom(4)).toBe(4);
  });
  it('maps zoom 5 (and above) to 8', () => {
    expect(gridMultiplierForZoom(5)).toBe(8);
    expect(gridMultiplierForZoom(17)).toBe(8);
  });
  it('requires the FLOORED integer zoom: a raw 4.7 float misclassifies', () => {
    // Documents the input contract — callers MUST pass Math.floor(zoom). A raw
    // 4.7 would resolve to 8 instead of the correct 4 for the bucketing tier.
    expect(gridMultiplierForZoom(4.7)).toBe(8);
    expect(gridMultiplierForZoom(Math.floor(4.7))).toBe(4);
  });
});

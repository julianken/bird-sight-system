import { describe, it, expect } from 'vitest';
import { toObservationInput } from './transform.js';
import type { EbirdObservation } from './ebird/types.js';

const sample: EbirdObservation = {
  speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
  sciName: 'Pyrocephalus rubinus', locId: 'L1', locName: 'Madera',
  obsDt: '2026-04-15 08:00', howMany: 2, lat: 31.72, lng: -110.88,
  obsValid: true, obsReviewed: false, locationPrivate: false, subId: 'S100',
};

describe('toObservationInput', () => {
  it('maps fields and parses obsDt to ISO', () => {
    const out = toObservationInput(sample, new Set());
    expect(out.subId).toBe('S100');
    expect(out.speciesCode).toBe('vermfly');
    expect(out.lat).toBe(31.72);
    expect(out.lng).toBe(-110.88);
    expect(out.obsDt).toBe('2026-04-15T08:00:00.000Z');
    expect(out.howMany).toBe(2);
    expect(out.isNotable).toBe(false);
  });

  it('marks is_notable=true when sub_id is in the notable set', () => {
    const notableKeys = new Set(['S100|vermfly']);
    const out = toObservationInput(sample, notableKeys);
    expect(out.isNotable).toBe(true);
  });

  it('handles missing howMany (defaults to null)', () => {
    const { howMany, ...rest } = sample;
    const out = toObservationInput(rest as EbirdObservation, new Set());
    expect(out.howMany).toBeNull();
  });
});

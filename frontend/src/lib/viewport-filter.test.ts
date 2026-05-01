import { describe, it, expect } from 'vitest';
import { LngLatBounds } from 'maplibre-gl';
import type { Observation } from '@bird-watch/shared-types';
import { filterObservationsByBounds } from './viewport-filter.js';

/**
 * Test helper: build an Observation with the bare minimum fields the
 * filter needs (lat, lng) plus the required schema fields. The filter
 * only reads `lat`/`lng`; everything else is ignored.
 */
function obs(subId: string, lat: number, lng: number): Observation {
  return {
    subId,
    speciesCode: 'x',
    comName: 'X',
    lat,
    lng,
    obsDt: '2026-04-15T12:00:00Z',
    locId: 'L1',
    locName: 'X',
    howMany: 1,
    isNotable: false,
    regionId: null,
    silhouetteId: null,
    familyCode: null,
  };
}

describe('filterObservationsByBounds', () => {
  it('returns the input unchanged when bounds is null', () => {
    const observations = [obs('A', 32.2, -110.9), obs('B', 35.2, -111.6)];
    const result = filterObservationsByBounds(observations, null);
    // Pin the referential-equality contract: the helper documents
    // "returns the input array unchanged" so the App.tsx memo can
    // reuse the same identity downstream when no filtering applies.
    // `.toBe` (Object.is) catches a regression that would still pass
    // `.toEqual` (deep equality) — e.g. a refactor returning
    // `[...observations]` for "consistency".
    expect(result).toBe(observations);
  });

  it('returns an empty array when input is empty', () => {
    const bounds = new LngLatBounds([-112, 32], [-110, 34]);
    expect(filterObservationsByBounds([], bounds)).toEqual([]);
  });

  it('returns only observations whose [lng, lat] is contained in the bounds', () => {
    // Tucson box covers ~32.0–32.5 lat, -111.2 to -110.6 lng.
    const bounds = new LngLatBounds([-111.2, 32.0], [-110.6, 32.5]);
    const inside = obs('IN', 32.25, -110.95);
    const outside = obs('OUT', 35.2, -111.65);
    const alsoInside = obs('IN2', 32.05, -110.7);
    const result = filterObservationsByBounds(
      [inside, outside, alsoInside],
      bounds,
    );
    expect(result).toEqual([inside, alsoInside]);
  });

  it('treats exact boundary points as inclusive (LngLatBounds.contains is inclusive)', () => {
    // Box [-111.0, 32.0] → [-110.0, 33.0]. Corner + edge midpoints all in.
    const bounds = new LngLatBounds([-111.0, 32.0], [-110.0, 33.0]);
    const sw = obs('SW', 32.0, -111.0);
    const ne = obs('NE', 33.0, -110.0);
    const nw = obs('NW', 33.0, -111.0);
    const se = obs('SE', 32.0, -110.0);
    const edgeN = obs('EN', 33.0, -110.5);
    const edgeS = obs('ES', 32.0, -110.5);
    const result = filterObservationsByBounds(
      [sw, ne, nw, se, edgeN, edgeS],
      bounds,
    );
    expect(result).toEqual([sw, ne, nw, se, edgeN, edgeS]);
  });

  it('handles a degenerate single-point bounds (sw === ne) and matches only that exact point', () => {
    const bounds = new LngLatBounds([-110.95, 32.25], [-110.95, 32.25]);
    const exact = obs('EXACT', 32.25, -110.95);
    const off = obs('OFF', 32.26, -110.95);
    const result = filterObservationsByBounds([exact, off], bounds);
    expect(result).toEqual([exact]);
  });

  it('returns all observations when the bounds fully encloses the cluster', () => {
    const bounds = new LngLatBounds([-115, 30], [-105, 38]); // wide AZ envelope
    const cluster = [
      obs('A', 32.20, -110.95),
      obs('B', 32.25, -111.00),
      obs('C', 32.30, -110.85),
    ];
    expect(filterObservationsByBounds(cluster, bounds)).toEqual(cluster);
  });

  it('returns an empty array when no observation falls inside the bounds', () => {
    const bounds = new LngLatBounds([-112, 32], [-111, 33]);
    const observations = [obs('A', 35.2, -110.0), obs('B', 28.0, -100.0)];
    expect(filterObservationsByBounds(observations, bounds)).toEqual([]);
  });

  it('preserves input order in the output (filter, not sort)', () => {
    const bounds = new LngLatBounds([-115, 30], [-105, 38]);
    const a = obs('A', 32.20, -110.95);
    const b = obs('B', 32.25, -111.00);
    const c = obs('C', 32.30, -110.85);
    expect(filterObservationsByBounds([c, a, b], bounds)).toEqual([c, a, b]);
  });
});

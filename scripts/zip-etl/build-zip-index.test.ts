/**
 * Unit tests for the ZIP ETL transform — no network, no .cache/ read.
 *
 * The gazetteer rows are a 10-row in-memory fixture (8 CONUS + 1 HI + 1 ocean
 * centroid) using REAL 2020 ZCTA centroids for the named ZIPs, so the spot
 * checks (85701→US-AZ, 10001→US-NY, 96813→dropped) are genuine. PIP runs
 * against the committed canonical `data/us-state-polygons.geojson` — the SAME
 * artifact the server clip seeds from — so a regression in either the polygons
 * or the PIP shows up here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import {
  parseGazetteerLine,
  parseGazetteer,
  buildZipIndex,
  ZIP_INDEX_VERSION,
} from './build-zip-index.ts';
import {
  assertStateCodeSorted,
  type StatePolygonCollection,
  type StatePolygonFeature,
} from './state-polygons.ts';

const here = dirname(fileURLToPath(import.meta.url));
const polyPath = resolvePath(here, '..', '..', 'data', 'us-state-polygons.geojson');
const collection = JSON.parse(
  readFileSync(polyPath, 'utf8'),
) as StatePolygonCollection;

/**
 * 10-row fixture mirroring the real gazetteer format: tab-separated, a header
 * row, fields padded with trailing whitespace. Centroids are the genuine 2020
 * ZCTA values. ALAND/AWATER columns are filled with placeholders — the ETL only
 * reads GEOID + INTPTLAT + INTPTLONG.
 *
 *   CONUS (8): 85701 AZ, 10001 NY, 01001 MA, 20001 DC, 33101 FL,
 *              88220 NM, 89501 NV, 98101 WA
 *   dropped (2): 96813 HI, 99999 synthetic mid-Pacific ocean centroid
 */
const FIXTURE = [
  'GEOID\tALAND\tAWATER\tALAND_SQMI\tAWATER_SQMI\tINTPTLAT\tINTPTLONG   ',
  '85701\t1\t0\t0\t0\t32.216957\t-110.970995  ',
  '10001\t1\t0\t0\t0\t40.750636\t-73.997177   ',
  '01001\t1\t0\t0\t0\t42.062368\t-72.625754   ',
  '20001\t1\t0\t0\t0\t38.910353\t-77.017739   ',
  '33101\t1\t0\t0\t0\t25.779298\t-80.198739   ',
  '88220\t1\t0\t0\t0\t32.311474\t-104.431928  ',
  '89501\t1\t0\t0\t0\t39.525749\t-119.813051  ',
  '98101\t1\t0\t0\t0\t47.610902\t-122.336422  ',
  '96813\t1\t0\t0\t0\t21.316548\t-157.845053  ', // Honolulu, HI — dropped
  '99999\t1\t0\t0\t0\t30.000000\t-150.000000  ', // mid-Pacific ocean — dropped
].join('\n');

describe('parseGazetteerLine', () => {
  it('parses a padded data row, trimming trailing whitespace', () => {
    expect(parseGazetteerLine('85701\t1\t0\t0\t0\t32.216957\t-110.970995  ')).toEqual({
      zip: '85701',
      lat: 32.216957,
      lng: -110.970995,
    });
  });

  it('returns null for the header row', () => {
    expect(
      parseGazetteerLine('GEOID\tALAND\tAWATER\tALAND_SQMI\tAWATER_SQMI\tINTPTLAT\tINTPTLONG'),
    ).toBeNull();
  });

  it('returns null for blank, short, or non-numeric-ZIP lines', () => {
    expect(parseGazetteerLine('')).toBeNull();
    expect(parseGazetteerLine('85701\t1\t0')).toBeNull();
    expect(parseGazetteerLine('ABCDE\t1\t0\t0\t0\t32.2\t-110.9')).toBeNull();
    expect(parseGazetteerLine('85701\t1\t0\t0\t0\tNaN\t-110.9')).toBeNull();
  });
});

describe('assertStateCodeSorted', () => {
  /** Minimal feature carrying only the `state_code` the guard inspects. */
  const feat = (state_code: string): StatePolygonFeature =>
    ({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [] },
      properties: { state_code, name: state_code, bbox: [0, 0, 0, 0] },
    }) as StatePolygonFeature;

  it('passes for the committed canonical polygon collection', () => {
    expect(() => assertStateCodeSorted(collection)).not.toThrow();
  });

  it('passes for an ascending-by-state_code collection', () => {
    const c: StatePolygonCollection = {
      type: 'FeatureCollection',
      features: [feat('US-AL'), feat('US-AZ'), feat('US-CA')],
    };
    expect(() => assertStateCodeSorted(c)).not.toThrow();
  });

  it('throws when features are out of state_code order', () => {
    const c: StatePolygonCollection = {
      type: 'FeatureCollection',
      features: [feat('US-AZ'), feat('US-AL'), feat('US-CA')],
    };
    expect(() => assertStateCodeSorted(c)).toThrow(/not state_code-sorted/);
  });
});

describe('buildZipIndex', () => {
  const rows = parseGazetteer(FIXTURE);
  const result = buildZipIndex(rows, collection);
  const { index, dropped } = result;

  it('parses 10 data rows (header skipped)', () => {
    expect(rows).toHaveLength(10);
    expect(result.inputCount).toBe(10);
  });

  it('keeps the 8 CONUS ZCTAs and drops the 2 non-CONUS ones', () => {
    expect(Object.keys(index.zips)).toHaveLength(8);
    expect(dropped).toHaveLength(2);
    expect(dropped.map((d) => d.zip).sort()).toEqual(['96813', '99999']);
  });

  it('emits a columnar { v, states[], zips{} } shape', () => {
    expect(index.v).toBe(ZIP_INDEX_VERSION);
    expect(Array.isArray(index.states)).toBe(true);
    expect(typeof index.zips).toBe('object');
    // every zips entry is a [lat, lng, stateIdx] triple
    for (const entry of Object.values(index.zips)) {
      expect(entry).toHaveLength(3);
      expect(Number.isInteger(entry[2])).toBe(true);
      expect(index.states[entry[2]]).toMatch(/^US-[A-Z]{2}$/);
    }
  });

  it('dedupes the state palette (no repeats)', () => {
    expect(new Set(index.states).size).toBe(index.states.length);
  });

  it('rounds coordinates to 5 decimals', () => {
    for (const [lat, lng] of Object.values(index.zips)) {
      expect(lat).toBe(Number(lat.toFixed(5)));
      expect(lng).toBe(Number(lng.toFixed(5)));
    }
    // 32.216957 → 32.21696 (6th decimal rounds the 5th up)
    const az = index.zips['85701'];
    expect(az[0]).toBe(32.21696);
    expect(az[1]).toBe(-110.971);
  });

  it('spot: 85701 → US-AZ', () => {
    const [, , idx] = index.zips['85701'];
    expect(index.states[idx]).toBe('US-AZ');
  });

  it('spot: 10001 → US-NY', () => {
    const [, , idx] = index.zips['10001'];
    expect(index.states[idx]).toBe('US-NY');
  });

  it('spot: 96813 (Honolulu, HI) → dropped', () => {
    expect(index.zips['96813']).toBeUndefined();
    expect(dropped.some((d) => d.zip === '96813')).toBe(true);
  });

  it('resolves 5 additional CONUS border/varied ZIPs to the correct state', () => {
    const expected: Record<string, string> = {
      '01001': 'US-MA',
      '20001': 'US-DC', // DC is the only non-state CONUS code
      '33101': 'US-FL',
      '88220': 'US-NM', // near the TX/NM line
      '89501': 'US-NV',
      '98101': 'US-WA',
    };
    for (const [zip, code] of Object.entries(expected)) {
      const entry = index.zips[zip];
      expect(entry, `expected ${zip} kept`).toBeDefined();
      expect(index.states[entry[2]]).toBe(code);
    }
  });
});

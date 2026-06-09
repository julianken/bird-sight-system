import { describe, it, expect } from 'vitest';
import type { Observation } from '@bird-watch/shared-types';
import {
  buildObsLookup,
  buildSilhouetteRenderById,
  buildHitMarkers,
  type SilhouetteOffsets,
} from './obs-derive.js';
import type { SilhouettesById } from './adaptive-grid.js';
import { CLUSTER_MAX_ZOOM } from './observation-layers.js';

// Minimal Observation factory — only the fields the derives read are
// meaningful; the rest are filled with structurally-valid placeholders.
function obs(overrides: Partial<Observation> = {}): Observation {
  return {
    subId: 'S1',
    speciesCode: 'amerob',
    comName: 'American Robin',
    lat: 33.45,
    lng: -112.07,
    obsDt: '2026-06-08 07:00',
    locId: 'L1',
    locName: 'Papago Park',
    howMany: 1,
    isNotable: false,
    silhouetteId: null,
    familyCode: 'tyrannidae',
    ...overrides,
  };
}

// SilhouettesById is keyed by LOWERCASE familyCode (mirrors MapCanvas's
// `silhouettesById` memo, which lowercases on insert). The catalogue carries
// the curated colloquial `commonName` the resolver consumes (#920/#921).
const catalogue: SilhouettesById = new Map([
  ['tyrannidae', { svgData: 'M0 0h24v24H0z', color: '#aa0000', colorDark: '#ff6666', commonName: 'Tyrant Flycatchers' }],
]);

describe('buildObsLookup', () => {
  it('keys observations by subId', () => {
    const a = obs({ subId: 'A' });
    const b = obs({ subId: 'B' });
    const lookup = buildObsLookup([a, b]);
    expect(lookup['A']).toBe(a);
    expect(lookup['B']).toBe(b);
  });

  it('produces a prototype-free record (Object.create(null))', () => {
    const lookup = buildObsLookup([obs({ subId: 'A' })]);
    expect(Object.getPrototypeOf(lookup)).toBeNull();
    // A would-be prototype pollution key resolves to undefined, not Object.prototype.
    expect(lookup['toString']).toBeUndefined();
    expect((lookup as Record<string, unknown>)['__proto__']).toBeUndefined();
  });

  it('last write wins for duplicate subIds', () => {
    const first = obs({ subId: 'DUP', comName: 'first' });
    const second = obs({ subId: 'DUP', comName: 'second' });
    const lookup = buildObsLookup([first, second]);
    expect(lookup['DUP']).toBe(second);
  });
});

describe('buildSilhouetteRenderById', () => {
  it('resolves svgData + color from the lowercased familyCode key', () => {
    const lookup = buildSilhouetteRenderById([obs({ subId: 'A', familyCode: 'Tyrannidae' })], catalogue);
    expect(lookup.get('A')).toEqual({ svgData: 'M0 0h24v24H0z', color: '#aa0000' });
  });

  it('falls back to null svgData + neutral color when the family is absent', () => {
    const lookup = buildSilhouetteRenderById([obs({ subId: 'A', familyCode: 'unknownidae' })], catalogue);
    expect(lookup.get('A')).toEqual({ svgData: null, color: '#555' });
  });

  it('handles a null familyCode without throwing', () => {
    const lookup = buildSilhouetteRenderById([obs({ subId: 'A', familyCode: null })], catalogue);
    expect(lookup.get('A')).toEqual({ svgData: null, color: '#555' });
  });
});

describe('buildHitMarkers', () => {
  const offsets: SilhouetteOffsets = new Map();

  it('returns [] below CLUSTER_MAX_ZOOM (suppress so cluster clicks win)', () => {
    const markers = buildHitMarkers(
      [obs()],
      CLUSTER_MAX_ZOOM - 1,
      offsets,
      catalogue,
    );
    expect(markers).toEqual([]);
  });

  it('anchors at the observation lng/lat when not displaced', () => {
    const markers = buildHitMarkers(
      [obs({ subId: 'A', lng: -112.07, lat: 33.45 })],
      CLUSTER_MAX_ZOOM,
      offsets,
      catalogue,
    );
    expect(markers).toHaveLength(1);
    expect(markers[0]!.lngLat).toEqual([-112.07, 33.45]);
  });

  it('re-anchors at the displaced lng/lat when silhouetteOffsets has an entry (#247/#277)', () => {
    const displaced: SilhouetteOffsets = new Map([
      ['A', { dx: 5, dy: 5, longitude: -111.0, latitude: 34.0 }],
    ]);
    const markers = buildHitMarkers(
      [obs({ subId: 'A', lng: -112.07, lat: 33.45 })],
      CLUSTER_MAX_ZOOM,
      displaced,
      catalogue,
    );
    expect(markers[0]!.lngLat).toEqual([-111.0, 34.0]);
  });

  it('resolves familyName via resolveFamilyName from the catalogue commonName (#921 — raw code must NOT leak)', () => {
    const markers = buildHitMarkers(
      [obs({ subId: 'A', familyCode: 'tyrannidae' })],
      CLUSTER_MAX_ZOOM,
      offsets,
      catalogue,
    );
    expect(markers[0]!.familyName).toBe('Tyrant Flycatchers');
    // The raw lowercase code must never be the resolved name.
    expect(markers[0]!.familyName).not.toBe('tyrannidae');
  });

  it('lowercases familyCode when keying the catalogue', () => {
    const markers = buildHitMarkers(
      [obs({ subId: 'A', familyCode: 'Tyrannidae' })],
      CLUSTER_MAX_ZOOM,
      offsets,
      catalogue,
    );
    expect(markers[0]!.familyName).toBe('Tyrant Flycatchers');
  });

  it('leaves familyName undefined when familyCode is null', () => {
    const markers = buildHitMarkers(
      [obs({ subId: 'A', familyCode: null })],
      CLUSTER_MAX_ZOOM,
      offsets,
      catalogue,
    );
    expect(markers[0]!.familyName).toBeUndefined();
    expect(markers[0]!.familyCode).toBeNull();
  });

  it('carries through subId/comName/familyCode/locName/obsDt/isNotable verbatim', () => {
    const o = obs({
      subId: 'A',
      comName: 'American Robin',
      familyCode: 'tyrannidae',
      locName: 'Papago Park',
      obsDt: '2026-06-08 07:00',
      isNotable: true,
    });
    const markers = buildHitMarkers([o], CLUSTER_MAX_ZOOM, offsets, catalogue);
    expect(markers[0]).toMatchObject({
      subId: 'A',
      comName: 'American Robin',
      familyCode: 'tyrannidae',
      locName: 'Papago Park',
      obsDt: '2026-06-08 07:00',
      isNotable: true,
    });
  });
});

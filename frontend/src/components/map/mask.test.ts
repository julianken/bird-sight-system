import { describe, it, expect } from 'vitest';
import type { MultiPolygon, Polygon } from 'geojson';
import {
  buildMaskFeature,
  padBounds,
  ARTBOARD_PAD,
  MASK_FILL_LIGHT,
  MASK_FILL_DARK,
} from './mask.js';

/* #760/#762 — state-artboard inverse mask geometry.

   buildMaskFeature returns a single Feature<Polygon> whose coordinates are
   `[WORLD_RING, ...each part's exterior ring]` — MapLibre earcut treats ring[0]
   as the exterior and every later ring as a hole, so the world fill is punched
   out per state part (finding 2). Interior rings (lakes) are intentionally
   skipped. padBounds derives the artboard maxBounds clamp from the tight bbox,
   clamping lng to ±180 / lat to ±85 (finding 1). */

// The canonical web-mercator-safe world ring (explicitly closed, ±180/±85).
const WORLD_RING = [
  [-180, -85],
  [180, -85],
  [180, 85],
  [-180, 85],
  [-180, -85],
];

// A simple square exterior ring + an interior "lake" ring.
const part0Exterior = [
  [-114, 31],
  [-109, 31],
  [-109, 37],
  [-114, 37],
  [-114, 31],
];
const lakeRing = [
  [-112, 33],
  [-111, 33],
  [-111, 34],
  [-112, 34],
  [-112, 33],
];
const part1Exterior = [
  [-100, 25],
  [-98, 25],
  [-98, 28],
  [-100, 28],
  [-100, 25],
];

describe('buildMaskFeature', () => {
  it('returns a Feature<Polygon> with WORLD_RING first then each MultiPolygon part exterior (finding 2)', () => {
    const geometry: MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [[part0Exterior], [part1Exterior]],
    };
    const feature = buildMaskFeature(geometry);
    expect(feature.type).toBe('Feature');
    expect(feature.geometry.type).toBe('Polygon');
    expect(feature.geometry.coordinates).toEqual([
      WORLD_RING,
      part0Exterior,
      part1Exterior,
    ]);
  });

  it('punches ONLY the exterior ring of a Polygon-with-lake (interior rings skipped)', () => {
    const geometry: Polygon = {
      type: 'Polygon',
      coordinates: [part0Exterior, lakeRing],
    };
    const feature = buildMaskFeature(geometry);
    // World ring + the exterior only — the lake ring is NOT a hole.
    expect(feature.geometry.coordinates).toEqual([WORLD_RING, part0Exterior]);
    expect(feature.geometry.coordinates).not.toContainEqual(lakeRing);
  });

  it('skips lake rings per part on a MultiPolygon (exterior-only holes)', () => {
    const geometry: MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [
        [part0Exterior, lakeRing],
        [part1Exterior],
      ],
    };
    const feature = buildMaskFeature(geometry);
    expect(feature.geometry.coordinates).toEqual([
      WORLD_RING,
      part0Exterior,
      part1Exterior,
    ]);
  });
});

describe('padBounds', () => {
  it('expands the bbox outward by factor× its width/height per side', () => {
    // 10° wide, 10° tall; factor 1.0 ⇒ +10° per side.
    const padded = padBounds(
      [
        [-110, 30],
        [-100, 40],
      ],
      1.0,
    );
    expect(padded).toEqual([
      [-120, 20],
      [-90, 50],
    ]);
  });

  it('clamps longitude to ±180 and latitude to ±85 (web-mercator safe)', () => {
    // A wide near-edge bbox; a 1.0 factor would overshoot ±180 / ±85.
    const padded = padBounds(
      [
        [-170, -80],
        [170, 80],
      ],
      1.0,
    );
    const [[w, s], [e, n]] = padded;
    expect(w).toBe(-180);
    expect(s).toBe(-85);
    expect(e).toBe(180);
    expect(n).toBe(85);
  });
});

describe('mask fill constants (v3 mockup-locked colors)', () => {
  it('exposes the corrected v3 colors (NOT the dark-on-dark prototype values)', () => {
    expect(MASK_FILL_LIGHT).toBe('#d8d8d8');
    expect(MASK_FILL_DARK).toBe('#06090e');
    // Regression guard against the prototype's dark-on-dark mistake.
    expect(MASK_FILL_LIGHT).not.toBe('#e7e2d6');
    expect(MASK_FILL_DARK).not.toBe('#161b27');
  });

  it('ARTBOARD_PAD is 1.0 (≈3× envelope artboard margin)', () => {
    expect(ARTBOARD_PAD).toBe(1.0);
  });
});

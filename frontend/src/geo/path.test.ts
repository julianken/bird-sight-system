import { describe, it, expect } from 'vitest';
import {
  boundingBoxOfPath,
  parsePoints,
  pointInPolygon,
  distanceToPolygonEdge,
  largestInscribedRect,
  poleOfInaccessibility,
} from './path.js';

// Paths below are copied (not imported) from the corresponding seed rows so
// this test stays green if the parser contract changes but the seed doesn't.
const SANTA_RITAS = 'M 226.6 330.0 L 239.0 325.3 L 254.5 330.0 L 266.9 341.3 L 265.0 354.7 L 252.6 363.3 L 239.0 361.3 L 227.8 352.0 L 226.6 340.0 Z';
const SQUARE_100 = 'M 0 0 L 100 0 L 100 100 L 0 100 Z';
const TALL_L = 'M 0 0 L 50 0 L 50 50 L 100 50 L 100 100 L 0 100 Z';

describe('boundingBoxOfPath', () => {
  it('returns the correct bbox for a simple square', () => {
    expect(boundingBoxOfPath(SQUARE_100)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it('returns zero for an empty path', () => {
    expect(boundingBoxOfPath('')).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe('parsePoints', () => {
  it('parses M/L commands into points', () => {
    expect(parsePoints('M 0 0 L 10 0 L 10 10 Z')).toEqual([
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 },
    ]);
  });

  it('tolerates comma-separated coordinates', () => {
    expect(parsePoints('M 0,0 L 10,0 Z')).toEqual([
      { x: 0, y: 0 }, { x: 10, y: 0 },
    ]);
  });
});

describe('pointInPolygon', () => {
  const square = [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
  ];
  it('returns true for interior points of a square', () => {
    expect(pointInPolygon(50, 50, square)).toBe(true);
  });
  it('returns false for exterior points of a square', () => {
    expect(pointInPolygon(150, 50, square)).toBe(false);
    expect(pointInPolygon(50, -10, square)).toBe(false);
  });
});

describe('distanceToPolygonEdge', () => {
  const square = [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
  ];
  it('centre of 100x100 square is 50 from nearest edge', () => {
    expect(distanceToPolygonEdge(50, 50, square)).toBeCloseTo(50, 5);
  });
  it('corner-adjacent point has the correct distance', () => {
    expect(distanceToPolygonEdge(10, 10, square)).toBeCloseTo(10, 5);
  });
});

describe('largestInscribedRect', () => {
  it('returns (approximately) the whole square for a 100x100 square', () => {
    const r = largestInscribedRect(SQUARE_100);
    // Grid-sampled at 96 cells, each cell ~1.04×1.04; the result should
    // be very close to the full square (within a cell of each edge).
    expect(r.x).toBeLessThanOrEqual(1.1);
    expect(r.y).toBeLessThanOrEqual(1.1);
    expect(r.width).toBeGreaterThanOrEqual(98);
    expect(r.height).toBeGreaterThanOrEqual(98);
  });

  it('returns a smaller-than-bbox rectangle for a concave L-shape', () => {
    // Tall L has bbox 100×100 but the concave dent at (0..50, 0..50) makes
    // the largest inscribed rect strictly smaller than the bbox.
    const r = largestInscribedRect(TALL_L);
    const bboxArea = 100 * 100;
    const rArea = r.width * r.height;
    expect(rArea).toBeLessThan(bboxArea);
    // Best rect is either the top-right 50×50 or the bottom 100×50 — both
    // are valid; expect area at least 5000 (the bottom half).
    expect(rArea).toBeGreaterThanOrEqual(4500);
  });

  it('returns a non-bbox result for a sky-island polygon', () => {
    // Santa Ritas: bbox is ~40×38 (226.6..266.9, 325.3..363.3). The polygon
    // is concave so the inscribed rect's area must be strictly less than
    // the bbox area (40 × 38 = 1520).
    const bbox = boundingBoxOfPath(SANTA_RITAS);
    const rect = largestInscribedRect(SANTA_RITAS);
    expect(bbox.width).toBeGreaterThan(30);
    expect(bbox.height).toBeGreaterThan(30);
    const rectArea = rect.width * rect.height;
    const bboxArea = bbox.width * bbox.height;
    expect(rectArea).toBeLessThan(bboxArea);
    expect(rectArea).toBeGreaterThan(0);
    // Rect must be strictly inside the polygon bounding box.
    expect(rect.x).toBeGreaterThanOrEqual(bbox.x);
    expect(rect.y).toBeGreaterThanOrEqual(bbox.y);
    expect(rect.x + rect.width).toBeLessThanOrEqual(bbox.x + bbox.width + 1e-9);
    expect(rect.y + rect.height).toBeLessThanOrEqual(bbox.y + bbox.height + 1e-9);
  });

  it('returns zero rect for an empty path', () => {
    expect(largestInscribedRect('')).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe('poleOfInaccessibility', () => {
  it('returns the centre of a 100x100 square with radius ~50', () => {
    const p = poleOfInaccessibility(SQUARE_100);
    expect(p.x).toBeCloseTo(50, 0);
    expect(p.y).toBeCloseTo(50, 0);
    expect(p.radius).toBeGreaterThanOrEqual(49);
    expect(p.radius).toBeLessThanOrEqual(50.1);
  });

  it('returns an interior point for a concave L-shape', () => {
    const p = poleOfInaccessibility(TALL_L);
    // The pole must be inside the L; for this shape the inradius is 25
    // (half the narrower arm), centred at (75,75) in the top-right block
    // OR (25, 75) at the bottom. Both are valid; radius ≥ 20.
    expect(p.radius).toBeGreaterThanOrEqual(20);
    // Point must be inside the polygon.
    const poly = parsePoints(TALL_L);
    expect(pointInPolygon(p.x, p.y, poly)).toBe(true);
  });

  it('returns an interior point for a sky-island polygon', () => {
    const p = poleOfInaccessibility(SANTA_RITAS);
    const poly = parsePoints(SANTA_RITAS);
    expect(pointInPolygon(p.x, p.y, poly)).toBe(true);
    // Santa Ritas inradius is roughly half its short axis (~19-20 units).
    expect(p.radius).toBeGreaterThan(10);
  });

  it('returns zero radius for an empty path', () => {
    const p = poleOfInaccessibility('');
    expect(p.radius).toBe(0);
  });
});

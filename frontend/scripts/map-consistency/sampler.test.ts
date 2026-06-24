import { describe, it, expect } from 'vitest';
import { mulberry32, sampleSeedPoints } from './sampler.js';
import type { GeoPoint } from './types.js';

describe('sampler', () => {
  const pts: GeoPoint[] = [{ lng: -110, lat: 32, count: 100 }, { lng: -120, lat: 40, count: 1 }];
  it('is deterministic for a fixed seed', () => {
    expect(sampleSeedPoints(pts, 10, 7)).toEqual(sampleSeedPoints(pts, 10, 7));
  });
  it('weights by count (the count-100 point dominates the density share)', () => {
    const s = sampleSeedPoints(pts, 50, 7, 0); // uniformFrac 0 → all density-weighted
    const near110 = s.filter((p) => p.lng === -110).length;
    expect(near110).toBeGreaterThan(40);
  });
  it('mulberry32 is in [0,1)', () => {
    const r = mulberry32(1); for (let i = 0; i < 100; i++) { const v = r(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
});

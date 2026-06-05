import { describe, it, expect } from 'vitest';
import { canonicalFetchBboxParam, CONUS_BOUNDS } from '@bird-watch/geo';
import { INITIAL_BBOX_SEED, INITIAL_ZOOM_SEED } from './App.js';

// #870 — the initial `debouncedBbox` seed must canonicalize to the WARMED
// `-130,20,-65,52` key, not the cold `-129`/`-125` key, so that any code path
// which fetches off the seed before the map's first `idle` settles mints the
// key the cache-warmer already warmed (a HIT), never the legacy `-129` (a MISS).
//
// The legacy seed `[-125, 24, -66, 50]` canonicalized to `-129.00,...` at the
// initial aggregated zoom (3) — a latent foot-gun. Seeding from the geo
// `CONUS_BOUNDS` (`[-130, 20, -65, 52]`) instead makes the seed land on the
// warmed key. These are pure assertions on the exported constants; no React
// render is needed.
describe('#870 initial bbox seed canonicalizes to the warmed CONUS key', () => {
  it('seeds the initial aggregated zoom at 3 (the pre-settle, aggregated-mode zoom)', () => {
    expect(INITIAL_ZOOM_SEED).toBe(3);
  });

  it('the seed canonicalizes to the SAME key as CONUS_BOUNDS at the seed zoom', () => {
    // The load-bearing assertion: at the actual pre-settle zoom the seed is sent
    // with, the seed and the warmed CONUS envelope produce one identical key.
    expect(canonicalFetchBboxParam(INITIAL_BBOX_SEED, INITIAL_ZOOM_SEED))
      .toBe(canonicalFetchBboxParam(CONUS_BOUNDS, INITIAL_ZOOM_SEED));
  });

  it('that shared key is exactly the warmed `-130.00,20.00,-65.00,52.00`', () => {
    expect(canonicalFetchBboxParam(INITIAL_BBOX_SEED, INITIAL_ZOOM_SEED))
      .toBe('-130.00,20.00,-65.00,52.00');
  });

  it('rejects the legacy `[-125, 24, -66, 50]` seed (which minted the cold -129 key)', () => {
    // Regression guard: prove the legacy seed really did diverge at the seed
    // zoom, so this test would have caught the foot-gun before it was fixed.
    const legacySeed: [number, number, number, number] = [-125, 24, -66, 50];
    expect(canonicalFetchBboxParam(legacySeed, INITIAL_ZOOM_SEED))
      .toBe('-129.00,20.00,-65.00,52.00');
    expect(canonicalFetchBboxParam(INITIAL_BBOX_SEED, INITIAL_ZOOM_SEED))
      .not.toBe(canonicalFetchBboxParam(legacySeed, INITIAL_ZOOM_SEED));
  });
});

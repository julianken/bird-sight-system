import { describe, it, expect } from 'vitest';
import { cacheControlFor } from './cache-headers.js';

describe('cacheControlFor', () => {
  // Issue #586: switch from `max-age` (which both browser + CDN cache) to
  // `s-maxage` (CDN-only) on the four hot public read endpoints. Cloudflare
  // zone analytics reported 99.91% cache-miss over 30 days — these endpoints
  // are structurally cacheable but the responses lacked headers the CDN would
  // honor. `s-maxage=N, stale-while-revalidate=2N` targets the edge directly
  // and lets the CDN serve stale-while-revalidate windows without hammering
  // Cloud Run / Neon. Browsers are not asked to hold stale copies.

  it('returns a 40-min s-maxage with equal SWR for /observations (#870 freshness margin)', () => {
    // #868 raised this from s-maxage=300/SWR=600 to 1800/1800. #870 raises it
    // again 1800→2400: `s-maxage=1800` exactly EQUALS the 30-min warm cadence,
    // so a warmed object reaches its TTL boundary right as the cycle ends — real
    // cold-loads late in a cycle hit a just-expired object and stale-serve
    // (`EXPIRED`) instead of a clean HIT (the #869 prod validation caught this on
    // the *correct* `-130` key). `2400s (40 min) > 1800s (30-min cadence)` gives
    // a ~10-min margin so a warmed/organic object stays fresh through the whole
    // cycle until the next warm refreshes it. Response bodies are
    // viewport-independent for a given canonical key (meta.freshestObservationAt
    // is a whole-table MAX), so two devices on one key get byte-identical bodies.
    // Accepted ~40-min edge staleness (0.2% of the 14-day window) is a logged
    // product call (#868/#870 staleness decision).
    expect(cacheControlFor('observations'))
      .toBe('public, s-maxage=2400, stale-while-revalidate=2400');
  });

  it('returns medium s-maxage with 2× SWR for /hotspots (~10min freshness)', () => {
    expect(cacheControlFor('hotspots'))
      .toBe('public, s-maxage=600, stale-while-revalidate=1200');
  });

  it('returns 7d max-age (revalidatable) for /species', () => {
    // /api/species/:code is out of scope for #586 (already long-cached on
    // browser + CDN; not one of the four hot miss-rate offenders). Left as
    // `max-age=604800` so existing browser caching behavior is unchanged.
    // No `immutable`: photo_url on species_meta is a monthly-refreshed field
    // (#327) so the URL value CAN change.
    expect(cacheControlFor('species'))
      .toBe('public, max-age=604800');
  });

  it('returns long s-maxage with 2× SWR for /silhouettes (~1h freshness)', () => {
    // Family silhouettes drift between deploys (curation, Phylopic seed
    // expansion). `s-maxage=3600` lets the CDN hold the payload for an hour,
    // and `purge-silhouettes-cache.sh` still reaches users on next request
    // after a curation push because it purges the CDN entry directly.
    expect(cacheControlFor('silhouettes'))
      .toBe('public, s-maxage=3600, stale-while-revalidate=7200');
  });

  it('returns long s-maxage with 2× SWR for /phenology (~1h freshness)', () => {
    // Phenology aggregates the last 365d observations into 12 monthly counts;
    // monthly buckets only meaningfully shift when a fresh obs lands in a
    // previously-empty month — extremely rare on a 1h window.
    expect(cacheControlFor('phenology'))
      .toBe('public, s-maxage=3600, stale-while-revalidate=7200');
  });

  it('returns a long 1d CDN window for /species (dictionary, #859)', () => {
    // GET /api/species (the full code→name dictionary) is fetched once per
    // session and names change rarely (only when a taxonomy refresh ships).
    // A 1d s-maxage + 2d SWR keeps the edge entry long-lived; a deploy/taxonomy
    // refresh is the natural bust point. Distinct from the 'species' (per-code
    // detail) tier above, which carries monthly-refreshed photo_url.
    expect(cacheControlFor('species-dict'))
      .toBe('public, s-maxage=86400, stale-while-revalidate=172800');
  });

  it('returns a 7d immutable header for /states (build-time-stable seed)', () => {
    // The state_boundaries seed is build-time-stable: it only changes when the
    // generator is re-run and a new migration ships, which is a fresh deploy
    // that busts the edge. So /api/states is safe to cache as `immutable` for
    // a week on both browser + CDN — unlike /silhouettes, whose payload drifts
    // between deploys via curation pushes.
    expect(cacheControlFor('states'))
      .toBe('public, max-age=604800, s-maxage=604800, immutable');
  });
});

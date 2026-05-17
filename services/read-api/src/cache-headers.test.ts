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

  it('returns short s-maxage with 2× SWR for /observations (~5min freshness)', () => {
    expect(cacheControlFor('observations'))
      .toBe('public, s-maxage=300, stale-while-revalidate=600');
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
});

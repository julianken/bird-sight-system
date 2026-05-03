import { describe, it, expect } from 'vitest';
import { cacheControlFor, type Endpoint } from './cache-headers.js';

describe('cacheControlFor', () => {
  it('returns 30-min TTL with SWR for /observations', () => {
    expect(cacheControlFor('observations'))
      .toBe('public, max-age=1800, stale-while-revalidate=600');
  });
  it('returns 24h TTL with SWR for /hotspots', () => {
    expect(cacheControlFor('hotspots'))
      .toBe('public, max-age=86400, stale-while-revalidate=3600');
  });
  it('returns 7d max-age (revalidatable) for /species', () => {
    // No `immutable`: photo_url on species_meta is a monthly-refreshed field
    // (issue #327). The value at this URL CAN change, so `immutable` is
    // semantically wrong. Browsers re-validate at expiry; CDN may serve
    // stale species data for up to 7 days after a photo write — acceptable
    // given monthly refresh cadence. See cache-headers.ts comment.
    expect(cacheControlFor('species'))
      .toBe('public, max-age=604800');
  });
  it('returns 7d max-age (revalidatable) for /silhouettes', () => {
    // Family silhouettes legitimately drift between deploys (curation,
    // Phylopic seed expansion). The 1-week max-age is still aggressive
    // enough not to hammer the API, but dropping `immutable` lets browsers
    // re-validate with the CDN at expiry — and a Cloudflare cache-purge
    // (see scripts/purge-silhouettes-cache.sh) reaches users on the next
    // request rather than waiting up to 7 days.
    expect(cacheControlFor('silhouettes'))
      .toBe('public, max-age=604800');
  });
  it('returns 6h TTL with 1h SWR for /phenology', () => {
    // Phenology aggregates observations from the last 365 days. The data
    // shifts daily as the recent-ingest cycle rolls forward, but the per-
    // species monthly counts only meaningfully change when a fresh
    // observation lands in a previously-empty month — extremely rare on
    // any 6h window. 21600s (6h) max-age + 3600s SWR balances a long-lived
    // CDN entry with same-day refresh after a notable observation.
    expect(cacheControlFor('phenology'))
      .toBe('public, max-age=21600, stale-while-revalidate=3600');
  });
});

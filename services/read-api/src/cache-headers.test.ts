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
  it('returns 7d immutable for /regions', () => {
    expect(cacheControlFor('regions'))
      .toBe('public, max-age=604800, immutable');
  });
  it('returns 7d immutable for /species', () => {
    expect(cacheControlFor('species'))
      .toBe('public, max-age=604800, immutable');
  });
});

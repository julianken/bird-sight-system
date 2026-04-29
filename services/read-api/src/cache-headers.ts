export type Endpoint = 'observations' | 'hotspots' | 'species' | 'silhouettes';

const TABLE: Record<Endpoint, string> = {
  observations: 'public, max-age=1800, stale-while-revalidate=600',
  hotspots:     'public, max-age=86400, stale-while-revalidate=3600',
  // `immutable` was correct when species_meta was append-only taxonomy data;
  // once photo_url becomes a monthly-refreshed field (issue #327), `immutable`
  // is semantically wrong because the value at this URL CAN change. Keeping
  // the 1-week max-age means the CDN may serve stale species data for up to
  // 7 days after a photo write — acceptable given monthly refresh cadence.
  // Browsers re-validate at expiry rather than treating the response as
  // never-changing.
  species:      'public, max-age=604800',
  // Family-color/silhouette payload genuinely drifts between deploys
  // (curation, Phylopic seed expansion), so we keep the 1-week max-age
  // (cheap on the read path) but DROP `immutable` — browsers will
  // re-validate at expiry, and an out-of-band Cloudflare cache purge
  // (scripts/purge-silhouettes-cache.sh) reaches users on the next
  // request rather than waiting up to 7 days.
  silhouettes:  'public, max-age=604800',
};

export function cacheControlFor(endpoint: Endpoint): string {
  return TABLE[endpoint];
}

export type Endpoint = 'observations' | 'hotspots' | 'species' | 'silhouettes';

const TABLE: Record<Endpoint, string> = {
  observations: 'public, max-age=1800, stale-while-revalidate=600',
  hotspots:     'public, max-age=86400, stale-while-revalidate=3600',
  species:      'public, max-age=604800, immutable',
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

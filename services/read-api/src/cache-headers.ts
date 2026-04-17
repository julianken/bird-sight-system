export type Endpoint = 'observations' | 'hotspots' | 'regions' | 'species';

const TABLE: Record<Endpoint, string> = {
  observations: 'public, max-age=1800, stale-while-revalidate=600',
  hotspots:     'public, max-age=86400, stale-while-revalidate=3600',
  regions:      'public, max-age=604800, immutable',
  species:      'public, max-age=604800, immutable',
};

export function cacheControlFor(endpoint: Endpoint): string {
  return TABLE[endpoint];
}

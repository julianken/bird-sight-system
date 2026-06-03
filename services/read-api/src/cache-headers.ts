export type Endpoint = 'observations' | 'hotspots' | 'species' | 'species-dict' | 'silhouettes' | 'phenology' | 'states';

// Cache-Control TTL table for public read endpoints.
//
// Issue #586: Cloudflare zone analytics for bird-maps.com reported a 99.91%
// cache-miss rate over 30 days because the hot read paths returned no
// directives the CDN would honor. The four public list/aggregate endpoints
// below now emit `s-maxage` (CDN-only) + a 2× `stale-while-revalidate` window,
// so Cloudflare can serve cached + SWR responses while origin (Cloud Run +
// Neon) sees only post-TTL refreshes. Browsers are intentionally NOT asked to
// hold stale copies — `s-maxage` does not apply to private caches, so a hard
// reload always hits the CDN.
//
// /api/species/:code is out of scope for #586 — it is per-species, hit
// rarely, and was already long-cached on both browser + CDN via `max-age`.
const TABLE: Record<Endpoint, string> = {
  // Freshest surface — observation rows roll forward every ingest cycle
  // (~hourly). 5min CDN window + 10min SWR keeps the cache useful for
  // burst-y page-loads without delaying ingest visibility beyond ~15min.
  observations: 'public, s-maxage=300, stale-while-revalidate=600',
  // Hotspot list shifts only on backfill — a 10min CDN window with 20min
  // SWR is conservative; the data is effectively static between rebuilds.
  hotspots:     'public, s-maxage=600, stale-while-revalidate=1200',
  // Phenology aggregates the last 365d observations into 12 monthly counts.
  // Per-species rows shift only when a fresh obs lands in a previously-empty
  // month — exceedingly rare on a 1h window. 1h s-maxage + 2h SWR is a
  // long-lived edge entry with same-day refresh.
  phenology:    'public, s-maxage=3600, stale-while-revalidate=7200',
  // `immutable` was correct when species_meta was append-only taxonomy data;
  // once photo_url becomes a monthly-refreshed field (issue #327), `immutable`
  // is semantically wrong because the value at this URL CAN change. Keeping
  // the 1-week max-age means the CDN may serve stale species data for up to
  // 7 days after a photo write — acceptable given monthly refresh cadence.
  // Browsers re-validate at expiry rather than treating the response as
  // never-changing. Not migrated to `s-maxage` under #586 because per-species
  // GETs were not in the high-miss-rate set.
  species:      'public, max-age=604800',
  // GET /api/species — the full code→{comName,familyCode} dictionary (#859),
  // fetched once per session and joined client-side against the species codes
  // carried in the aggregated buckets. Names change only when a taxonomy
  // refresh ships (rare), so a 1d CDN window + 2d SWR keeps the edge entry
  // long-lived and cheap; the next deploy/taxonomy refresh is the natural bust
  // point. `s-maxage` (CDN-only) mirrors the #586 hot-path treatment rather
  // than the per-code 'species' tier's browser `max-age` — the dictionary is
  // one shared body, so edge caching is where the win is.
  'species-dict': 'public, s-maxage=86400, stale-while-revalidate=172800',
  // Family silhouette payload drifts between deploys (curation, Phylopic
  // seed expansion). `s-maxage=3600` keeps a 1h CDN window — short enough
  // that curation pushes reach users quickly without scripts/purge-...sh,
  // long enough to absorb the load of repeat page-loads. SWR adds a 2h
  // grace window so the origin never gets a thundering refresh.
  silhouettes:  'public, s-maxage=3600, stale-while-revalidate=7200',
  // State-boundary summaries (name + bbox) for the scope selector + camera.
  // The state_boundaries seed is build-time-stable: it only changes when the
  // offline generator (scripts/generate-state-boundaries.mjs) is re-run and a
  // new migration ships — which is a fresh deploy that busts the edge anyway.
  // So unlike /silhouettes (curation pushes drift the payload between deploys),
  // /api/states is genuinely `immutable` for a week on BOTH browser + CDN.
  states:       'public, max-age=604800, s-maxage=604800, immutable',
};

export function cacheControlFor(endpoint: Endpoint): string {
  return TABLE[endpoint];
}

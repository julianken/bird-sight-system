export type Endpoint = 'observations' | 'hotspots' | 'species' | 'species-dict' | 'species-scope' | 'silhouettes' | 'phenology' | 'states';

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
  // (~30min). #868 raised this from 300/600 to 1800/1800 to cover the full
  // ingest cadence. There is NO ingest cache-purge (run-ingest.ts issues zero CF
  // purge calls), so the cache lives on TTL alone.
  // #870 raised it 1800→2400: `s-maxage=1800` exactly EQUALS the 30min warm
  // cadence, so a warmed object hits its TTL boundary right as the cycle ends —
  // a real cold-load late in a cycle lands on a just-expired object and
  // stale-serves (`EXPIRED`) instead of a clean HIT (the #869 prod validation
  // caught this on the *correct* `-130` key). `2400s (40min) > 1800s (30min
  // cadence)` gives a ~10min margin so a warmed/organic object stays fresh
  // through the whole cycle until the next warm refreshes it. Bodies are
  // viewport-independent for a given canonical key (#868;
  // meta.freshestObservationAt is a whole-table MAX), so co-keyed devices get
  // byte-identical responses. The ~40min edge staleness (0.2% of the 14-day
  // window) is an accepted product call (#868/#870 staleness decision).
  observations: 'public, s-maxage=2400, stale-while-revalidate=2400',
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
  // GET /api/species-in-scope — the distinct species REPRESENTED in a scope
  // (state|US) for the active since/notable/family filters, backing the
  // FiltersBar Species combobox. It is bbox/zoom/species-INDEPENDENT, so the
  // key space is just a few (scope, since, notable, family) combos.
  //
  // The whole-US, no-family cold query is a national 14d EXISTS+distinct over
  // `observations` (no bbox to prune) — the same input volume the precompute
  // grid exists to keep off the request path for the aggregated render. It is
  // index-backed (obs_dt_idx + obs_species_idx) and strictly lighter than
  // getObservationsAggregated (no PostGIS gridding — a single scan → small
  // distinct-species hash-agg → join to species_meta), but it is still a
  // national scan. The mitigation is the LONG SWR below: unlike the
  // observations COUNT (which rolls every ~30min ingest), the represented
  // SET of species is near-static (a species enters/leaves the 14d window
  // only rarely), so 1h freshness + a 24h stale-while-revalidate window means
  // a cold origin compute happens at most once per key per hour AND is served
  // from the background (SWR) — a user never waits on it after the first-ever
  // request for a key. Staleness cost: a newly-observed species can be absent
  // from the combobox for up to ~1h (it is still reachable on the map / in
  // popovers meanwhile) — an accepted trade for keeping the scan off the
  // user-facing path.
  'species-scope': 'public, s-maxage=3600, stale-while-revalidate=86400',
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

# Iteration: Production Data Volume & Response Characteristics

## Assignment

Close the Phase 1 Area 4 measurement gap: quantify real production data volumes and response characteristics at `https://api.bird-maps.com` so Phase 3 synthesizers have grounded feasibility facts for claims about "temporal feeds," "unpaginated search lists," and client-side aggregation. Probes run 2026-04-21 03:09–03:12 UTC from a single US-West residential vantage. `curl` + `jq` only; no write endpoints touched.

## Findings

### Finding 1: The observation dataset is deduplicated to one row per species

- **Evidence:** For `?since=14d` (n=344), grouping by `speciesCode` yields 344 groups of size 1: `jq 'group_by(.speciesCode) | .[] | length' → {max:1, min:1}`. Same holds for 7d (318/318), 30d (346/346), and 14d notable (53/53). Raw rows show 203 distinct `subId`s at 14d — the checklist layer carries ~60% more rows than the response emits.
- **Confidence:** high — four windows, zero exceptions.
- **Relation to Phase 1:** extends Area 4 Findings 4 & 5. Area 4 inferred "several-thousand-row" ceilings; live numbers are 1–2 orders smaller because the response is pre-aggregated per-species. **New backend behavior not documented in Phase 1.**
- **Significance:** Every "can the frontend render all observations" question resolves trivially — observation count *is* species count. Flip side: `howMany`, `subId`, `locId`, `locName`, `obsDt` on the wire reflect **one representative sighting per species**, not an aggregate. Any UI promising "where has this species been seen this week" from `/api/observations` alone shows one place, not several.

### Finding 2: The ingestor has not produced a new row in 52+ hours

- **Evidence:** Newest `obsDt` at 14d = `2026-04-18T22:26:00Z`; probe at 03:09:38Z 2026-04-21 → newest observation is **52.76 h old**. `?since=1d` returns `[]` (confirmed twice). `/api/hotspots` also returns `[]`. Recency histogram: 278/344 from 2 days ago, zero <48h. Per `CLAUDE.md` the ingestor runs `*/30 * * * *` against `/data/obs/US-AZ/recent`; AZ routinely produces >100 checklists/day, so zero in 48h is not eBird-side reality.
- **Confidence:** high for the data fact; medium for root cause (this probe can't read Cloud Run logs).
- **Relation to Phase 1:** contradicts Area 4 Finding 4's visible-freshness claim ("up to 60 min stale worst case"). Actual worst-case is >48 h stale.
- **Significance:** Every feasibility number below is measured during a degraded-ingest regime. Architectural caps (hundreds of rows per response) are the right order of magnitude; exact numbers may rise when ingest recovers. The empty hotspots endpoint is independent — weekly cron `0 5 * * 0` last ran Sunday 2026-04-19 05:00 UTC and produced nothing. **Operational incident flagged.**

### Finding 3: No compression, no CDN on the API — browser-only caching

- **Evidence:**

| Host | `server` | CDN headers | `cf-cache-status` | gzip served? |
|---|---|---|---|---|
| `bird-maps.com` (apex) | `cloudflare` | `cf-ray: 9ef932…-PHX`, `report-to` | `DYNAMIC` | (static site; n/a) |
| `api.bird-maps.com` | `Google Frontend` | none | absent | **no** |

`HEAD` with `Accept-Encoding: gzip, br` returns identical `content-length: 101141` as without. No `age`, `x-cache`, or `cf-cache-status` on any API response.
- **Confidence:** high (5+ probes; the subdomain split is a deliberate deployment choice).
- **Relation to Phase 1:** resolves Area 4 Unknown "Compression." Area 4 Finding 4 enumerated cache headers; measured behavior clarifies those `max-age` / `stale-while-revalidate` directives are honored **only by the browser HTTP cache** — no shared CDN cache exists.
- **Significance:**
  - Every anonymous first-paint user eats 101 KB uncompressed at 14d, 102 KB at 30d. Typical JSON compresses ~8–10× — a Cloud Run gzip flag (or Hono `compress()` middleware) would cut wire payload to ~10–12 KB.
  - `stale-while-revalidate=600` has no effect on cold-visitor path; only same-tab revisits benefit.
  - Traffic, cache-hit, geo-distributed latency are invisible to the Cloudflare dashboard because the data plane bypasses it.

### Finding 4: Latency is fast and tight — median ~230 ms, no cold-start visible

- **Evidence:** 5 sequential GETs for `?since=14d` (101 KB body):

| Run | connect | ttfb | total |
|---|---|---|---|
| 1 | 0.026 | 0.277 | 0.331 |
| 2 | 0.023 | 0.238 | 0.286 |
| 3 | 0.023 | 0.181 | 0.235 |
| 4 | 0.026 | 0.221 | 0.279 |
| 5 | 0.023 | 0.165 | 0.216 |

Median total 0.279 s, TTFB 0.221 s. `?since=30d`: 0.215–0.246 s. `/api/regions` (2.4 KB): 0.136–0.150 s. No cold-start spike → instance is warm (traffic and/or `min-instances ≥ 1`). No `age:` on any response confirms no shared caching.
- **Confidence:** high for timings; medium for warm-instance interpretation (single vantage).
- **Relation to Phase 1:** resolves Area 4 Unknown "Production response timing / CDN hit rate."
- **Significance:** 230 ms for 100 KB is well within budget for a non-critical-path fetch. Frontend can issue `?since=14d` on mount without blocking first paint. **Payload size is the constraint, not server time.**

### Finding 5: Feasibility answers — all non-map UI shapes clear the bar

Applying iterator's stated thresholds:

| UI shape | Threshold | Measured | Verdict |
|---|---|---|---|
| Non-paginated observation feed | <1k rows = no virtualization | 344 / 14d, 318 / 7d, 346 / 30d | **Yes, no virtualization** |
| Client-side `speciesCode` autocomplete | Distinct species in result set | 344 (14d), 318 (7d), 346 (30d), 53 (notable) | **Yes — result set IS the species index.** No `/api/species` endpoint needed for any since≤30d. |
| All-obs-as-markers spatial plot | <500 = naive SVG ok | 344 at 14d | **Yes, naive SVG fine.** Clustering is a UX choice, not perf need. |
| Aggregate dashboard (group-by-week, count-notable) | <1k-row reduce is sub-ms in JS | 344 rows | **Yes, client-side** — but dedup (F1) means "weekly counts" degrade to "species seen that week," not observation counts. A count-aware dashboard needs a backend aggregate. |
| Hotspot-centric list | Distinct hotspots in obs | 159 distinct `locId` / 14d | **Yes.** (Hotspots endpoint outage is orthogonal.) |
| Per-region filter | Distinct regions in obs | 9 named + 13 null / 14d | **Yes, client-side groupBy.** |
| Freshness-latency profile | Browser TTL + shared pattern | `max-age=1800` browser only, no shared | **Same-tab revisits cached 30 min; cold loads always hit origin.** |

### Finding 6: Endpoint measurement table

| Endpoint | HTTP | bytes | Rows | Distinct spp | `obsDt` range | notable | `regionId=null` | Median TTFB |
|---|---|---|---|---|---|---|---|---|
| `?since=1d` | 200 | 2 | 0 | 0 | — | 0 | 0 | ~0.14 s |
| `?since=7d` | 200 | 93,521 | 318 | 318 | 04-14 07:15 → 04-18 22:26 | 36 | 12 | ~0.20 s |
| `?since=14d` | 200 | 101,141 | 344 | 344 | 04-07 10:30 → 04-18 22:26 | 53 | 13 | 0.221 s |
| `?since=30d` | 200 | 101,712 | 346 | 346 | 04-06 09:06 → 04-18 22:26 | 54 | 13 | ~0.19 s |
| `?since=14d&notable=true` | 200 | 15,235 | 53 | 53 | 04-07 10:30 → 04-18 16:45 | 53 | — | n/m |
| `/api/hotspots` | 200 | 2 | 0 | — | — | — | — | ~0.14 s |
| `/api/regions` | 200 | 2,428 | 9 | — | — | — | — | 0.149 s |

Regions `svgPath` total = 1,382 chars across 9 rows (114–195 each). Per-region 14d obs skew: Sonoran-Phoenix 78, Sonoran-Tucson 68, Sky Islands Santa Ritas 65, Colorado Plateau 46, Lower Colorado 26, Sky Islands Chiricahuas 17, Mogollon Rim 16, Sky Islands Huachucas 13, **Grand Canyon 2**, unstamped 13. Grand Canyon has 2 observations in 14 days — a **~40× density skew** any equal-weight UI misrepresents.

### Finding 7: 7→14→30 day curves plateau — effectively ~346 species ever

- **Evidence:** 7d→14d adds 26 rows (+8%); 14d→30d adds 2 (+0.6%). `species(window)` saturates by day 14 at this sample. Notable fraction: 15% / 15% / 16%. 14d notable (53) equals 14d `isNotable=true` count (53).
- **Confidence:** high within current regime; unknown whether a healthy ingestor shows a longer tail.
- **Relation to Phase 1:** new info — Phase 1 never saw a `?since=30d` body.
- **Significance:** A "last 30 days" toggle returns ~same content as "last 14 days." The since-slider is load-bearing as a recency cue but redundant as a content discriminator at this volume. If redesign keeps the slider, probably 1d/7d/14d only.

## Resolved Questions

- **Row count at `?since=14d`?** 344 observations, 344 distinct species.
- **Wire size?** 101,141 B uncompressed, served uncompressed.
- **Compression?** No. Identical bytes with/without `Accept-Encoding`.
- **CDN in front?** No for `api.*` (Google Frontend direct); yes for apex.
- **Response time?** 220–280 ms median for 100 KB; 135–150 ms for 2.4 KB regions.
- **`cf-cache-status` pattern?** Not applicable — API isn't behind Cloudflare.
- **Virtualization for observation feed?** No at current volumes; still no at 10k with gzip, since most virtualizers break even ~500–1000.
- **`/api/species` needed for autocomplete?** No, in-memory result set covers it.
- **Backend aggregate endpoint?** Only if counting observations (not species) matters; dedup forces it for count-aware metrics.

## Remaining Unknowns

- **Root cause of the 52-hour ingest lag** — beyond this probe's authorization; Cloud Scheduler / Cloud Run logs would show it.
- **Healthy-ingestor volume.** Measured under a stall. A healthy AZ day might produce 200–400 new species-sightings; 14d could plausibly reach 1,500–2,000 rows — still clearing the "<1k = no virtualization" bar only narrowly. Recommend re-running once `?since=1d` returns >0.
- **Geographic latency distribution.** Single US-West probe.
- **RUM signal.** None attached.

## Revised Understanding

Three revisions to Phase 1:

1. **Feasibility is not a volume question; it's a semantics question.** Phase 1 flagged unknown row count as risk to feed/list claims. Actual risk is not volume (rows are 1–2 orders below any virtualize/cluster/paginate threshold) — it is that the backend collapses checklists to one species per response. Any frontend metric needing observation counts (not species counts) requires backend work. A list, timeline, grid, or map of "recent species" is trivially shippable; "checklist volume over time" is not.

2. **Infrastructure differs from documented.** CLAUDE.md memory says "Cloudflare fronts the deployment"; live behavior is CF fronts static site but API is direct Cloud Run with no CDN, no gzip, no shared cache. `Cache-Control` is browser-only. Redesign should either accept the 100 KB uncompressed cost (cheap given <1000 rows) or enable gzip at Cloud Run / Hono, but should not assume a Cloudflare edge cache benefit.

3. **There's an active incident masked by a feasibility question.** The 52-hour ingest stall and empty hotspots are production-health issues, not design questions. Phase 3 synthesizers should treat current shape with the caveat that volumes may rise when ingest recovers. Order-of-magnitude conclusions (hundreds not thousands, KB not MB) are robust; exact numbers are not.

## Raw Evidence

Probes recorded under `/tmp/bwprobe/` (ephemeral). All probe timestamps 2026-04-21 03:09:32Z–03:12:xxZ. Stock macOS curl, no mutation, no auth headers. Commands:

```
curl -sS -D headers_{1d,7d,14d,30d}.txt  -o body_{1d,7d,14d,30d}.json  ".../api/observations?since={1,7,14,30}d"
curl -sS -D headers_hotspots.txt -o body_hotspots.json ".../api/hotspots"
curl -sS -D headers_regions.txt  -o body_regions.json  ".../api/regions"
curl -sS -D headers_14d_notable.txt -o body_14d_notable.json ".../api/observations?since=14d&notable=true"
curl -sI ".../api/observations?since=14d"                            # bare HEAD
curl -sI -H "Accept-Encoding: gzip, br" ".../api/observations?since=14d"   # neg compression
curl -sS --compressed -w "..." ".../api/observations?since=14d"      # post-decode len
curl -sI "https://bird-maps.com/"                                    # CF front
for i in 1..5: curl -sS -w time ".../api/observations?since=14d"     # timing
```

jq queries inline in Findings 1, 5, 6.

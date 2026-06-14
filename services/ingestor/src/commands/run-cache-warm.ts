/**
 * Post-ingestion Cloudflare cache-warm helper (issue #711).
 *
 * Two minutes after every `/recent` ingest cycle, this kind walks a curated
 * list of ~77 popular bbox URLs and issues a `GET` against each so the
 * Cloudflare edge cache is hydrated before the next real user pans into the
 * same area. The next user's request then hits CF as a HIT instead of a MISS,
 * concentrating Cloud SQL CPU on long-tail (rural) bboxes only.
 *
 * Pure HTTP — no DB pool, no eBird API calls. The `cache-warm` branch in
 * `cli.ts` is responsible for skipping `createPool({...})` for this kind.
 *
 * ── Rate-limit safety ────────────────────────────────────────────────────
 * The warm traffic IS subject to the Layer-1 Cloudflare rate-limit ruleset
 * at `infra/terraform/rate-limit.tf:48` — the bucket key is `[ip.src,
 * cf.colo.id]` regardless of Cloud Run SA auth. The actual rule allows
 * 10 requests per 10-second sliding window.
 *
 * Concurrency=1 + 200ms sleep is the load-bearing safety margin. In the
 * pessimistic scenario (every response is a fresh MISS at ~1s wall-clock),
 * one request + 200ms sleep takes ~1.2s, producing ~8.4 req per 10s window
 * — comfortably under the 10/10s cap.
 *
 * IMPORTANT for future maintainers:
 *   - If p95 response time drops below ~500ms (e.g. all-HIT steady state),
 *     the effective rate climbs to ~14 req/10s and the bucket overflows
 *     → CF starts returning 429s to the warm job itself.
 *   - Mitigation: bump `sleepMs` to 500ms if you observe sustained sub-500ms
 *     responses on the warm cycle. Do NOT raise concurrency above 1.
 *   - At higher concurrency the math breaks immediately (5 req/s sustained
 *     × 10s = 50 in the bucket vs cap of 10 → guaranteed 429s).
 */

import {
  snapFetchBboxParam,
  canonicalFetchBboxParam,
  CONUS_BOUNDS,
  type Bbox,
} from '@bird-watch/geo';

/**
 * Static metro center list. The 25 entries below cover the top US metros by
 * population × birding activity. Manual list — revisit quarterly. A future
 * enhancement: derive from analytics top-N bboxes.
 *
 * Issue #711's spec body prose enumerates 27 candidate metros across the
 * five regional groups; the spec's URL-count math (25 metros × 3 zooms + 2
 * CONUS = 77) is the canonical contract that the acceptance test asserts.
 * To reconcile, the two lowest-priority metros by adjacent-coverage overlap
 * are dropped here:
 *   - New Orleans: overlaps Houston z=5 viewport
 *   - Albuquerque: overlaps Denver / Phoenix z=5 viewports
 * Restoring either is a one-line edit; the test asserting `total === 77`
 * will catch any accidental drift between the list and the canonical count.
 */
const METROS: ReadonlyArray<{ name: string; lng: number; lat: number }> = [
  // West
  { name: 'LA',           lng: -118.24, lat: 34.05 },
  { name: 'Bay Area',     lng: -122.42, lat: 37.77 },
  { name: 'San Diego',    lng: -117.16, lat: 32.71 },
  { name: 'Seattle',      lng: -122.33, lat: 47.61 },
  { name: 'Portland',     lng: -122.68, lat: 45.52 },
  { name: 'Vegas',        lng: -115.14, lat: 36.17 },
  { name: 'Phoenix',      lng: -112.07, lat: 33.45 },
  // South
  { name: 'Miami',        lng:  -80.19, lat: 25.76 },
  { name: 'Atlanta',      lng:  -84.39, lat: 33.75 },
  { name: 'Houston',      lng:  -95.37, lat: 29.76 },
  { name: 'Dallas',       lng:  -96.80, lat: 32.78 },
  { name: 'Austin',       lng:  -97.74, lat: 30.27 },
  { name: 'Orlando',      lng:  -81.38, lat: 28.54 },
  { name: 'Tampa',        lng:  -82.46, lat: 27.95 },
  // East
  { name: 'NYC',          lng:  -74.01, lat: 40.71 },
  { name: 'Boston',       lng:  -71.06, lat: 42.36 },
  { name: 'DC',           lng:  -77.04, lat: 38.91 },
  { name: 'Philadelphia', lng:  -75.17, lat: 39.95 },
  { name: 'Charlotte',    lng:  -80.84, lat: 35.23 },
  // Midwest
  { name: 'Chicago',      lng:  -87.63, lat: 41.88 },
  { name: 'Detroit',      lng:  -83.05, lat: 42.33 },
  { name: 'Minneapolis',  lng:  -93.27, lat: 44.98 },
  { name: 'St. Louis',    lng:  -90.20, lat: 38.63 },
  // Mountain
  { name: 'Denver',       lng: -104.99, lat: 39.74 },
  { name: 'SLC',          lng: -111.89, lat: 40.76 },
] as const;

/**
 * Per-zoom half-widths in degrees. Matches the frontend's tile→bbox mapping
 * at roughly the standard Web Mercator projection (see issue #711).
 *
 * z=5 → ~ ±11° lng, ±6° lat  (continent-scale viewport)
 * z=6 → ~ ±5.5° lng, ±3° lat (multi-state viewport)
 * z=7 → ~ ±2.75° lng, ±1.5° lat (single-state metro viewport)
 */
const ZOOM_HALFW: Record<number, readonly [number, number]> = {
  5: [11, 6],
  6: [5.5, 3],
  7: [2.75, 1.5],
};

/**
 * The CONUS camera envelope (`MapCanvas.tsx` `maxBounds` / `@bird-watch/geo`
 * `CONUS_BOUNDS`) — the input the CONUS z3/z4 warm entries feed.
 *
 * #868 — the warmer MUST feed `CONUS_BOUNDS`, NOT the legacy
 * `DEFAULT_BBOX_CONUS = [-125, 24, -66, 50]`. With the canonical key the bbox
 * INPUT determines the snapped CENTER, which is what mints the key:
 *   - `DEFAULT_BBOX_CONUS` midpoint is -95.5 → snaps to center -95 at z3 → west
 *     edge -95-34 = -129 (inside the clamp) → key `-129,…`.
 *   - The real client default view is centered on the MAP center -98.5795 →
 *     snaps to -99 → west -130 (reaches the CONUS clamp) → key `-130,…`.
 * Feeding `DEFAULT_BBOX_CONUS` would therefore mint a z3 key the mobile cold
 * load never requests — re-creating the exact prod MISS on the warmer side.
 * `CONUS_BOUNDS` snaps to the SAME center as the client by construction, so the
 * warmer and client collide on one key at both z3 and z4. (z4 collapses to one
 * key regardless of which input; z3 is the discriminating tier.)
 */
const CONUS_ZOOMS: readonly number[] = [3, 4];

/**
 * Builds the deterministic 77-entry URL list: 2 CONUS aggregated queries plus
 * 25 metros × 3 zoom levels. Exported for testability — the URL count + shape
 * are the most error-prone surface area in this helper.
 *
 * #868 — the aggregated tiers (CONUS z3/z4, metro z5) now serialize through the
 * shared `canonicalFetchBboxParam`, which reconstructs a fixed-extent box from
 * the snapped bbox MIDPOINT + zoom (scheme a), so the warmed value is the SAME
 * canonical key every device mints for that view. The CONUS entries feed
 * `CONUS_BOUNDS` (see the note above — feeding the legacy default would mint
 * `-129,…` and miss). At z6/z7 (per-observation mode) the warmer still uses
 * `snapFetchBboxParam` (a passthrough there), so those entries keep their raw
 * `.toFixed(2)` value and stay disjoint from client keys; their retirement +
 * the trim-to-~8 canonical set is deferred to the measurement-driven PR2.
 */
export function buildCacheWarmUrls(baseUrl: string): string[] {
  const urls: string[] = [];
  for (const zoom of CONUS_ZOOMS) {
    const bbox = canonicalFetchBboxParam(CONUS_BOUNDS, zoom);
    urls.push(`${baseUrl}/api/observations?since=14d&bbox=${bbox}&zoom=${zoom}`);
  }
  for (const m of METROS) {
    for (const z of [5, 6, 7]) {
      const halfW = ZOOM_HALFW[z];
      if (!halfW) continue;
      const [hw, hh] = halfW;
      const raw: Bbox = [m.lng - hw, m.lat - hh, m.lng + hw, m.lat + hh];
      // z5 → CANONICAL fixed-extent box (agrees with the client's #868 key);
      // z6/z7 → snapFetchBboxParam passthrough (raw value, .toFixed(2);
      // retired in PR2).
      const bbox = z === 5
        ? canonicalFetchBboxParam(raw, z)
        : snapFetchBboxParam(raw, z);
      urls.push(`${baseUrl}/api/observations?since=14d&bbox=${bbox}&zoom=${z}`);
    }
  }
  return urls;
}

export interface RunCacheWarmOptions {
  baseUrl: string;
  /**
   * Sleep between requests, in milliseconds. Default 200ms; lower values
   * risk tripping the Layer-1 rate-limit (see header comment). Tests pass
   * 0 to skip wall-clock waits.
   */
  sleepMs?: number;
  /** Injectable sleep — tests pass a spy to assert call count without delay. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable fetcher — tests can override; production uses global fetch. */
  fetcher?: typeof fetch;
}

export interface RunCacheWarmSummary {
  total: number;
  miss: number;
  hit: number;
  expired: number;
  dynamic: number;
  other: number;
  error: number;
  p50ms: number;
  p95ms: number;
}

const DEFAULT_SLEEP_MS = 200;
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Walks the cache-warm URL list sequentially, recording cf-cache-status per
 * response and emitting a single structured `bird_ingest_cache_warmed` log
 * line at the end for the dashboard's log-based metric.
 */
export async function runCacheWarm(opts: RunCacheWarmOptions): Promise<RunCacheWarmSummary> {
  const urls = buildCacheWarmUrls(opts.baseUrl);
  const sleepMs = opts.sleepMs ?? DEFAULT_SLEEP_MS;
  const fetcher = opts.fetcher ?? fetch;
  const doSleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));

  const results = {
    total: urls.length,
    miss: 0,
    hit: 0,
    expired: 0,
    dynamic: 0,
    other: 0,
    error: 0,
  };
  const durations: number[] = [];

  for (const url of urls) {
    const t0 = Date.now();
    try {
      const r = await fetcher(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      const raw = r.headers.get('cf-cache-status') ?? 'NONE';
      const bucket = raw.toLowerCase();
      // Drain the body so the connection can be reused / closed cleanly.
      // We don't care about the contents — CF's status header is the signal.
      // Wrapping in catch keeps a malformed body from inflating the error
      // bucket (the request itself succeeded).
      try { await r.text(); } catch { /* drained best-effort */ }
      if (bucket === 'miss') results.miss++;
      else if (bucket === 'hit') results.hit++;
      else if (bucket === 'expired') results.expired++;
      else if (bucket === 'dynamic') results.dynamic++;
      else results.other++;
      durations.push(Date.now() - t0);
    } catch {
      results.error++;
    }
    if (sleepMs > 0) await doSleep(sleepMs);
  }

  // Percentile math on the sorted duration list. Empty list (all-error run)
  // yields p50=p95=0, which the dashboard's downstream log-based metric
  // handles as "no signal" rather than "fast".
  durations.sort((a, b) => a - b);
  const p50 = durations.length > 0
    ? (durations[Math.floor(durations.length * 0.5)] ?? 0)
    : 0;
  const p95 = durations.length > 0
    ? (durations[Math.floor(durations.length * 0.95)] ?? 0)
    : 0;

  // Single compact line for Cloud Logging's jsonPayload extraction. Same
  // shape contract as `bird_ingest_run_completed` (cli.ts) and
  // `bird_ingest_archived` (run-prune.ts): one stringify, no newlines.
  console.log(JSON.stringify({
    severity: 'INFO',
    message: 'bird_ingest_cache_warmed',
    kind: 'cache-warm',
    total: results.total,
    miss: results.miss,
    hit: results.hit,
    expired: results.expired,
    dynamic: results.dynamic,
    other: results.other,
    error: results.error,
    p50ms: p50,
    p95ms: p95,
  }));

  return { ...results, p50ms: p50, p95ms: p95 };
}

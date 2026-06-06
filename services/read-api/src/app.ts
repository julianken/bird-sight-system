import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { cors } from 'hono/cors';
import type { Pool } from '@bird-watch/db-client';
import {
  getHotspots, getObservations, getObservationsAggregated,
  getFreshestObservationAt,
  getSpeciesMeta, getSpeciesDictionary, getSilhouettes,
  getSpeciesPhenology,
  listStatesWithBbox,
  // #878 — precomputed per-scope aggregation grid.
  isPrecomputeEligible, getAggregatedGridFromCache, resolveScopeKey,
} from '@bird-watch/db-client';
import type { ObservationsResponse } from '@bird-watch/shared-types';
import { cacheControlFor } from './cache-headers.js';
import { rateLimitFromEnv } from './rate-limit.js';
import {
  parseSince, parseNotable, parseSpecies, parseFamily, parseState,
  assertBboxAreaCap, assertBboxOrSpecies,
} from './validate.js';

// Fixed sunset date for the `?since=30d` soft-deprecation window. Anchoring
// to a concrete UTC date (rather than `now() + 14d`) means the deprecation
// window is a real deadline that approaches, not a perpetually-rolling 14
// days. PR 3 in the rollout flips `since=30d` to hard 400 on/before this
// date. See issue #667 Addendum §5 and PR #668 review feedback.
const SINCE_30D_SUNSET_DATE = new Date('2026-06-01T00:00:00Z').toUTCString();

export interface AppDeps {
  pool: Pool;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  // Parse the CORS allowlist. `trim` + `filter(Boolean)` so that a value like
  // "https://a.test, https://b.test" (comma-space) and stray empty entries
  // ("a,,b") both round-trip correctly; Hono's array-origin matcher uses
  // strict `.includes(origin)` against the browser's exact Origin header, so
  // any leftover whitespace silently breaks CORS for that entry.
  const origins = (process.env.FRONTEND_ORIGINS ??
    'https://bird-maps.com,https://www.bird-maps.com,http://localhost:5173,http://localhost:4173'
  ).split(',').map(s => s.trim()).filter(Boolean);

  // CORS must be registered BEFORE route handlers — otherwise preflight
  // requests (OPTIONS without a matching route handler) 404.
  //
  // Interaction with route-level `Cache-Control: public, max-age=604800` on
  // /api/species/:code (no `immutable` — see cache-headers.ts comment): Hono
  // sets `Vary: Origin`, so a spec-compliant CDN keys the cache per-Origin.
  // That means the identical JSON body is stored N× for N allowed origins
  // (currently 3 — trivial). Uptime probes and plain `curl` hit these routes
  // without an Origin header, so the CDN also caches a no-ACAO entry;
  // browsers never see that entry because Cloud CDN honors Vary. The cached
  // bodies contain no Origin-derived data, so serving any cached entry across
  // origins would still be correct — `Vary: Origin` is purely for header
  // correctness.
  app.use('*', cors({
    origin: origins,
    allowMethods: ['GET'],
    maxAge: 86400,
  }));

  // Gzip JSON responses. Default threshold is 1024 bytes, so small routes
  // (health, single-species lookups) go through uncompressed; big ones
  // (`/api/observations?since=14d` healthy-baseline payload ~101 KB) drop
  // below ~20 KB on the wire — load-bearing for mobile on slow-LTE. See #108.
  app.use('*', compress());

  // Tell downstream caches (CloudFlare CDN, browser caches) that the response
  // body may differ depending on the client's Accept-Encoding value.  Without
  // this header, a cache keyed only by URL could serve a gzip-encoded body to
  // a client that never negotiated gzip.  Unconditional is correct per HTTP
  // semantics: even a response that happened to fall below the compression
  // threshold (and thus wasn't gzipped) could have been, so the cache must
  // treat Accept-Encoding as a cache dimension.  Uses append:true so any
  // existing Vary value (e.g. "Origin" from CORS) is comma-merged, not
  // replaced.  Closes #143.
  app.use('*', async (c, next) => {
    await next();
    c.header('Vary', 'Accept-Encoding', { append: true });
  });

  // Layer 3 of the audience-protection rate-limit (see services/read-api/README.md):
  // an in-memory token bucket per Cloud Run instance, scoped to /api/* and
  // explicitly skipping /health (uptime probes) and /api/admin/* (separate auth).
  // The Cloudflare rate-limit rule provisioned in infra/terraform/rate-limit.tf is
  // the actual ceiling; this middleware is defense-in-depth for traffic that
  // bypasses Cloudflare (direct *.a.run.app hits).
  app.use('*', rateLimitFromEnv());

  // Deepened to probe the DB (#821): a trivial round-trip catches the case
  // where the process is up but the connection to Cloud SQL is gone, which is
  // exactly the failure mode behind the user-facing 503s (read-api OOM-kill
  // severs the pg connection). We catch IN the handler and return 503 directly
  // rather than relying on app.onError — onError maps a generic throw to 500,
  // so an in-handler catch makes the unhealthy status deterministic regardless
  // of the failure's error shape. /health stays exempt from the rate-limiter
  // (rate-limit.ts only matches /api/*); do not move it under /api.
  app.get('/health', async c => {
    try {
      await deps.pool.query('SELECT 1');
      return c.json({ ok: true });
    } catch {
      return c.json({ ok: false, error: 'database unavailable' }, 503);
    }
  });

  app.get('/api/hotspots', async c => {
    const rows = await getHotspots(deps.pool);
    c.header('Cache-Control', cacheControlFor('hotspots'));
    return c.json(rows);
  });

  app.get('/api/observations', async c => {
    // #667 — strict allowlist validation across all filter params, with
    // structured 400 telemetry. See services/read-api/src/validate.ts.

    const sinceResult = parseSince(c.req.query('since'));
    if (!sinceResult.ok) {
      console.log(JSON.stringify(sinceResult.log));
      return c.json({ error: sinceResult.error }, 400);
    }
    const since = sinceResult.value;
    // Soft-deprecation: `?since=30d` is coerced to `14d` server-side for a
    // single release window, and we emit Deprecation/Sunset/Warning headers
    // plus a NOTICE log so dashboards can grep for live consumers. The next
    // release flips to hard 400. See issue #667 Addendum §5.
    if (sinceResult.deprecated) {
      // Sunset date: fixed UTC date (2026-06-01) — see SINCE_30D_SUNSET_DATE.
      c.header('Deprecation', 'true');
      c.header('Sunset', SINCE_30D_SUNSET_DATE);
      c.header(
        'Warning',
        '299 - "since=30d is deprecated; use since=14d (or omit since)"',
      );
      console.log(JSON.stringify({
        severity: 'NOTICE',
        message: 'deprecated_since_30d',
        user_agent: c.req.header('user-agent') ?? null,
      }));
    }

    const notableResult = parseNotable(c.req.query('notable'));
    if (!notableResult.ok) {
      console.log(JSON.stringify(notableResult.log));
      return c.json({ error: notableResult.error }, 400);
    }
    const notable = notableResult.value;

    const speciesResult = parseSpecies(c.req.query('species'));
    if (!speciesResult.ok) {
      console.log(JSON.stringify(speciesResult.log));
      return c.json({ error: speciesResult.error }, 400);
    }
    const speciesCode = speciesResult.value;

    const familyResult = parseFamily(c.req.query('family'));
    if (!familyResult.ok) {
      console.log(JSON.stringify(familyResult.log));
      return c.json({ error: familyResult.error }, 400);
    }
    const familyCode = familyResult.value;

    // #734 (plan task B5) — optional `?state=US-XX` scope. parseState (#729)
    // validates against the CONUS allowlist and normalizes to `US-XX`;
    // anything off the 49-code list (AK/HI/territories, garbage, SQLi) is a
    // 400 'invalid state' before the data layer. Absence ⇒ unclipped national
    // query (the data-layer invariant is unchanged). The clip itself
    // (ST_Intersects against state_boundaries) lives in db-client/#733; here
    // we only thread the validated code into filters.stateCode (below).
    const stateResult = parseState(c.req.query('state'));
    if (!stateResult.ok) {
      console.log(JSON.stringify(stateResult.log));
      return c.json({ error: stateResult.error }, 400);
    }
    const stateCode = stateResult.value;
    // #734 (plan task B7) — `?state=` rides the existing full-URL cache key
    // exactly like `?bbox=`, so no cache-headers.ts change is needed: a
    // `?state=` observations response rides the shared observations TTL
    // (s-maxage=2400/SWR=2400 since #870, raised from 1800/1800 in #868;
    // asserted in app.test.ts B5 case (f)). No new Endpoint value, no Vary change.

    // #619 — optional viewport-bbox filter, Phase 2 going-national
    // pre-condition. Format: bbox=minLon,minLat,maxLon,maxLat (EPSG:4326).
    // Backward-compatible: no bbox param → full set unchanged. The bbox
    // becomes part of the canonical URL so Cloudflare caches per-bbox under
    // the shared observations TTL (s-maxage=2400/SWR=2400 since #870).
    const bboxRaw = c.req.query('bbox');
    let bbox: [number, number, number, number] | undefined;
    if (bboxRaw !== undefined) {
      const parts = bboxRaw.split(',');
      if (parts.length !== 4) {
        return c.json({ error: 'invalid bbox: expected 4 comma-separated floats' }, 400);
      }
      const nums = parts.map(p => Number(p));
      if (nums.some(n => !Number.isFinite(n))) {
        return c.json({ error: 'invalid bbox: non-numeric value' }, 400);
      }
      const [minLon, minLat, maxLon, maxLat] = nums as [number, number, number, number];
      if (
        minLon < -180 || minLon > 180 || maxLon < -180 || maxLon > 180 ||
        minLat < -90  || minLat > 90  || maxLat < -90  || maxLat > 90
      ) {
        return c.json({ error: 'invalid bbox: out of range (lon ∈ [-180,180], lat ∈ [-90,90])' }, 400);
      }
      if (minLon > maxLon || minLat > maxLat) {
        return c.json({ error: 'invalid bbox: min must be <= max on each axis' }, 400);
      }
      bbox = [minLon, minLat, maxLon, maxLat];
    }

    // #627 — optional zoom hint. Triggers server-side aggregation when bbox
    // is also present AND zoom < 6 (CONUS/regional view). At higher zooms
    // the per-observation path stays unchanged.
    const zoomRaw = c.req.query('zoom');
    let zoom: number | undefined;
    if (zoomRaw !== undefined) {
      const z = Number(zoomRaw);
      if (!Number.isFinite(z) || !Number.isInteger(z) || z < 0 || z > 22) {
        return c.json({ error: 'invalid zoom: expected integer in [0,22]' }, 400);
      }
      zoom = z;
    }

    const filters: Parameters<typeof getObservations>[1] = {};
    if (since !== undefined) filters.since = since;
    if (notable === true) filters.notable = true;
    if (speciesCode !== undefined) filters.speciesCode = speciesCode;
    if (familyCode !== undefined) filters.familyCode = familyCode;
    if (bbox !== undefined) filters.bbox = bbox;
    // #734 (plan task B5) — set stateCode BEFORE the aggregated-mode branch so
    // the ST_Intersects state clip (#733) applies in BOTH aggregated and
    // per-observation modes. Both getObservationsAggregated and getObservations
    // read filters.stateCode; placing the assignment here (not after the
    // aggregated return) is load-bearing for clipping the aggregated path.
    if (stateCode !== undefined) filters.stateCode = stateCode;

    // Aggregated path: bbox present AND zoom < 6. Grid multiplier is a closed
    // switch — any zoom <= 3 collapses to the coarsest grid (multiplier 2) so
    // a deep zoom-out can never bypass aggregation. Zooms 4 and 5 get finer
    // grids. Multiplier choice rationale lives in getObservationsAggregated.
    if (bbox !== undefined && zoom !== undefined && zoom < 6) {
      const gridMultiplier = zoom <= 3 ? 2 : zoom === 4 ? 4 : 8;
      // #878 — precompute lookup for the DEFAULT low-zoom view. The predicate is
      // POSITIVE: a resolvable scope (state code or national) + default since
      // (14d) + no notable/species/family filter + a standard multiplier. The
      // bbox is deliberately ignored — a scoped state view ALWAYS sends the
      // snapped state-envelope bbox, which is co-extensive with the server's
      // ST_Intersects polygon clip and adds no row-reducing work; routing on
      // "bbox present" would send the exact default view this fix targets back
      // to the 12-15s live aggregation. The precompute is refreshed ingestor-
      // side after each /recent and after the prune (off the request path), so
      // the grid is byte-identical to what the live CTE would return for this
      // { since:'14d', stateCode? } request. Anything ineligible (any filter,
      // non-default since, non-standard multiplier) falls through to the live
      // CTE below, unchanged. An eligible scope with no precomputed rows yet
      // (e.g. immediately post-deploy before the first refresh) also falls back
      // so the response is never spuriously empty.
      const precomputed = isPrecomputeEligible(filters, gridMultiplier)
        ? await getAggregatedGridFromCache(deps.pool, resolveScopeKey(filters), gridMultiplier)
        : null;
      const [buckets, freshestObservationAt] = await Promise.all([
        precomputed !== null && precomputed.length > 0
          ? Promise.resolve(precomputed)
          : getObservationsAggregated(deps.pool, filters, gridMultiplier),
        getFreshestObservationAt(deps.pool),
      ]);
      c.header('Cache-Control', cacheControlFor('observations'));
      if (freshestObservationAt !== null) {
        const freshnessSeconds = Math.floor(
          (Date.now() - new Date(freshestObservationAt).getTime()) / 1000
        );
        console.log(JSON.stringify({
          severity: 'INFO',
          message: 'meta_freshness',
          meta_freshness_seconds: freshnessSeconds,
        }));
      }
      const body: ObservationsResponse = {
        mode: 'aggregated',
        buckets,
        meta: { freshestObservationAt },
      };
      return c.json(body);
    }

    // #667 Scope C.1 — per-observation path requires a BOUNDED scope: bbox,
    // species, OR state (#734 B4). Family-only with no bound is the scrape
    // vector for "all of family X nationally"; reject before hitting the DB.
    // Aggregated mode above already returned, so this check only fires on the
    // heavier path. `?state=` is bounded by the polygon clip, so it is accepted.
    const guard = assertBboxOrSpecies({ bbox, speciesCode, stateCode });
    if (!guard.ok) {
      console.log(JSON.stringify(guard.log));
      return c.json({ error: guard.error }, 400);
    }

    // #667 Scope C.2 — per-axis bbox cap on the per-observation path.
    // `zoom < 6` (aggregated) already returned; here `zoom` may be >=6 or
    // undefined (deep links before MapCanvas mounts). The cap only fires
    // when zoom >= 6.
    if (bbox !== undefined) {
      const cap = assertBboxAreaCap(bbox, zoom);
      if (!cap.ok) {
        console.log(JSON.stringify(cap.log));
        return c.json(cap.body, 400);
      }
    }

    // Run both queries in parallel — getObservations fetches the filtered rows;
    // getFreshestObservationAt provides MAX(ingested_at) for the freshness
    // state machine on the frontend. The aggregate query is cheap (single
    // table scan for the max timestamp) and does not vary by filter params —
    // it reflects the age of our entire dataset, not the filtered slice.
    const [obsResult, freshestObservationAt] = await Promise.all([
      getObservations(deps.pool, filters),
      getFreshestObservationAt(deps.pool),
    ]);
    c.header('Cache-Control', cacheControlFor('observations'));

    // Structured-log emit for the S2 data-staleness alert
    // (docs/plans/2026-05-17-monitoring-and-alerts.md). Cloud Logging's
    // log-based metric `bird-meta-freshness-seconds` extracts
    // jsonPayload.meta_freshness_seconds from this line; the alert fires
    // when the p95 over a 30min window exceeds 21600s (6h).
    //
    // Null is deliberately not emitted — an empty observations table is a
    // different failure class than stale data, and the metric's value_extractor
    // filter excludes null entries anyway. Emitting null would only inflate
    // log-based-metric volume against the free-tier ceiling.
    if (freshestObservationAt !== null) {
      const freshnessSeconds = Math.floor(
        (Date.now() - new Date(freshestObservationAt).getTime()) / 1000
      );
      console.log(JSON.stringify({
        severity: 'INFO',
        message: 'meta_freshness',
        meta_freshness_seconds: freshnessSeconds,
      }));
    }

    // #733 (plan task B6) — getObservations now returns { data, truncated }.
    // Surface `meta.truncated: true` only when the row brake fired; omit the
    // field otherwise (stale CDN bodies and the aggregated path both treat the
    // absent field as "not truncated", so emitting `truncated: false` would be
    // noise). The aggregated branch above never truncates and never sets it.
    const body: ObservationsResponse = {
      mode: 'observations',
      data: obsResult.data,
      meta: {
        freshestObservationAt,
        ...(obsResult.truncated ? { truncated: true } : {}),
      },
    };
    return c.json(body);
  });

  app.get('/api/silhouettes', async c => {
    const rows = await getSilhouettes(deps.pool);
    c.header('Cache-Control', cacheControlFor('silhouettes'));
    return c.json(rows);
  });

  // State-boundary summaries (name + [w,s,e,n] bbox) for the scope selector +
  // camera framing. This is served as a tiny (~4 KB) endpoint rather than a
  // bundled frontend JSON so the clip (observations.ts ST_Intersects) and the
  // selector/camera read ONE source of truth — the state_boundaries table —
  // and can never drift (locked decision #7 of the state-scope plan). The
  // accessor (listStatesWithBbox) deliberately excludes `geom`, so the polygon
  // geometry never leaves the server. Long-lived `immutable` cache: the seed
  // is build-time-stable (see cache-headers.ts).
  app.get('/api/states', async c => {
    const rows = await listStatesWithBbox(deps.pool);
    c.header('Cache-Control', cacheControlFor('states'));
    return c.json(rows);
  });

  // #859 — the full species dictionary (code → {comName, familyCode}). The
  // frontend fetches this ONCE and joins it against the species codes carried
  // in the aggregated buckets, so the low-zoom wire never repeats names per
  // bucket. Registered BEFORE the `/api/species/:code` detail route: Hono's
  // trie router only matches `:code` when a non-empty path segment follows
  // `/api/species/`, so `/api/species` (no trailing segment) cannot be shadowed
  // by it — but declaring the static route first keeps the precedence explicit
  // and order-independent of any future router change. Long-lived cache:
  // names change only on a taxonomy refresh (see the 'species-dict' tier).
  app.get('/api/species', async c => {
    const dict = await getSpeciesDictionary(deps.pool);
    c.header('Cache-Control', cacheControlFor('species-dict'));
    return c.json(dict);
  });

  app.get('/api/species/:code', async c => {
    const code = c.req.param('code');
    const meta = await getSpeciesMeta(deps.pool, code);
    if (!meta) return c.json({ error: 'not found' }, 404);
    c.header('Cache-Control', cacheControlFor('species'));
    return c.json(meta);
  });

  // 404 for unknown species mirrors the species-meta route at line 101 above.
  // The existence check uses getSpeciesMeta to avoid divergence from the
  // sibling endpoint. Known-but-unobserved species return 200 [] (sparse —
  // frontend zero-fills to 12 months before rendering).
  app.get('/api/species/:code/phenology', async c => {
    const code = c.req.param('code');
    const meta = await getSpeciesMeta(deps.pool, code);
    if (!meta) return c.json({ error: 'not found' }, 404);
    const rows = await getSpeciesPhenology(deps.pool, code);
    c.header('Cache-Control', cacheControlFor('phenology'));
    return c.json(rows);
  });

  app.onError((err, c) => {
    const code = (err as { code?: string }).code ?? '';
    // OS-level connection errors
    if (['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'].includes(code)) {
      return c.json({ error: 'database unavailable' }, 503);
    }
    // pg-pool timeout (no .code, matched by name/message)
    if (err.name === 'TimeoutError' || /timeout/i.test(err.message)) {
      return c.json({ error: 'database unavailable' }, 503);
    }
    // Postgres server-side connection errors: 53xxx class (insufficient resources)
    // 53300 = too_many_connections, 53200 = out_of_memory, 53100 = disk_full
    if (code.startsWith('53')) {
      return c.json({ error: 'database unavailable' }, 503);
    }
    console.error('Unhandled error', err);
    return c.json({ error: 'internal' }, 500);
  });

  return app;
}

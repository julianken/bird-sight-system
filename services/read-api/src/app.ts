import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { cors } from 'hono/cors';
import type { Pool } from '@bird-watch/db-client';
import {
  getHotspots, getObservations, getFreshestObservationAt,
  getSpeciesMeta, getSilhouettes,
  getSpeciesPhenology,
} from '@bird-watch/db-client';
import type { ObservationsResponse } from '@bird-watch/shared-types';
import { cacheControlFor } from './cache-headers.js';
import { rateLimitFromEnv } from './rate-limit.js';

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

  app.get('/health', c => c.json({ ok: true }));

  app.get('/api/hotspots', async c => {
    const rows = await getHotspots(deps.pool);
    c.header('Cache-Control', cacheControlFor('hotspots'));
    return c.json(rows);
  });

  app.get('/api/observations', async c => {
    const sinceRaw = c.req.query('since');
    const validSince = ['1d', '7d', '14d', '30d'] as const;
    if (sinceRaw !== undefined && !(validSince as readonly string[]).includes(sinceRaw)) {
      return c.json({ error: 'invalid since' }, 400);
    }
    const since = sinceRaw as '1d' | '7d' | '14d' | '30d' | undefined;
    const notableParam = c.req.query('notable');
    const speciesCode = c.req.query('species');
    const familyCode = c.req.query('family');

    const filters: Parameters<typeof getObservations>[1] = {};
    if (since !== undefined) filters.since = since;
    if (notableParam === 'true') filters.notable = true;
    if (speciesCode !== undefined) filters.speciesCode = speciesCode;
    if (familyCode !== undefined) filters.familyCode = familyCode;

    // Run both queries in parallel — getObservations fetches the filtered rows;
    // getFreshestObservationAt provides MAX(ingested_at) for the freshness
    // state machine on the frontend. The aggregate query is cheap (single
    // table scan for the max timestamp) and does not vary by filter params —
    // it reflects the age of our entire dataset, not the filtered slice.
    const [rows, freshestObservationAt] = await Promise.all([
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

    const body: ObservationsResponse = {
      data: rows,
      meta: { freshestObservationAt },
    };
    return c.json(body);
  });

  app.get('/api/silhouettes', async c => {
    const rows = await getSilhouettes(deps.pool);
    c.header('Cache-Control', cacheControlFor('silhouettes'));
    return c.json(rows);
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

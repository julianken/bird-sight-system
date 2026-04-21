import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { cors } from 'hono/cors';
import type { Pool } from '@bird-watch/db-client';
import { getRegions, getHotspots, getObservations, getSpeciesMeta } from '@bird-watch/db-client';
import { cacheControlFor } from './cache-headers.js';

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
  // Interaction with route-level `Cache-Control: public, immutable` on
  // /api/regions and /api/species/:code: Hono sets `Vary: Origin`, so a
  // spec-compliant CDN keys the cache per-Origin. That means the identical
  // JSON body is stored N× for N allowed origins (currently 3 — trivial).
  // Uptime probes and plain `curl` hit these routes without an Origin
  // header, so the CDN also caches a no-ACAO entry; browsers never see that
  // entry because Cloud CDN honors Vary. The cached bodies contain no
  // Origin-derived data, so serving any cached entry across origins would
  // still be correct — `Vary: Origin` is purely for header correctness.
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

  app.get('/health', c => c.json({ ok: true }));

  app.get('/api/regions', async c => {
    const rows = await getRegions(deps.pool);
    c.header('Cache-Control', cacheControlFor('regions'));
    return c.json(rows);
  });

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

    const rows = await getObservations(deps.pool, filters);
    c.header('Cache-Control', cacheControlFor('observations'));
    return c.json(rows);
  });

  app.get('/api/species/:code', async c => {
    const code = c.req.param('code');
    const meta = await getSpeciesMeta(deps.pool, code);
    if (!meta) return c.json({ error: 'not found' }, 404);
    c.header('Cache-Control', cacheControlFor('species'));
    return c.json(meta);
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

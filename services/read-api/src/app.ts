import { Hono } from 'hono';
import type { Pool } from '@bird-watch/db-client';
import { getRegions, getHotspots, getObservations, getSpeciesMeta } from '@bird-watch/db-client';
import { cacheControlFor } from './cache-headers.js';

export interface AppDeps {
  pool: Pool;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

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
    const msg = (err as { code?: string }).code ?? '';
    if (['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'].includes(msg)) {
      return c.json({ error: 'database unavailable' }, 503);
    }
    if (err.name === 'TimeoutError' || /timeout/i.test(err.message)) {
      return c.json({ error: 'database unavailable' }, 503);
    }
    console.error('Unhandled error', err);
    return c.json({ error: 'internal' }, 500);
  });

  return app;
}

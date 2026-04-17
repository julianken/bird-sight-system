import { Hono } from 'hono';
import type { Pool } from '@bird-watch/db-client';
import { getRegions, getHotspots } from '@bird-watch/db-client';
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

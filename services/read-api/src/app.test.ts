import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, type TestDb } from '@bird-watch/db-client/dist/test-helpers.js';
import {
  upsertHotspots,
  upsertSpeciesMeta,
  upsertObservations,
} from '@bird-watch/db-client';
import { createApp } from './app.js';

let db: TestDb;
beforeAll(async () => { db = await startTestDb(); }, 90_000);
afterAll(async () => { await db?.stop(); });

describe('GET /api/regions', () => {
  it('returns the 9 seeded regions with the correct cache header', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/regions');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control'))
      .toBe('public, max-age=604800, immutable');
    const body = await res.json() as Array<{ id: string }>;
    expect(body).toHaveLength(9);
    expect(body.find(r => r.id === 'sky-islands-santa-ritas')).toBeTruthy();
  });
});

describe('GET /api/hotspots', () => {
  it('returns hotspots with the correct cache header', async () => {
    await upsertHotspots(db.pool, [
      { locId: 'L207118', locName: 'Sweetwater Wetlands',
        lat: 32.30, lng: -110.99, numSpeciesAlltime: 280, latestObsDt: '2026-04-15T12:00:00Z' },
    ]);
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/hotspots');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control'))
      .toBe('public, max-age=86400, stale-while-revalidate=3600');
    const body = await res.json() as Array<{ locId: string; regionId: string | null }>;
    expect(body[0]?.locId).toBe('L207118');
    expect(body[0]?.regionId).toBe('sonoran-tucson');
  });
});

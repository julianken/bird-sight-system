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

describe('GET /api/observations', () => {
  beforeAll(async () => {
    await upsertSpeciesMeta(db.pool, [
      { speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        sciName: 'Pyrocephalus rubinus', familyCode: 'tyrannidae',
        familyName: 'Tyrant Flycatchers', taxonOrder: 30501 },
      { speciesCode: 'annhum', comName: "Anna's Hummingbird",
        sciName: 'Calypte anna', familyCode: 'trochilidae',
        familyName: 'Hummingbirds', taxonOrder: 6000 },
    ]);
    await db.pool.query('TRUNCATE observations');
    await upsertObservations(db.pool, [
      { subId: 'S1', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: 31.72, lng: -110.88, obsDt: new Date(Date.now() - 5*86400_000).toISOString(),
        locId: 'L1', locName: 'X', howMany: 1, isNotable: false },
      { subId: 'S2', speciesCode: 'annhum', comName: "Anna's Hummingbird",
        lat: 32.30, lng: -110.99, obsDt: new Date(Date.now() - 20*86400_000).toISOString(),
        locId: 'L2', locName: 'Y', howMany: 1, isNotable: true },
    ]);
  });

  it('returns observations with correct cache header', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/observations?since=30d');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control'))
      .toBe('public, max-age=1800, stale-while-revalidate=600');
    const body = await res.json() as Array<unknown>;
    expect(body).toHaveLength(2);
  });

  it('filters by since=14d', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/observations?since=14d');
    const body = await res.json() as Array<{ subId: string }>;
    expect(body.map(o => o.subId)).toEqual(['S1']);
  });

  it('filters by notable=true', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/observations?since=30d&notable=true');
    const body = await res.json() as Array<{ subId: string }>;
    expect(body.map(o => o.subId)).toEqual(['S2']);
  });

  it('filters by species code', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/observations?since=30d&species=vermfly');
    const body = await res.json() as Array<{ subId: string }>;
    expect(body.map(o => o.subId)).toEqual(['S1']);
  });

  it('filters by family code', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/observations?since=30d&family=trochilidae');
    const body = await res.json() as Array<{ subId: string }>;
    expect(body.map(o => o.subId)).toEqual(['S2']);
  });

  it('rejects invalid since values with 400', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/observations?since=banana');
    expect(res.status).toBe(400);
  });
});

describe('error handling', () => {
  it('returns 503 when DB query throws a connection error', async () => {
    const pg = await import('pg');
    const badPool = new pg.default.Pool({
      connectionString: 'postgres://nope:nope@127.0.0.1:1/none',
      max: 1,
      connectionTimeoutMillis: 200,
    });
    const app = createApp({ pool: badPool as unknown as Parameters<typeof createApp>[0]['pool'] });
    const res = await app.request('/api/regions');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'database unavailable' });
    await badPool.end();
  });
});

describe('GET /api/species/:code', () => {
  it('returns species meta for a known code', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/species/vermfly');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control'))
      .toBe('public, max-age=604800, immutable');
    const body = await res.json() as { speciesCode: string; comName: string };
    expect(body.speciesCode).toBe('vermfly');
    expect(body.comName).toBe('Vermilion Flycatcher');
  });

  it('returns 404 for unknown species', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/species/notreal');
    expect(res.status).toBe(404);
  });
});

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

  it('projects familyCode from species_meta onto each observation (#57)', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/observations?since=30d');
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ subId: string; familyCode: string | null }>;
    const byId = Object.fromEntries(body.map(o => [o.subId, o.familyCode]));
    expect(byId['S1']).toBe('tyrannidae');
    expect(byId['S2']).toBe('trochilidae');
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
    const res = await app.request('/api/hotspots');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'database unavailable' });
    await badPool.end();
  });
});

describe('GET /api/silhouettes', () => {
  it('returns all 26 seeded family silhouettes with the silhouettes cache header', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/silhouettes');
    expect(res.status).toBe(200);
    // Must come from cacheControlFor('silhouettes') — NOT a hardcoded string.
    // Both sides of the equality reference the same TTL table entry; if that
    // entry ever changes this test will flag both the route and the table.
    // No `immutable` directive: silhouette payload drifts between deploys
    // (curation, Phylopic seed expansion); see cache-headers.ts comment.
    expect(res.headers.get('cache-control'))
      .toBe('public, max-age=604800');
    const body = await res.json() as Array<{
      familyCode: string; color: string; svgData: string | null;
      source: string | null; license: string | null;
    }>;
    // 15 rows from migration 9000 + 10 AZ-family expansion rows + 1
    // `_FALLBACK` row from migration 15000 (issue #244).
    expect(body).toHaveLength(26);
    const tyrannidae = body.find(r => r.familyCode === 'tyrannidae');
    expect(tyrannidae?.color).toBe('#C77A2E');
  });

  it('provides color for every family_code present in species_meta (parity with deleted FAMILY_TO_COLOR)', async () => {
    // Issue #55 option (a): DB is now the single SOT for family colors.
    // For every family that species_meta references, the silhouettes
    // endpoint must return a color — otherwise the frontend's fallback
    // path would fire in production. Seeded species_meta at the top of
    // this suite covers tyrannidae + trochilidae; assert both resolve.
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/silhouettes');
    const body = await res.json() as Array<{ familyCode: string; color: string }>;
    const byFamily = Object.fromEntries(body.map(r => [r.familyCode, r.color]));
    expect(byFamily['tyrannidae']).toBe('#C77A2E');
    expect(byFamily['trochilidae']).toBe('#7B2D8E');
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

describe('gzip compression middleware', () => {
  beforeAll(async () => {
    // The compress middleware's default threshold is 1024 bytes — responses
    // below it are returned uncompressed. The /api/observations seed from
    // the earlier describe leaves ~2 rows (~600 bytes of JSON), so we seed
    // extra rows here to push /api/observations?since=30d comfortably past
    // the threshold and get a deterministic compression outcome.
    const extra = Array.from({ length: 20 }, (_, i) => ({
      subId: `S-gzip-${i}`,
      speciesCode: 'vermfly',
      comName: 'Vermilion Flycatcher',
      lat: 31.72 + i * 0.01,
      lng: -110.88 + i * 0.01,
      obsDt: new Date(Date.now() - i * 86400_000).toISOString(),
      locId: `L-gzip-${i}`,
      locName: `Gzip Seed Location ${i}`,
      howMany: 1,
      isNotable: false,
    }));
    await upsertObservations(db.pool, extra);
  });

  it('returns content-encoding: gzip when client accepts gzip', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/observations?since=30d', {
      headers: { 'Accept-Encoding': 'gzip' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-encoding')).toBe('gzip');
  });

  it('omits content-encoding when client does not advertise gzip', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/observations?since=30d');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-encoding')).toBeNull();
  });

  it('sets Vary: Accept-Encoding on a gzipped response', async () => {
    // Caches (CloudFlare CDN, browser caches) must vary their stored entry
    // by Accept-Encoding so they never serve a gzip body to a client that
    // didn't negotiate it.  See #143.
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/observations?since=30d', {
      headers: { 'Accept-Encoding': 'gzip' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-encoding')).toBe('gzip');
    expect(
      res.headers.get('vary')?.toLowerCase().includes('accept-encoding'),
    ).toBe(true);
  });
});

describe('CORS middleware', () => {
  // Save + restore FRONTEND_ORIGINS around tests that mutate it so other
  // describe blocks stay deterministic.
  const ORIGINAL_FRONTEND_ORIGINS = process.env.FRONTEND_ORIGINS;
  afterAll(() => {
    if (ORIGINAL_FRONTEND_ORIGINS === undefined) {
      delete process.env.FRONTEND_ORIGINS;
    } else {
      process.env.FRONTEND_ORIGINS = ORIGINAL_FRONTEND_ORIGINS;
    }
  });

  it('returns Access-Control-Allow-Origin for an allow-listed origin', async () => {
    delete process.env.FRONTEND_ORIGINS; // use default allowlist
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/hotspots', {
      headers: { Origin: 'https://bird-maps.com' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin'))
      .toBe('https://bird-maps.com');
  });

  it('omits Access-Control-Allow-Origin for a disallowed origin', async () => {
    delete process.env.FRONTEND_ORIGINS;
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/hotspots', {
      headers: { Origin: 'https://evil.example' },
    });
    // Hono's cors omits the ACAO header entirely (rather than echoing) for
    // origins not in the allowlist — browsers treat the absence as a block.
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('responds 204 to an OPTIONS preflight with allow-methods: GET', async () => {
    delete process.env.FRONTEND_ORIGINS;
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/observations', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://bird-maps.com',
        'Access-Control-Request-Method': 'GET',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin'))
      .toBe('https://bird-maps.com');
    // Header value may be a single method or CSV; assert GET is present.
    expect(res.headers.get('access-control-allow-methods') ?? '')
      .toMatch(/GET/);
  });

  it('trims whitespace when parsing FRONTEND_ORIGINS', async () => {
    // Leading/trailing whitespace in each comma-separated entry must be
    // stripped; otherwise Hono's array-origin matcher (strict .includes)
    // silently rejects the browser's exact Origin header.
    process.env.FRONTEND_ORIGINS = ' https://a.test , https://b.test ';
    const app = createApp({ pool: db.pool });
    const resA = await app.request('/api/hotspots', {
      headers: { Origin: 'https://a.test' },
    });
    const resB = await app.request('/api/hotspots', {
      headers: { Origin: 'https://b.test' },
    });
    expect(resA.headers.get('access-control-allow-origin')).toBe('https://a.test');
    expect(resB.headers.get('access-control-allow-origin')).toBe('https://b.test');
  });

  it('sets Vary: Origin on a cached route so CDN keys per-origin', async () => {
    // `/api/species/:code` is served with `Cache-Control: public, immutable`.
    // With `Vary: Origin`, a spec-compliant CDN caches a separate entry per
    // Origin. That multiplies the cache namespace N× for N allowed origins
    // (trivial at 3, callable-out if that grows) but keeps the ACAO header
    // correct for each cached response. The body itself is Origin-agnostic.
    delete process.env.FRONTEND_ORIGINS;
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/species/vermfly', {
      headers: { Origin: 'https://bird-maps.com' },
    });
    expect(res.status).toBe(200);
    const vary = res.headers.get('vary') ?? '';
    expect(vary.toLowerCase()).toContain('origin');
    // Coexists with route-level Cache-Control.
    expect(res.headers.get('cache-control'))
      .toBe('public, max-age=604800, immutable');
  });
});

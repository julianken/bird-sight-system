import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { startTestDb, type TestDb } from '@bird-watch/db-client/dist/test-helpers.js';
import { upsertSpeciesMeta, getObservations, getRecentIngestRuns } from '@bird-watch/db-client';
import { runIngest } from './run-ingest.js';

const server = setupServer();
let db: TestDb;

const RECENT = [
  { speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
    sciName: 'Pyrocephalus rubinus', locId: 'L1', locName: 'Madera',
    obsDt: '2026-04-15 08:00', howMany: 2, lat: 31.72, lng: -110.88,
    obsValid: true, obsReviewed: false, locationPrivate: false, subId: 'S100' },
  { speciesCode: 'annhum', comName: 'Anna\'s Hummingbird',
    sciName: 'Calypte anna', locId: 'L2', locName: 'Sweetwater',
    obsDt: '2026-04-15 09:00', howMany: 1, lat: 32.30, lng: -110.99,
    obsValid: true, obsReviewed: false, locationPrivate: false, subId: 'S101' },
];
const NOTABLE = [
  { ...RECENT[1] },  // mark S101 / annhum as notable
];

beforeAll(async () => {
  db = await startTestDb();
  server.listen({ onUnhandledRequest: 'error' });
  await upsertSpeciesMeta(db.pool, [
    { speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
      sciName: 'Pyrocephalus rubinus', familyCode: 'tyrannidae',
      familyName: 'Tyrant Flycatchers', taxonOrder: 30501 },
    { speciesCode: 'annhum', comName: 'Anna\'s Hummingbird',
      sciName: 'Calypte anna', familyCode: 'trochilidae',
      familyName: 'Hummingbirds', taxonOrder: 6000 },
  ]);
}, 90_000);

afterEach(() => server.resetHandlers());

beforeEach(async () => {
  await db.pool.query('TRUNCATE observations');
  await db.pool.query('TRUNCATE ingest_runs RESTART IDENTITY');
});

afterAll(async () => {
  server.close();
  await db?.stop();
});

describe('runIngest', () => {
  it('fetches recent + notable, upserts, and stamps region/silhouette/is_notable', async () => {
    server.use(
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent', () => HttpResponse.json(RECENT)),
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent/notable', () => HttpResponse.json(NOTABLE))
    );

    const summary = await runIngest({
      pool: db.pool,
      apiKey: 'test-key',
      regionCode: 'US-AZ',
      back: 14,
    });

    expect(summary.fetched).toBe(2);
    expect(summary.upserted).toBe(2);
    expect(summary.status).toBe('success');

    const obs = await getObservations(db.pool, {});
    expect(obs).toHaveLength(2);
    const verm = obs.find(o => o.subId === 'S100')!;
    expect(verm.regionId).toBe('sky-islands-santa-ritas');
    expect(verm.silhouetteId).toBe('tyrannidae');
    expect(verm.isNotable).toBe(false);
    const anna = obs.find(o => o.subId === 'S101')!;
    expect(anna.regionId).toBe('sonoran-tucson');
    expect(anna.silhouetteId).toBe('trochilidae');
    expect(anna.isNotable).toBe(true);

    const runs = await getRecentIngestRuns(db.pool, 5);
    expect(runs[0]?.status).toBe('success');
    expect(runs[0]?.kind).toBe('recent');
  });

  it('is idempotent — second run with same data does not duplicate', async () => {
    server.use(
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent', () => HttpResponse.json(RECENT)),
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent/notable', () => HttpResponse.json([]))
    );
    await runIngest({ pool: db.pool, apiKey: 'k', regionCode: 'US-AZ' });
    await runIngest({ pool: db.pool, apiKey: 'k', regionCode: 'US-AZ' });
    const obs = await getObservations(db.pool, {});
    expect(obs).toHaveLength(2);
  });

  it('records a failure run when eBird is unreachable', async () => {
    server.use(
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent', () => new HttpResponse('boom', { status: 502 })),
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent/notable', () => HttpResponse.json([]))
    );
    const summary = await runIngest({
      pool: db.pool, apiKey: 'k', regionCode: 'US-AZ',
      retryBaseMs: 1, maxRetries: 1,
    });
    expect(summary.status).toBe('failure');
    expect(summary.error).toBeDefined();
    const runs = await getRecentIngestRuns(db.pool, 5);
    expect(runs[0]?.status).toBe('failure');
    expect(runs[0]?.errorMessage).toContain('502');
  });
});

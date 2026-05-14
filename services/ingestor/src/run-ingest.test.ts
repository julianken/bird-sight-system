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
    // regionId removed from wire shape by PR-2 of #532; column dropped in PR-3.
    expect(verm).not.toHaveProperty('regionId');
    expect(verm.silhouetteId).toBe('tyrannidae');
    expect(verm.isNotable).toBe(false);
    const anna = obs.find(o => o.subId === 'S101')!;
    expect(anna).not.toHaveProperty('regionId');
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

  // Invariant from issue #484: if eBird returns an observation whose
  // species_code has no matching species_meta row, the ingest must fail
  // LOUDLY rather than silently inserting an observation that the read-api
  // cannot resolve to a /api/species/:code response. Future eBird hybrid/spuh
  // codes that appear in the AZ feed therefore become a CI/cron failure that
  // a maintainer sees, not a silent prod 404 a user reports.
  it('fails the ingest when an observation references a missing species_meta row (#484 invariant)', async () => {
    const RECENT_WITH_LEAK = [
      ...RECENT,
      // `xUNKNOWN1` is a synthetic eBird-style spuh code with no
      // species_meta row — simulates the bug class from #484
      // (`ixlbun`, `x00059`, etc. before the backfill).
      { speciesCode: 'xUNKNOWN1', comName: 'Unknown Hybrid',
        sciName: 'Genus species x other', locId: 'L3', locName: 'Test',
        obsDt: '2026-04-15 10:00', howMany: 1, lat: 32.30, lng: -110.99,
        obsValid: true, obsReviewed: false, locationPrivate: false,
        subId: 'S102' },
    ];
    server.use(
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent',
        () => HttpResponse.json(RECENT_WITH_LEAK)),
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent/notable',
        () => HttpResponse.json([])),
    );

    const summary = await runIngest({
      pool: db.pool, apiKey: 'k', regionCode: 'US-AZ',
    });

    expect(summary.status).toBe('failure');
    expect(summary.error).toBeDefined();
    // Error message must name the offending code(s) so a triage agent can
    // jump straight to a `species_meta` backfill PR without re-deriving
    // which code triggered the failure.
    expect(summary.error).toContain('xUNKNOWN1');
    // No observations may have been inserted — the invariant runs BEFORE
    // upsert, so a leak fails the whole batch rather than corrupting the
    // read path.
    const obs = await getObservations(db.pool, {});
    expect(obs).toHaveLength(0);
    // Failure must be recorded in ingest_runs for the freshness monitor.
    const runs = await getRecentIngestRuns(db.pool, 5);
    expect(runs[0]?.status).toBe('failure');
    expect(runs[0]?.errorMessage).toContain('xUNKNOWN1');
  });

  it('succeeds (no false-positive invariant trip) when every observation has a species_meta row', async () => {
    // Regression guard: the invariant must NOT block legitimate ingests
    // — only the ones that genuinely reference missing species_meta rows.
    // RECENT's two codes (vermfly, annhum) are both seeded in beforeAll.
    server.use(
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent',
        () => HttpResponse.json(RECENT)),
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent/notable',
        () => HttpResponse.json([])),
    );
    const summary = await runIngest({
      pool: db.pool, apiKey: 'k', regionCode: 'US-AZ',
    });
    expect(summary.status).toBe('success');
    expect(summary.upserted).toBe(2);
  });
});

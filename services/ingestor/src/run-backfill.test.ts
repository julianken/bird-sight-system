import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { startTestDb, type TestDb } from '@bird-watch/db-client/dist/test-helpers.js';
import { upsertSpeciesMeta, getObservations, getRecentIngestRuns } from '@bird-watch/db-client';
import { runBackfill } from './run-backfill.js';
import { runIngest } from './run-ingest.js';
import { EbirdClient } from './ebird/client.js';

const server = setupServer();
let db: TestDb;

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
beforeEach(async () => { await db.pool.query('TRUNCATE observations'); });
afterAll(async () => { server.close(); await db?.stop(); });

// Shared observation fixtures used across several tests.
const TODAY_OBS = {
  speciesCode: 'annhum', comName: 'Anna\'s Hummingbird',
  sciName: 'Calypte anna', locId: 'L99', locName: 'Sweetwater',
  obsDt: '2026-04-16 08:00', howMany: 1, lat: 32.30, lng: -110.99,
  obsValid: true, obsReviewed: false, locationPrivate: false, subId: 'S999',
};

describe('runBackfill', () => {
  it('walks N days back and upserts observations from each day', async () => {
    let calls = 0;
    server.use(
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent/notable', () => HttpResponse.json([])),
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/historic/:y/:m/:d', () => {
        calls++;
        return HttpResponse.json([
          { speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
            sciName: 'Pyrocephalus rubinus', locId: `L${calls}`, locName: 'X',
            obsDt: '2026-04-10 08:00', howMany: 1, lat: 31.72, lng: -110.88,
            obsValid: true, obsReviewed: false, locationPrivate: false,
            subId: `S${calls}` },
        ]);
      })
    );

    const today = new Date('2026-04-16T00:00:00Z');
    const summary = await runBackfill({
      pool: db.pool, apiKey: 'k', regionCode: 'US-AZ',
      days: 3, today,
    });
    expect(calls).toBe(3);
    expect(summary.status).toBe('success');
    const obs = await getObservations(db.pool, {});
    expect(obs).toHaveLength(3);
  });

  it('preserves is_notable=true after backfill re-processes a day runIngest already stamped', async () => {
    // Step 1: runIngest stamps annhum as notable.
    server.use(
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent', () =>
        HttpResponse.json([TODAY_OBS])
      ),
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent/notable', () =>
        HttpResponse.json([TODAY_OBS])   // annhum is notable
      ),
    );
    await runIngest({ pool: db.pool, apiKey: 'k', regionCode: 'US-AZ' });

    // Confirm it was stamped notable.
    let obs = await getObservations(db.pool, {});
    expect(obs.find(o => o.subId === 'S999')?.isNotable).toBe(true);

    // Step 2: runBackfill with back=3 days — its /recent/notable returns [] (empty keyset).
    // The OR-coalesce in upsertObservations must keep is_notable=true.
    server.use(
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent/notable', () =>
        HttpResponse.json([])   // empty — backfill doesn't know about notable
      ),
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/historic/:y/:m/:d', () =>
        HttpResponse.json([TODAY_OBS])   // same observation, same subId
      ),
    );
    const today = new Date('2026-04-16T00:00:00Z');
    const summary = await runBackfill({
      pool: db.pool, apiKey: 'k', regionCode: 'US-AZ',
      days: 3, today,
    });
    expect(summary.status).toBe('success');

    // is_notable must still be true — OR-coalesce defended against the empty keyset.
    obs = await getObservations(db.pool, {});
    expect(obs.find(o => o.subId === 'S999')?.isNotable).toBe(true);
  });

  it('returns status=partial when some days fail, successful days still upserted', async () => {
    // Day offsets: i=1 (day -1) → 200, i=2 (day -2) → 500, i=3 (day -3) → 200.
    let callCount = 0;
    server.use(
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent/notable', () => HttpResponse.json([])),
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/historic/:y/:m/:d', ({ params }) => {
        callCount++;
        const day = Number(params['d']);
        // Apr 15 (day=15) and Apr 13 (day=13) succeed; Apr 14 (day=14) fails.
        if (day === 14) {
          return new HttpResponse('eBird server exploded', { status: 500 });
        }
        return HttpResponse.json([
          { speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
            sciName: 'Pyrocephalus rubinus', locId: `L${callCount}`, locName: 'X',
            obsDt: `2026-04-${String(day).padStart(2, '0')} 08:00`,
            howMany: 1, lat: 31.72, lng: -110.88,
            obsValid: true, obsReviewed: false, locationPrivate: false,
            subId: `SDay${day}` },
        ]);
      }),
    );

    // today = Apr 16; i=1→Apr15, i=2→Apr14 (500), i=3→Apr13
    // Use maxRetries=0 so the 500 fails fast without waiting on backoff.
    const today = new Date('2026-04-16T00:00:00Z');
    const client = new EbirdClient({ apiKey: 'k', maxRetries: 0 });
    const summary = await runBackfill({
      pool: db.pool, apiKey: 'k', regionCode: 'US-AZ',
      days: 3, today, client,
    });

    expect(summary.status).toBe('partial');
    expect(summary.daysProcessed).toBe(2);
    expect(summary.error).toMatch(/500|server/i);

    // Days 1 and 3 (Apr 15 + Apr 13) must have been upserted.
    const obs = await getObservations(db.pool, {});
    const subIds = obs.map(o => o.subId).sort();
    expect(subIds).toContain('SDay15');
    expect(subIds).toContain('SDay13');
  });

  it('records failure when pre-loop fetchNotable throws exhausted retries', async () => {
    server.use(
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent/notable', () =>
        new HttpResponse('bad gateway', { status: 502 })
      )
    );
    const client = new EbirdClient({ apiKey: 'k', maxRetries: 0, retryBaseMs: 1 });
    const summary = await runBackfill({
      pool: db.pool, apiKey: 'k', regionCode: 'US-AZ', days: 3, client,
    });
    expect(summary.status).toBe('failure');
    expect(summary.error).toMatch(/502|server/i);

    const runs = await getRecentIngestRuns(db.pool, 10);
    expect(runs[0]?.status).toBe('failure');
  });
});

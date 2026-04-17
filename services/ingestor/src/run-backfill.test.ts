import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { startTestDb, type TestDb } from '@bird-watch/db-client/dist/test-helpers.js';
import { upsertSpeciesMeta, getObservations } from '@bird-watch/db-client';
import { runBackfill } from './run-backfill.js';

const server = setupServer();
let db: TestDb;

beforeAll(async () => {
  db = await startTestDb();
  server.listen({ onUnhandledRequest: 'error' });
  await upsertSpeciesMeta(db.pool, [
    { speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
      sciName: 'Pyrocephalus rubinus', familyCode: 'tyrannidae',
      familyName: 'Tyrant Flycatchers', taxonOrder: 30501 },
  ]);
}, 90_000);

afterEach(() => server.resetHandlers());
beforeEach(async () => { await db.pool.query('TRUNCATE observations'); });
afterAll(async () => { server.close(); await db?.stop(); });

describe('runBackfill', () => {
  it('walks N days back and upserts observations from each day', async () => {
    let calls = 0;
    server.use(
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
});

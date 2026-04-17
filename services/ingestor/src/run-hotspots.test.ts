import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { startTestDb, type TestDb } from '@bird-watch/db-client/dist/test-helpers.js';
import { getHotspots } from '@bird-watch/db-client';
import { runHotspotIngest } from './run-hotspots.js';

const server = setupServer();
let db: TestDb;

beforeAll(async () => {
  db = await startTestDb();
  server.listen({ onUnhandledRequest: 'error' });
}, 90_000);

afterEach(() => server.resetHandlers());
beforeEach(async () => { await db.pool.query('TRUNCATE hotspots'); });
afterAll(async () => { server.close(); await db?.stop(); });

describe('runHotspotIngest', () => {
  it('fetches hotspots from eBird and upserts with region stamping', async () => {
    server.use(
      http.get('https://api.ebird.org/v2/ref/hotspot/US-AZ', () => HttpResponse.json([
        { locId: 'L1', locName: 'Madera Canyon', countryCode: 'US',
          subnational1Code: 'US-AZ', lat: 31.72, lng: -110.88, numSpeciesAllTime: 410 },
        { locId: 'L2', locName: 'Sweetwater Wetlands', countryCode: 'US',
          subnational1Code: 'US-AZ', lat: 32.30, lng: -110.99, numSpeciesAllTime: 280 },
      ]))
    );

    const summary = await runHotspotIngest({
      pool: db.pool, apiKey: 'k', regionCode: 'US-AZ',
    });
    expect(summary.status).toBe('success');
    expect(summary.upserted).toBe(2);

    const stored = await getHotspots(db.pool);
    expect(stored).toHaveLength(2);
    expect(stored.find(h => h.locId === 'L1')?.regionId).toBe('sky-islands-santa-ritas');
    expect(stored.find(h => h.locId === 'L2')?.regionId).toBe('sonoran-tucson');
  });
});

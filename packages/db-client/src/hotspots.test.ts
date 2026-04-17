import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, type TestDb } from './test-helpers.js';
import { getHotspots, upsertHotspots } from './hotspots.js';

let db: TestDb;
beforeAll(async () => {
  db = await startTestDb();
  await upsertHotspots(db.pool, [
    { locId: 'L207118', locName: 'Sweetwater Wetlands', lat: 32.30, lng: -110.99, numSpeciesAlltime: 280, latestObsDt: '2026-04-15T12:00:00Z' },
    { locId: 'L101234', locName: 'Madera Canyon', lat: 31.72, lng: -110.88, numSpeciesAlltime: 410, latestObsDt: '2026-04-16T08:30:00Z' },
  ]);
}, 90_000);
afterAll(async () => { await db?.stop(); });

describe('getHotspots', () => {
  it('returns all hotspots with region_id stamped', async () => {
    const rows = await getHotspots(db.pool);
    expect(rows).toHaveLength(2);
    const sweetwater = rows.find(h => h.locId === 'L207118');
    expect(sweetwater?.regionId).toBe('sonoran-tucson');
    const madera = rows.find(h => h.locId === 'L101234');
    expect(madera?.regionId).toBe('sky-islands-santa-ritas');
  });
});

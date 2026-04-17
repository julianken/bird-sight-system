import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { startTestDb, type TestDb } from './test-helpers.js';
import { getSpeciesMeta, upsertSpeciesMeta } from './species.js';

let db: TestDb;
beforeAll(async () => { db = await startTestDb(); }, 90_000);
beforeEach(async () => { await db.pool.query('TRUNCATE species_meta CASCADE'); });
afterAll(async () => { await db?.stop(); });

describe('species meta', () => {
  it('upserts and returns by species code', async () => {
    await upsertSpeciesMeta(db.pool, [
      { speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        sciName: 'Pyrocephalus rubinus', familyCode: 'tyrannidae',
        familyName: 'Tyrant Flycatchers', taxonOrder: 30501 },
    ]);
    const row = await getSpeciesMeta(db.pool, 'vermfly');
    expect(row?.comName).toBe('Vermilion Flycatcher');
    expect(row?.familyCode).toBe('tyrannidae');
  });

  it('returns null for unknown species', async () => {
    const row = await getSpeciesMeta(db.pool, 'doesnotexist');
    expect(row).toBeNull();
  });
});

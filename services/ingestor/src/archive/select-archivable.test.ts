import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { startTestDb, type TestDb } from '@bird-watch/db-client/dist/test-helpers.js';
import { selectArchivable } from './select-archivable.js';

let db: TestDb;

beforeAll(async () => {
  db = await startTestDb();
  await db.pool.query(
    `INSERT INTO species_meta (species_code, com_name, sci_name, family_code, family_name)
     VALUES ('vermfly', 'Vermilion Flycatcher', 'Pyrocephalus rubinus', 'tyrannidae', 'Tyrant Flycatchers')`
  );
}, 90_000);

beforeEach(async () => {
  await db.pool.query('TRUNCATE observations');
});

afterAll(async () => { await db?.stop(); });

describe('selectArchivable', () => {
  it('returns rows for a single UTC day with species_meta joined', async () => {
    await db.pool.query(
      `INSERT INTO observations
         (sub_id, species_code, lat, lng, obs_dt, loc_id, loc_name, how_many, is_notable)
       VALUES
         ('S1', 'vermfly', 31.72, -110.88, '2026-05-01T12:00:00Z', 'L1', 'A', 2, false),
         ('S2', 'vermfly', 31.73, -110.89, '2026-05-01T18:00:00Z', 'L2', 'B', 1, true),
         ('S3', 'vermfly', 31.74, -110.90, '2026-05-02T00:00:01Z', 'L3', null, null, false)`
    );

    const rows = await selectArchivable({ pool: db.pool, utcDate: '2026-05-01' });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      sub_id: 'S1',
      species_code: 'vermfly',
      common_name: 'Vermilion Flycatcher',
      sci_name: 'Pyrocephalus rubinus',
      family_code: 'tyrannidae',
      family_name: 'Tyrant Flycatchers',
      is_notable: false,
    });
    expect(rows.find(r => r.sub_id === 'S2')?.is_notable).toBe(true);
  });

  it('returns rows for species with no species_meta entry (LEFT JOIN, not INNER)', async () => {
    await db.pool.query(
      `INSERT INTO observations
         (sub_id, species_code, lat, lng, obs_dt, loc_id, how_many, is_notable)
       VALUES ('S4', 'unknownsp', 31.72, -110.88, '2026-05-01T12:00:00Z', 'L1', 1, false)`
    );

    const rows = await selectArchivable({ pool: db.pool, utcDate: '2026-05-01' });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.common_name).toBeNull();
    expect(rows[0]?.family_code).toBeNull();
  });

  it('returns an empty array when no rows match the day', async () => {
    const rows = await selectArchivable({ pool: db.pool, utcDate: '2026-05-01' });
    expect(rows).toEqual([]);
  });
});

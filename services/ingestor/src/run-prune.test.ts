import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { startTestDb, type TestDb } from '@bird-watch/db-client/dist/test-helpers.js';
import { getRecentIngestRuns } from '@bird-watch/db-client';
import { runPrune, DEFAULT_RETENTION_DAYS } from './run-prune.js';

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
  await db.pool.query('TRUNCATE ingest_runs RESTART IDENTITY');
});

afterAll(async () => { await db?.stop(); });

async function seedAt(subId: string, ageDaysAgo: number): Promise<void> {
  await db.pool.query(
    `INSERT INTO observations
       (sub_id, species_code, lat, lng, obs_dt, loc_id, loc_name, how_many, is_notable)
     VALUES ($1, 'vermfly', 31.72, -110.88, now() - ($2 || ' days')::interval,
             $3, 'Loc', 1, false)`,
    [subId, String(ageDaysAgo), `L-${subId}`]
  );
}

describe('runPrune', () => {
  it('deletes observations strictly older than the retention window and keeps rows inside it', async () => {
    await seedAt('OLD-30', 30);
    await seedAt('OLD-15', 15);
    // Boundary fixture: just inside the retention window. DELETE uses
    // `obs_dt < now() - retention` (strict inequality), so a row whose age is
    // marginally less than 14 days must be KEPT. Seeding at exactly 14.0d is
    // racy — `now()` advances between INSERT and DELETE, pushing a true-14d
    // row across the boundary — so we use 13.99d to make the kept-side of
    // the off-by-one boundary deterministic. A `<=` regression would
    // erroneously delete this row.
    await seedAt('BOUNDARY-INSIDE', 13.99);
    await seedAt('NEW-13', 13);
    await seedAt('NEW-1', 1);

    const summary = await runPrune({ pool: db.pool, retentionDays: 14 });

    expect(summary.status).toBe('success');
    expect(summary.deleted).toBe(2);
    expect(summary.retentionDays).toBe(14);

    const { rows } = await db.pool.query<{ sub_id: string }>(
      `SELECT sub_id FROM observations ORDER BY sub_id`
    );
    expect(rows.map(r => r.sub_id)).toEqual(['BOUNDARY-INSIDE', 'NEW-1', 'NEW-13']);
  });

  it('defaults retention to 14 days when no option is passed', async () => {
    await seedAt('OLD', 20);
    await seedAt('NEW', 7);
    const summary = await runPrune({ pool: db.pool });
    expect(summary.retentionDays).toBe(DEFAULT_RETENTION_DAYS);
    expect(summary.deleted).toBe(1);
  });

  it('records an ingest_runs row with kind=prune, status=success, and the deleted count in obs_fetched', async () => {
    await seedAt('OLD-1', 30);
    await seedAt('OLD-2', 21);
    await seedAt('NEW-1', 3);

    await runPrune({ pool: db.pool, retentionDays: 14 });

    const recent = await getRecentIngestRuns(db.pool, 5);
    expect(recent).toHaveLength(1);
    const run = recent[0]!;
    expect(run.kind).toBe('prune');
    expect(run.status).toBe('success');
    expect(run.obsFetched).toBe(2);
    expect(run.finishedAt).not.toBeNull();
  });

  it('advances pg_stat_user_tables.last_vacuum on the observations table', async () => {
    // Force a pre-existing last_vacuum so we can detect the runPrune-driven
    // advance rather than a NULL→non-NULL transition (which could be triggered
    // by autovacuum racing with the test).
    await db.pool.query('VACUUM observations');
    const before = await db.pool.query<{ last_vacuum: Date | null }>(
      `SELECT last_vacuum FROM pg_stat_user_tables WHERE relname = 'observations'`
    );
    const beforeTs = before.rows[0]?.last_vacuum ?? null;

    // Sleep a beat so the stats timestamp can advance with measurable
    // resolution (pg_stat timestamps are at-best millisecond-granular).
    await new Promise(r => setTimeout(r, 50));
    await seedAt('OLD', 30);
    await runPrune({ pool: db.pool, retentionDays: 14 });

    const after = await db.pool.query<{ last_vacuum: Date | null }>(
      `SELECT last_vacuum FROM pg_stat_user_tables WHERE relname = 'observations'`
    );
    const afterTs = after.rows[0]?.last_vacuum ?? null;
    expect(afterTs).not.toBeNull();
    if (beforeTs) {
      expect(afterTs!.getTime()).toBeGreaterThan(beforeTs.getTime());
    }
  });
});

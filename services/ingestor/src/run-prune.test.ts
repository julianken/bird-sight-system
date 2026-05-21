import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { startTestDb, type TestDb } from '@bird-watch/db-client/dist/test-helpers.js';
import { getRecentIngestRuns } from '@bird-watch/db-client';
import { runPrune, DEFAULT_RETENTION_DAYS } from './run-prune.js';
import type { ArchivableRow } from './archive/select-archivable.js';

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

/**
 * Stub archive callback for tests: captures the (utcDate, rowCount) pairs and
 * returns a fake gs:// path. Production wires `archiveAndUpload` (T4); the
 * runner contract is the same shape — `{ gcsPath, bytes }` resolved on
 * success, throw on failure.
 */
function makeStubArchive() {
  const calls: Array<{ utcDate: string; rowCount: number }> = [];
  const archiveDay = async (utcDate: string, rows: ArchivableRow[]) => {
    calls.push({ utcDate, rowCount: rows.length });
    return {
      gcsPath: `gs://test/observations/year=2026/month=05/day=${utcDate.slice(8)}.parquet`,
      bytes: 1,
    };
  };
  return { calls, archiveDay };
}

describe('runPrune', () => {
  it('deletes observations strictly older than the retention window and keeps rows inside it', async () => {
    await seedAt('OLD-30', 30);
    await seedAt('OLD-15', 15);
    await seedAt('NEW-13', 13);
    await seedAt('NEW-1', 1);

    const stub = makeStubArchive();
    const summary = await runPrune({ pool: db.pool, retentionDays: 14, archiveDay: stub.archiveDay });

    expect(summary.status).toBe('success');
    expect(summary.deleted).toBe(2);
    expect(summary.retentionDays).toBe(14);

    const { rows } = await db.pool.query<{ sub_id: string }>(
      `SELECT sub_id FROM observations ORDER BY sub_id`
    );
    expect(rows.map(r => r.sub_id)).toEqual(['NEW-1', 'NEW-13']);
  });

  it('defaults retention to 14 days when no option is passed', async () => {
    await seedAt('OLD', 20);
    await seedAt('NEW', 7);
    const stub = makeStubArchive();
    const summary = await runPrune({ pool: db.pool, archiveDay: stub.archiveDay });
    expect(summary.retentionDays).toBe(DEFAULT_RETENTION_DAYS);
    expect(summary.deleted).toBe(1);
  });

  it('records an ingest_runs row with kind=prune, status=success, and the deleted count in obs_fetched', async () => {
    await seedAt('OLD-1', 30);
    await seedAt('OLD-2', 21);
    await seedAt('NEW-1', 3);

    const stub = makeStubArchive();
    await runPrune({ pool: db.pool, retentionDays: 14, archiveDay: stub.archiveDay });

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
    const stub = makeStubArchive();
    await runPrune({ pool: db.pool, retentionDays: 14, archiveDay: stub.archiveDay });

    const after = await db.pool.query<{ last_vacuum: Date | null }>(
      `SELECT last_vacuum FROM pg_stat_user_tables WHERE relname = 'observations'`
    );
    const afterTs = after.rows[0]?.last_vacuum ?? null;
    expect(afterTs).not.toBeNull();
    if (beforeTs) {
      expect(afterTs!.getTime()).toBeGreaterThan(beforeTs.getTime());
    }
  });

  // ── Archive-then-delete contract (T2 §Step 7) ───────────────────────────
  // The next four tests assert the invariant added by the cold-storage
  // refactor: every day's rows are archived BEFORE the day is deleted, an
  // archive failure short-circuits the delete for that day, an empty table
  // is a clean no-op, and the partial-overlap day at the retention cutoff
  // is preserved (not wrongly wiped by a day-wide DELETE).

  it('archives the day before deleting it, never the other way', async () => {
    await seedAt('OLD-1', 30);
    const order: string[] = [];
    const archiveDay = async (utcDate: string, _rows: ArchivableRow[]) => {
      // Confirm the rows still exist in the DB at archive time
      const { rows: present } = await db.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM observations
           WHERE obs_dt >= ($1::date)::timestamptz
             AND obs_dt <  (($1::date) + INTERVAL '1 day')::timestamptz`,
        [utcDate]
      );
      order.push(`archive:${present[0]?.count}`);
      return { gcsPath: 'gs://test/x.parquet', bytes: 1 };
    };
    await runPrune({ pool: db.pool, retentionDays: 14, archiveDay });
    expect(order[0]).toBe('archive:1'); // row visible at archive time
    const { rowCount } = await db.pool.query('SELECT 1 FROM observations');
    expect(rowCount).toBe(0); // and gone after
  });

  it('does NOT delete the day if archive throws', async () => {
    await seedAt('OLD-1', 30);
    const archiveDay = async () => { throw new Error('GCS unreachable'); };
    const summary = await runPrune({ pool: db.pool, retentionDays: 14, archiveDay });
    expect(summary.status).toBe('failure');
    expect(summary.deleted).toBe(0);
    const { rowCount } = await db.pool.query('SELECT 1 FROM observations');
    expect(rowCount).toBe(1);
  });

  it('handles an empty table as a clean no-op', async () => {
    const archiveDay = async () => ({ gcsPath: 'unused', bytes: 0 });
    const summary = await runPrune({ pool: db.pool, retentionDays: 14, archiveDay });
    expect(summary.status).toBe('success');
    expect(summary.archived).toBe(0);
    expect(summary.deleted).toBe(0);
  });

  it('emits a bird_ingest_archived log line per archived day with the T8-coupled fields', async () => {
    // T8's archive-vs-delete parity dashboard widget depends on the
    // shape of this log entry: rowCount and deletedCount MUST appear
    // in the SAME entry (so a divergent run is one query, not a join),
    // and gcsPath + bytesUploaded MUST be present (so the bytes-uploaded
    // and rows-archived widgets extract from the same source). If a
    // future refactor renames `bird_ingest_archived` or drops a field,
    // this test fails before the dashboard silently goes blank.
    await seedAt('OLD-1', 30);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const archiveDay = async () => ({
        gcsPath: 'gs://bird-maps-prod-obs-archive/observations/year=2026/month=04/day=21.parquet',
        bytes: 4242,
      });
      await runPrune({ pool: db.pool, retentionDays: 14, archiveDay });

      const lines = logSpy.mock.calls
        .map(c => c[0])
        .filter((s): s is string => typeof s === 'string')
        .map(s => { try { return JSON.parse(s); } catch { return null; } })
        .filter((p: unknown): p is Record<string, unknown> => !!p && typeof p === 'object');

      const archived = lines.filter(l => l.message === 'bird_ingest_archived');
      expect(archived).toHaveLength(1);
      const entry = archived[0]!;
      expect(entry).toMatchObject({
        severity: 'INFO',
        message: 'bird_ingest_archived',
        rowCount: 1,
        deletedCount: 1,
        gcsPath: 'gs://bird-maps-prod-obs-archive/observations/year=2026/month=04/day=21.parquet',
        bytesUploaded: 4242,
      });
      expect(typeof entry.date).toBe('string');
      expect(entry.date as string).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('skips the partial-overlap UTC day at the retention cutoff', async () => {
    // Bug shape (pre-fix): the day-enumeration query selected any UTC day
    // with AT LEAST ONE row older than `now() - retention`. The per-day
    // DELETE then wiped the FULL UTC day [D 00:00Z, D+1 00:00Z), including
    // rows on D that were still inside the retention window. Net effect:
    // the partial-overlap day's recent rows were wrongly archived AND
    // deleted on the same run, shortening effective retention by up to 24h.
    //
    // Fix (post): bound by `date_trunc('day', now() - retention)` instead
    // of `now() - retention`. Only fully-closed UTC days are enumerated.
    //
    // To exercise the bug we need two rows on the SAME UTC day: one older
    // than cutoff (would have triggered the old enumeration), one newer
    // than cutoff (would have been wrongly deleted by the day-wide DELETE).
    // We anchor both inserts relative to `date_trunc('day', now() - INTERVAL '14 days')`
    // (the cutoff day's start in UTC) so we don't depend on CI-time-of-day.
    await db.pool.query(
      `INSERT INTO observations (sub_id, species_code, lat, lng, obs_dt, loc_id, how_many, is_notable)
       VALUES
         ('BOUNDARY-OLD', 'vermfly', 31.7, -110.9,
           date_trunc('day', now() - INTERVAL '14 days') - INTERVAL '1 hour',
           'L1', 1, false),
         ('BOUNDARY-NEW', 'vermfly', 31.7, -110.9,
           date_trunc('day', now() - INTERVAL '14 days') + INTERVAL '1 hour',
           'L1', 1, false)`
    );
    const archiveDay = async () => ({ gcsPath: 'gs://test/x.parquet', bytes: 1 });
    const summary = await runPrune({ pool: db.pool, retentionDays: 14, archiveDay });
    // The cutoff day itself is now skipped; the prior day (where the OLD
    // row lives) IS fully past the cutoff and IS archived+deleted.
    // BOUNDARY-OLD: on day D-1, fully past cutoff — archived+deleted.
    // BOUNDARY-NEW: on day D (the partial-overlap day) — preserved.
    const { rows: remaining } = await db.pool.query<{ sub_id: string }>(
      `SELECT sub_id FROM observations ORDER BY sub_id`
    );
    expect(remaining.map(r => r.sub_id)).toEqual(['BOUNDARY-NEW']);
    expect(summary.deleted).toBe(1);
  });
});

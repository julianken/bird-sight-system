import {
  startIngestRun, finishIngestRun,
  type Pool,
} from '@bird-watch/db-client';
import { selectArchivable, type ArchivableRow } from '../archive/select-archivable.js';

export interface RunPruneOptions {
  pool: Pool;
  /**
   * Rolling-window size in days. Rows with `obs_dt < now() - retentionDays`
   * are first archived to GCS, then deleted. Default 14 — matches the
   * steady-state Cloud SQL runway (see docs/analyses/2026-05-14-process-
   * scale-options/phase-4/analysis-report.md Finding 8).
   */
  retentionDays?: number;
  /**
   * Per-day archive callback. Production wires the Parquet+GCS uploader
   * (T4); tests pass a stub that captures the rows in memory. The archive
   * MUST resolve successfully before the day's rows are deleted — any
   * thrown error short-circuits the delete for that day and the runner
   * records `status: 'failure'`.
   */
  archiveDay: (utcDate: string, rows: ArchivableRow[]) => Promise<{ gcsPath: string; bytes: number }>;
}

export interface RunPruneSummary {
  status: 'success' | 'failure';
  /** Number of `observations` rows deleted by the per-day DELETE loop. */
  deleted: number;
  /** Number of `observations` rows successfully archived to GCS. */
  archived: number;
  /** Number of distinct UTC dates that had at least one row archived+deleted. */
  archivedDays: number;
  /** gs://… paths of every Parquet object successfully written this run. */
  gcsPaths: string[];
  /** The retentionDays value actually used (resolved default). */
  retentionDays: number;
  error?: string;
}

export const DEFAULT_RETENTION_DAYS = 14;

/**
 * Nightly archive-then-prune job.
 *
 * For each UTC date that falls fully outside the retention window:
 *   1. SELECT the day's rows (LEFT JOIN species_meta) via selectArchivable.
 *   2. archiveDay(utcDate, rows) → writes Parquet to GCS (T4 wiring).
 *   3. DELETE the day's rows from observations.
 *
 * After all days are processed, VACUUM (ANALYZE) observations recovers
 * GIST/B-tree dead-tuple bloat.
 *
 * The archive-then-delete pair is per-day and synchronous: if step 2 throws
 * for day D, step 3 for day D does NOT run, and the runner returns
 * status: 'failure' with the count of days that DID succeed in archived/
 * archivedDays. Prior days that succeeded keep their archive + delete —
 * partial progress is preserved.
 *
 * VACUUM must run outside any transaction (Postgres rejects VACUUM inside
 * BEGIN/COMMIT). `pool.query('VACUUM ...')` checks out a connection and runs
 * the statement at the connection level — no implicit transaction is opened
 * for non-DML autocommit-safe statements via `pg`. We deliberately invoke
 * VACUUM *after* the per-day DELETEs commit so the dead tuples are visible.
 */
export async function runPrune(o: RunPruneOptions): Promise<RunPruneSummary> {
  const retentionDays = o.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const runId = await startIngestRun(o.pool, 'prune');

  let deleted = 0;
  let archived = 0;
  const gcsPaths: string[] = [];
  const archivedDays = new Set<string>();

  try {
    // Enumerate the UTC dates that need archiving: every UTC day whose
    // ENTIRE 24-hour range is older than the cutoff. We bound by
    // `date_trunc('day', now() - retention)` rather than `now() - retention`
    // so a partial-overlap day (e.g. cutoff = 03:00Z falling inside day D)
    // is skipped and rolls into tomorrow's run. Invariant: the SELECT/DELETE
    // below archive a FULL UTC day [D 00:00Z, D+1 00:00Z), so every row
    // archived must be < the cutoff — only fully-closed days satisfy that.
    const { rows: dayRows } = await o.pool.query<{ utc_date: string }>(
      `SELECT DISTINCT (obs_dt AT TIME ZONE 'UTC')::date::text AS utc_date
         FROM observations
        WHERE obs_dt < date_trunc('day', now() - ($1 || ' days')::interval)
        ORDER BY utc_date`,
      [String(retentionDays)]
    );

    for (const { utc_date } of dayRows) {
      const rows = await selectArchivable({ pool: o.pool, utcDate: utc_date });
      if (rows.length === 0) continue;

      const { gcsPath, bytes } = await o.archiveDay(utc_date, rows);
      gcsPaths.push(gcsPath);
      archived += rows.length;
      archivedDays.add(utc_date);

      const { rowCount } = await o.pool.query(
        `DELETE FROM observations
           WHERE obs_dt >= ($1::date)::timestamptz
             AND obs_dt <  (($1::date) + INTERVAL '1 day')::timestamptz`,
        [utc_date]
      );
      deleted += rowCount ?? 0;

      // Per-day structured log feeding the T8 log-based metrics:
      // bird-ingest-archived-row-count, bird-ingest-archived-bytes-uploaded,
      // bird-ingest-archived-deleted-count. The archive-vs-delete parity
      // widget reads `rowCount` and `deletedCount` from the SAME log entry —
      // they MUST appear together so a divergent run is one query, not a join.
      console.log(JSON.stringify({
        severity: 'INFO',
        message: 'bird_ingest_archived',
        date: utc_date,
        rowCount: rows.length,
        deletedCount: rowCount ?? 0,
        gcsPath,
        bytesUploaded: bytes,
      }));
    }

    await o.pool.query('VACUUM (ANALYZE) observations');
    await finishIngestRun(o.pool, runId, {
      status: 'success', obsFetched: deleted, obsUpserted: 0,
    });
    return {
      status: 'success', deleted, archived,
      archivedDays: archivedDays.size, gcsPaths, retentionDays,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishIngestRun(o.pool, runId, { status: 'failure', errorMessage: msg });
    return {
      status: 'failure', deleted, archived,
      archivedDays: archivedDays.size, gcsPaths, retentionDays, error: msg,
    };
  }
}

import {
  startIngestRun, finishIngestRun,
  type Pool,
} from '@bird-watch/db-client';

export interface RunPruneOptions {
  pool: Pool;
  /**
   * Rolling-window size in days. Rows with `obs_dt < now() - retentionDays`
   * are deleted. Default 14 — matches the steady-state Neon Launch tier
   * runway (~3 GB) discussed in
   * `docs/analyses/2026-05-14-process-scale-options/phase-4/analysis-report.md`
   * Finding 8 / Recommendation 2A-lean.
   */
  retentionDays?: number;
}

export interface RunPruneSummary {
  status: 'success' | 'failure';
  /** Number of `observations` rows deleted by the prune DELETE. */
  deleted: number;
  /** The retentionDays value actually used (resolved default). */
  retentionDays: number;
  error?: string;
}

export const DEFAULT_RETENTION_DAYS = 14;

/**
 * Nightly observations-prune job. Deletes rows older than the rolling window,
 * then runs `VACUUM (ANALYZE) observations` to recover GIST-index dead-tuple
 * bloat on the `obs_dt`/geometry indexes. The DELETE+VACUUM pair is the entire
 * contract — no eBird calls, no upserts.
 *
 * Records into `ingest_runs` with `kind='prune'` and the deleted row count in
 * `obs_fetched` (column reuse — `obs_fetched` is just an integer slot, and a
 * separate `obs_pruned` column would require a migration for one metric).
 *
 * VACUUM must run outside any transaction (Postgres rejects VACUUM inside
 * BEGIN/COMMIT). `pool.query('VACUUM ...')` checks out a connection and runs
 * the statement at the connection level — no implicit transaction is opened
 * for non-DML autocommit-safe statements via `pg`. We deliberately invoke
 * VACUUM *after* the DELETE commits so the dead tuples are visible to it.
 */
export async function runPrune(o: RunPruneOptions): Promise<RunPruneSummary> {
  const retentionDays = o.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const runId = await startIngestRun(o.pool, 'prune');
  try {
    const cutoffInterval = `${retentionDays} days`;
    const { rowCount } = await o.pool.query(
      `DELETE FROM observations WHERE obs_dt < now() - $1::interval`,
      [cutoffInterval]
    );
    const deleted = rowCount ?? 0;
    // VACUUM ANALYZE must be its own statement, outside any explicit
    // transaction. Reclaims dead-tuple space and refreshes planner stats so
    // the GIST geometry index + the obs_dt index stay healthy under the
    // steady-state churn of a 14-day rolling window.
    await o.pool.query('VACUUM (ANALYZE) observations');
    await finishIngestRun(o.pool, runId, {
      status: 'success', obsFetched: deleted, obsUpserted: 0,
    });
    return { status: 'success', deleted, retentionDays };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishIngestRun(o.pool, runId, { status: 'failure', errorMessage: msg });
    return { status: 'failure', deleted: 0, retentionDays, error: msg };
  }
}

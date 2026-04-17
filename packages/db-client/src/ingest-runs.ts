import type { Pool } from './pool.js';
import type { IngestRun, IngestRunTerminalStatus } from '@bird-watch/shared-types';

export type IngestKind = IngestRun['kind'];
export type IngestStatus = IngestRun['status'];

export async function startIngestRun(pool: Pool, kind: IngestKind): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO ingest_runs (kind, started_at, status)
     VALUES ($1, now(), 'running') RETURNING id`,
    [kind]
  );
  return rows[0]!.id;
}

export interface FinishOptions {
  status: IngestRunTerminalStatus;
  obsFetched?: number;
  obsUpserted?: number;
  errorMessage?: string;
}

export async function finishIngestRun(
  pool: Pool,
  id: number,
  opts: FinishOptions
): Promise<void> {
  await pool.query(
    `UPDATE ingest_runs
     SET finished_at = now(),
         status = $2,
         obs_fetched = $3,
         obs_upserted = $4,
         error_message = $5
     WHERE id = $1`,
    [
      id, opts.status,
      opts.obsFetched ?? null,
      opts.obsUpserted ?? null,
      opts.errorMessage ?? null,
    ]
  );
}

export async function getRecentIngestRuns(pool: Pool, limit: number): Promise<IngestRun[]> {
  const { rows } = await pool.query<{
    id: number;
    kind: string;
    started_at: Date;
    finished_at: Date | null;
    obs_fetched: number | null;
    obs_upserted: number | null;
    status: string;
    error_message: string | null;
  }>(
    `SELECT id, kind, started_at, finished_at, obs_fetched, obs_upserted, status, error_message
     FROM ingest_runs
     ORDER BY started_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows.map(r => ({
    id: r.id,
    kind: r.kind as IngestKind,
    startedAt: r.started_at.toISOString(),
    finishedAt: r.finished_at ? r.finished_at.toISOString() : null,
    obsFetched: r.obs_fetched,
    obsUpserted: r.obs_upserted,
    status: r.status as IngestStatus,
    errorMessage: r.error_message,
  }));
}

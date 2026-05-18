import type { Pool } from '@bird-watch/db-client';

/**
 * Dual-write pool wrapper for the Neon → Cloud SQL migration.
 *
 * Every write SQL statement (INSERT / UPDATE / DELETE / TRUNCATE / MERGE)
 * is sent to BOTH the primary (Neon) and secondary (Cloud SQL) pools.
 * Reads go only to the primary — there is no consistency model that lets
 * us read from either side until the migration cuts over.
 *
 * Failure handling per Julian's brief:
 *   - PRIMARY error → propagate (caller sees same error as today).
 *   - SECONDARY error → log distinctly and continue. Primary is source of
 *     truth; operator can re-run the override if drift surfaces later.
 *
 * The admin-api ships its own copy of this primitive (instead of consuming
 * one from @bird-watch/db-client) so the admin-api dual-write PR is fully
 * independent of the parallel ingestor PR shipping the same pattern.
 */

export interface DualWritePoolOptions {
  primary: Pool;
  secondary: Pool;
  /** Free-form label used in the log line so an operator can tell which
   *  call site emitted a secondary failure (e.g. "silhouette"). */
  surface: string;
}

const WRITE_SQL = /^\s*(?:--[^\n]*\n\s*)*(?:INSERT|UPDATE|DELETE|TRUNCATE|MERGE)\b/i;

/** True iff the SQL begins (after optional leading line-comments) with a
 *  row-mutating verb. SELECT, WITH-CTE-with-SELECT, BEGIN/COMMIT, VACUUM,
 *  and SET all return false. */
export function isWriteSql(sql: string): boolean {
  return WRITE_SQL.test(sql);
}

/**
 * Minimal pg.Pool shape: query() + end(). Matches the subset that
 * `services/admin-api/src/app.ts` uses today.
 */
export interface DualPool {
  query<R = unknown>(sql: string, params?: readonly unknown[]): Promise<{ rows: R[]; rowCount: number }>;
  end(): Promise<void>;
}

export function createDualWritePool(opts: DualWritePoolOptions): DualPool {
  const { primary, secondary, surface } = opts;

  return {
    async query<R = unknown>(sql: string, params?: readonly unknown[]) {
      // Order matters: primary first. If it throws we propagate; the
      // secondary is never contacted — keeps the failure-mode identical
      // to the pre-migration single-write path.
      const raw = await primary.query(sql, params as unknown[]);
      const primaryResult = {
        rows: raw.rows as unknown as R[],
        rowCount: raw.rowCount ?? 0,
      };

      if (!isWriteSql(sql)) {
        return primaryResult;
      }

      try {
        await secondary.query(sql, params as unknown[]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Single line, parseable: log-greps for `dual_write_secondary_failed`
        // surface this for the migration runbook.
        console.error(`dual_write_secondary_failed surface=${surface} err=${msg}`);
      }
      return primaryResult;
    },

    async end() {
      // Close both. If secondary close throws, log it — but still close
      // primary too (and propagate the *primary* failure if any).
      const results = await Promise.allSettled([primary.end(), secondary.end()]);
      for (const r of results) {
        if (r.status === 'rejected') {
          console.error(`dual_write_secondary_failed surface=${surface} err=${r.reason}`);
        }
      }
    },
  };
}

import type { Pool } from './pool.js';

/**
 * Dual-write pool wrapper.
 *
 * Purpose: during the Neon→Cloud SQL migration (T3 → T4 in
 * docs/plans/2026-05-17-cloud-sql-migration.md), every ingester write must
 * land in BOTH databases so that the eventual read-cutover finds Cloud SQL
 * already in sync. We do this at the app layer rather than via logical
 * replication because (a) the ingester upserts are idempotent
 * (`ON CONFLICT ... DO UPDATE`) and (b) we avoid standing up a separate
 * replication operator and its failure modes.
 *
 * Contract:
 *   - SELECT / WITH / VACUUM and other non-row-write SQL: routed to the
 *     PRIMARY pool only. The secondary is fanned out only for actual
 *     mutations to keep read load on Neon unchanged and to avoid spurious
 *     divergence (a SELECT-then-write pattern reading from secondary would
 *     drift if the two backends had divergent state during the migration).
 *   - INSERT / UPDATE / DELETE / TRUNCATE / MERGE: executed on PRIMARY
 *     first (its error throws as usual), then on SECONDARY. If the
 *     secondary call throws, the error is logged with the marker
 *     `dual_write_secondary_failed` and swallowed — the next 30-minute tick
 *     will self-heal because the upsert is idempotent.
 *   - No retry loop in this layer. The next tick is the retry budget.
 *   - The `kind` field on the options tags log lines so an operator
 *     filtering Cloud Logging can attribute drift to a specific job.
 *
 * Why a regex on SQL text rather than a typed write-API: the existing
 * handlers call `pool.query(text, params)` directly with hand-written SQL
 * (see services/ingestor/src/run-*.ts and packages/db-client/src/*.ts).
 * Adding a write-only method would require refactoring 7 handlers and
 * the db-client layer, which is out of scope per the constraint that
 * upsert shape and business logic are untouched. The regex is conservative
 * — false-negative on writes would cause silent secondary drift, so we
 * pattern-match on the leading SQL keyword after stripping comments and
 * whitespace.
 */

const WRITE_VERB = /^(insert|update|delete|truncate|merge)\b/i;

/**
 * Strip leading line/block comments + whitespace, then check whether the
 * first SQL token is a write verb.
 *
 * Block comments are nested per Postgres semantics
 * (https://www.postgresql.org/docs/current/sql-syntax-lexical.html#SQL-SYNTAX-COMMENTS)
 * but we don't see them in this codebase — only the `-- Up Migration` /
 * `-- Down Migration` line comments and inline `--` notes. Handle both
 * styles defensively rather than expanding scope.
 */
export function isWriteSql(sql: string): boolean {
  let s = sql;
  // Strip leading line comments and whitespace repeatedly.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const trimmed = s.replace(/^\s+/, '');
    if (trimmed.startsWith('--')) {
      const nl = trimmed.indexOf('\n');
      if (nl === -1) return false;
      s = trimmed.slice(nl + 1);
      continue;
    }
    if (trimmed.startsWith('/*')) {
      const end = trimmed.indexOf('*/');
      if (end === -1) return false;
      s = trimmed.slice(end + 2);
      continue;
    }
    s = trimmed;
    break;
  }
  return WRITE_VERB.test(s);
}

export interface DualWritePoolOptions {
  primary: Pool;
  secondary: Pool;
  /** Tagged into the `dual_write_secondary_failed` log line for triage. */
  kind?: string;
}

/**
 * Returns a Pool-shaped wrapper. The shape is structurally compatible with
 * `pg.Pool` for the methods the ingester actually uses (`.query()`, `.end()`).
 * Other pg.Pool methods (`connect`, event emitter API) are not used by the
 * ingestor or db-client and are not proxied — see grep for `pool.connect`
 * in the codebase (returns nothing).
 */
export function createDualWritePool(opts: DualWritePoolOptions): Pool {
  const { primary, secondary, kind } = opts;

  const dual = {
    async query(...args: unknown[]): Promise<unknown> {
      // pg.Pool.query has multiple overloads; the ingester always passes
      // (text, params?). We forward the args verbatim so the type-system
      // contract at the call site is unchanged.
      const sql = typeof args[0] === 'string'
        ? args[0]
        : (args[0] as { text?: string } | undefined)?.text ?? '';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const primaryResult = await (primary.query as any)(...args);

      if (isWriteSql(sql)) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (secondary.query as any)(...args);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // Distinct marker per the migration plan — Cloud Logging filter:
          //   resource.type="cloud_run_job" AND textPayload:"dual_write_secondary_failed"
          // Per-call kind tag distinguishes which scheduled job drifted.
          console.error(
            `dual_write_secondary_failed kind=${kind ?? 'unknown'} err=${msg}`
          );
        }
      }
      return primaryResult;
    },
    async end(): Promise<void> {
      // Close both pools. We await both even if one rejects so the second
      // pool's sockets don't leak; the AggregateError surfaces both faults
      // to the caller (the CLI's `finally` block).
      const results = await Promise.allSettled([primary.end(), secondary.end()]);
      const failures = results
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map(r => r.reason);
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, 'dual pool end failures');
    },
  };

  // We intentionally only model `.query` + `.end` — see file header.
  return dual as unknown as Pool;
}

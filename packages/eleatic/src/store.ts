import Database from 'better-sqlite3';
import { migrate } from './schema.js';
import { toJsonOrNull, toTextOrNull } from './serde.js';
import type { EvalRunRecord, EvalRowRecord, EvalAdjudicationRecord } from './types.js';

/**
 * The eleatic write store: a thin, prepared-statement layer over the generic
 * three-table SQLite schema. Open with `openStore(path?)` — pass `':memory:'`
 * in tests (WAL is a no-op there).
 *
 * BINDING RULE (load-bearing under exactOptionalPropertyTypes): every method
 * builds an EXPLICIT all-columns bind object — one key per @param in the SQL,
 * every nullable value pushed through toJsonOrNull/toTextOrNull first — and
 * passes THAT to `.run(...)`. We never `.run(record)` directly: an omitted
 * optional record field is an ABSENT key (not `undefined`) under
 * exactOptionalPropertyTypes, and better-sqlite3 throws
 * `RangeError: Missing named parameter "@baseline"` when a @param has no key in
 * the bound object. Constructing the bind object guarantees every placeholder
 * resolves to an explicit value-or-NULL.
 */
export class EleaticStore {
  /** The raw better-sqlite3 handle. Read-only escape hatch for E2's reader + tests. */
  readonly db: Database.Database;

  private readonly insertRunStmt: Database.Statement;
  private readonly insertRowStmt: Database.Statement;
  private readonly upsertAdjStmt: Database.Statement;
  private readonly finalizeRunStmt: Database.Statement;
  private readonly recordRowsTxn: (rows: EvalRowRecord[]) => void;

  constructor(db: Database.Database) {
    this.db = db;

    this.insertRunStmt = db.prepare(
      `INSERT INTO eval_run
         (id, label, baseline, config_json, started_at, row_count, metrics_json)
       VALUES (@id, @label, @baseline, @config_json, @started_at, @row_count, @metrics_json)`,
    );
    this.insertRowStmt = db.prepare(
      `INSERT INTO eval_row
         (run_id, row_key, label, image_url, content_hash,
          output_json, expected_json, scores_json, metadata_json)
       VALUES (@run_id, @row_key, @label, @image_url, @content_hash,
          @output_json, @expected_json, @scores_json, @metadata_json)`,
    );
    this.upsertAdjStmt = db.prepare(
      `INSERT INTO eval_adjudication
         (row_key, verdict, against_hash, note, decided_at)
       VALUES (@row_key, @verdict, @against_hash, @note, @decided_at)
       ON CONFLICT(row_key) DO UPDATE SET
         verdict=excluded.verdict,
         against_hash=excluded.against_hash,
         note=excluded.note,
         decided_at=excluded.decided_at`,
    );
    this.finalizeRunStmt = db.prepare(
      `UPDATE eval_run SET row_count=@row_count, metrics_json=@metrics_json WHERE id=@id`,
    );

    // A single transaction wraps the whole batch so a mid-array throw (e.g. an
    // orphan run_id FK violation) rolls every row back — all-or-nothing.
    this.recordRowsTxn = db.transaction((rows: EvalRowRecord[]) => {
      for (const row of rows) this.recordRow(row);
    });
  }

  /** INSERT a run. config/metrics -> JSON-or-NULL; baseline/rowCount nullable. */
  recordRun(run: EvalRunRecord): void {
    this.insertRunStmt.run({
      id: run.id,
      label: toTextOrNull(run.label),
      baseline: toTextOrNull(run.baseline),
      config_json: toJsonOrNull(run.config),
      started_at: toTextOrNull(run.startedAt),
      row_count: run.rowCount ?? null,
      metrics_json: toJsonOrNull(run.metrics),
    });
  }

  /** INSERT one evaluated item. output/expected/scores/metadata -> JSON-or-NULL. */
  recordRow(row: EvalRowRecord): void {
    this.insertRowStmt.run({
      run_id: row.runId,
      row_key: row.rowKey,
      label: toTextOrNull(row.label),
      image_url: toTextOrNull(row.imageUrl),
      content_hash: toTextOrNull(row.contentHash),
      output_json: toJsonOrNull(row.output),
      expected_json: toJsonOrNull(row.expected),
      scores_json: toJsonOrNull(row.scores),
      metadata_json: toJsonOrNull(row.metadata),
    });
  }

  /** Bulk-insert rows in a single transaction (150–1000-row scale); all-or-nothing. */
  recordRows(rows: EvalRowRecord[]): void {
    this.recordRowsTxn(rows);
  }

  /** Upsert a human verdict keyed on the item (row_key); no audit history. */
  recordAdjudication(adj: EvalAdjudicationRecord): void {
    this.upsertAdjStmt.run({
      row_key: adj.rowKey,
      verdict: toTextOrNull(adj.verdict),
      against_hash: toTextOrNull(adj.againstHash),
      note: toTextOrNull(adj.note),
      decided_at: toTextOrNull(adj.decidedAt),
    });
  }

  /** Patch a run's aggregates after all rows land (runner computes them late). */
  finalizeRun(runId: string, patch: { rowCount?: number; metrics?: Record<string, number> }): void {
    this.finalizeRunStmt.run({
      id: runId,
      row_count: patch.rowCount ?? null,
      metrics_json: toJsonOrNull(patch.metrics),
    });
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Open (or create) an eleatic store at `path`, applying the schema + pragmas.
 * Defaults to `':memory:'` so a forgotten path can never silently write a stray
 * on-disk file in a test.
 */
export function openStore(path: string = ':memory:'): EleaticStore {
  const db = new Database(path);
  migrate(db);
  return new EleaticStore(db);
}

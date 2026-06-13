import type Database from 'better-sqlite3';

/**
 * The eleatic store's generic three-table schema.
 *
 * Deliberately DOMAIN-AGNOSTIC: no photo-judge columns, no fixed
 * agreement/falseKeep metrics. Every domain concept lives inside the `*_json`
 * blob columns. A consumer's "agreement >= 0.90" gate is a policy applied over a
 * named entry in `metrics_json`, not a schema column — which is what lets the
 * package later `git mv` to its own repo and serve any eval domain.
 *
 *   eval_run          — one row per eval run; `metrics_json` holds arbitrary
 *                       {name:number} aggregates.
 *   eval_row          — one row per item per run, keyed (run_id, row_key).
 *                       `output_json`/`expected_json` are OPAQUE — pretty-printed
 *                       in drill-down, never destructured by the store.
 *   eval_adjudication — a human verdict keyed on the ITEM (row_key), independent
 *                       of any run; upsert (no audit history).
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS eval_run (
  id           TEXT PRIMARY KEY,
  label        TEXT,
  baseline     TEXT,
  config_json  TEXT,
  started_at   TEXT,
  row_count    INTEGER,
  metrics_json TEXT
);
CREATE TABLE IF NOT EXISTS eval_row (
  run_id        TEXT NOT NULL REFERENCES eval_run(id) ON DELETE CASCADE,
  row_key       TEXT NOT NULL,
  label         TEXT,
  image_url     TEXT,
  content_hash  TEXT,
  output_json   TEXT,
  expected_json TEXT,
  scores_json   TEXT,
  metadata_json TEXT,
  PRIMARY KEY (run_id, row_key)
);
CREATE TABLE IF NOT EXISTS eval_adjudication (
  row_key      TEXT PRIMARY KEY,
  verdict      TEXT,
  against_hash TEXT,
  note         TEXT,
  decided_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_eval_row_run     ON eval_row(run_id);
CREATE INDEX IF NOT EXISTS idx_eval_row_key     ON eval_row(row_key);
CREATE INDEX IF NOT EXISTS idx_eval_run_started ON eval_run(started_at DESC);
`;

/**
 * Apply the schema and connection pragmas to an open database.
 *
 * `foreign_keys = ON` is load-bearing: it is what makes the eval_run -> eval_row
 * ON DELETE CASCADE fire and what turns an orphan-run_id insert into a throwing
 * FK violation (the store's bulk-insert rollback guard relies on that). WAL is
 * enabled for the on-disk case so a reader can read while the runner writes; it
 * is a no-op on `:memory:`. Idempotent via CREATE ... IF NOT EXISTS.
 */
export function migrate(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
}

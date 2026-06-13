import Database from 'better-sqlite3';

/** Default on-disk path for the review store (gitignored). */
export const DEFAULT_DB_PATH = './review.sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS photo_current (
  species_code TEXT PRIMARY KEY,
  com_name     TEXT,
  sci_name     TEXT,
  family       TEXT,
  url          TEXT,
  attribution  TEXT,
  license      TEXT,
  content_hash TEXT,
  -- AI-scoring-pass flag: 0 = not yet AI-scored, 1 = scored. Tracks the token
  -- cost of the \`score\` workflow (Part B); the human approve/deny decision
  -- still lives in photo_decision. \`sync\` (re)inserts rows with reviewed=0;
  -- re-running \`sync\` after new photos land re-surfaces them as reviewed=0.
  reviewed     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS photo_score (
  id                INTEGER PRIMARY KEY,
  species_code      TEXT,
  role              TEXT,           -- 'current' | 'candidate'
  candidate_inat_id INTEGER,
  content_hash      TEXT,
  overall           REAL,           -- composite (ADVISORY ranking, NOT the gate)
  verdict           TEXT,           -- derived from overall (ADVISORY)
  criteria_json     TEXT,
  flags_json        TEXT,
  -- #969 Opus field-mark judge: the GATE is \`keep\` (1 = keep as the species'
  -- guide photo, 0 = needs replacement), NOT overall < threshold. quality_score
  -- is the judge's own 0–100 estimate; field_marks is the JSON array of the
  -- diagnostic marks it named.
  keep              INTEGER,
  quality_score     REAL,
  field_marks       TEXT,
  rationale         TEXT,
  rubric_version    TEXT,
  scored_at         TEXT
);

CREATE TABLE IF NOT EXISTS photo_candidate (
  id           INTEGER PRIMARY KEY,
  species_code TEXT,
  inat_id      INTEGER,
  photo_url    TEXT,
  thumb_path   TEXT,
  attribution  TEXT,
  license      TEXT,
  excluded     INTEGER DEFAULT 0,
  source_round INTEGER
);

CREATE TABLE IF NOT EXISTS photo_decision (
  species_code        TEXT PRIMARY KEY,
  action              TEXT,         -- 'approve' | 'keep' | 'deny' | 'pending'
  chosen_candidate_id INTEGER,
  deny_reason         TEXT,
  deny_tags_json      TEXT,
  decided_at          TEXT,
  applied             INTEGER DEFAULT 0,
  applied_at          TEXT,
  -- Re-source queue flag: 0 = no alternate needed, 1 = a deny exhausted the
  -- pre-scored alternate pool and an additional source/score round is queued.
  -- denyAndAdvance (Slice 4b data layer) sets this when no scored alternate
  -- remains; POST /api/deny surfaces it as resourceQueued. Per-species deny
  -- state — lives here alongside deny_reason/deny_tags_json/action, NOT on
  -- photo_current.
  resource_requested  INTEGER NOT NULL DEFAULT 0
);

-- Operator override for the pending-swaps screen (swap-review v2). One row per
-- species the curator has explicitly picked for. chosen_inat_id NULL is an
-- EXPLICIT "no swap" (distinct from no row = "fall back to the auto gate"); a
-- non-null id names the candidate the operator promoted over the auto pick.
-- selectSwaps reads this; POST /api/select-swap upserts/clears it.
CREATE TABLE IF NOT EXISTS swap_selection (
  species_code   TEXT PRIMARY KEY,
  chosen_inat_id INTEGER,            -- NULL = explicit "no swap"
  decided_at     TEXT
);

-- Per-(species, source) sourcing ledger (#974 skim-the-bottom loop). One row
-- per species per image source the curator has searched, so a future
-- source-prepare under the same --source can SKIP a species already searched
-- under that source (no re-picking the same images) while a DIFFERENT source can
-- still retry it. outcome in 'searched' (sourced, not yet committed) /
-- 'better-found' (a committed candidate cleared the Δ>=20 gate) / 'exhausted'
-- (searched, nothing better — stays needs-swap but future same-source sourcing
-- skips it) / 'applied' (a swap was pushed to prod). best_score is the best
-- non-duplicate candidate's quality_score at commit/apply time. PK is the
-- (species_code, source) pair so re-recording a search upserts in place.
CREATE TABLE IF NOT EXISTS source_attempt (
  species_code     TEXT NOT NULL,
  source           TEXT NOT NULL DEFAULT 'inat',
  attempted_at     TEXT NOT NULL,
  candidates_found INTEGER,
  best_score       INTEGER,
  outcome          TEXT,
  PRIMARY KEY (species_code, source)
);

-- NOTE: the local eval store (the #1094 \`eval_run\` + \`eval_result\` tables) was
-- retired in E8 (#1151) once photo-curation's eval write/read moved onto
-- @bird-watch/eleatic. The eleatic \`eval.sqlite\` (opened via the eval adapter,
-- src/eval/eleatic-adapter.ts) is now the SOLE eval store; this review store no
-- longer carries eval tables.

-- One report per (subject, content_hash): re-scoring an unchanged image is a
-- no-op the orchestrator can detect before calling the judge.
CREATE UNIQUE INDEX IF NOT EXISTS idx_photo_score_subject
  ON photo_score (species_code, role, content_hash);

-- Dedupe candidates per species + round.
CREATE UNIQUE INDEX IF NOT EXISTS idx_photo_candidate_unique
  ON photo_candidate (species_code, inat_id, source_round);
`;

/**
 * Open (or create) the review store at `path` and ensure the schema exists.
 * Pass ':memory:' in tests. WAL is enabled for the on-disk case so the Slice-5
 * review server can read while the CLI writes; no-op on :memory:. THE store
 * opener — Slices 5 and 8 import `openDb` from here.
 */
export function openDb(path: string = DEFAULT_DB_PATH): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

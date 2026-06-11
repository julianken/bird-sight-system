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

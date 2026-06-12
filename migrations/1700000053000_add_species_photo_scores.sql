-- Up Migration
--
-- species_photo_scores — append-only, immutable photo-quality judge scores
-- promoted from the operator-local `review.sqlite` into prod Postgres (epic
-- #1074, child C1 #1070).
--
-- WHY append-only: re-scoring a photo INSERTs a new row, never UPDATEs an
-- existing one. A frozen `(model, rubric_version)` pin is then an immutable,
-- reproducible ground-truth baseline the photo-judge eval (#1010, C4 #1073)
-- grades a candidate scorer against. Mutating a score in place would silently
-- move the baseline out from under any prior eval run, breaking reproducibility.
--
-- UNIQUE (species_code, content_hash, model, rubric_version) is what enforces
-- the append-without-duplicate contract: the SAME image (content_hash) judged
-- by the SAME (model, rubric_version) is recorded once; a different image, a
-- newer model, or a bumped rubric each get their own row. This is also the
-- conflict target the C2 idempotent backfill (#1072) upserts against.
--
-- The pin index (model, rubric_version) serves the eval's primary read pattern:
-- "fetch every score for this frozen baseline pin". It is intentionally NOT on
-- (species_code) first — per-species reads ride the UNIQUE constraint's index.
--
-- Columns mirroring the judge's output:
--   keep           — the binary keep/swap verdict (NOT NULL — every score has one).
--   quality_score  — overall 0–10 score (REAL, nullable: the 13 deterministic-gate
--                    rows have a verdict but no model-assigned numeric score).
--   criteria       — the 7-axis 0–10 score map (JSONB).
--   field_marks    — the diagnostic field-marks array (JSONB).
--   rationale      — the judge's free-text justification (nullable).
--   model          — the judging model id (e.g. 'claude-opus-4-8', or
--                    'deterministic-gate' for the gate rows — see epic #1074).
--   rubric_version — the rubric the score was produced under.
--
-- JSONB (not TEXT-for-json) for criteria/field_marks follows the repo's
-- structured-column convention (observation_grid_agg.families is JSONB,
-- migration 51000): we store machine-shaped data the DB can index/query, not
-- opaque blobs.
--
-- FK species_code → species_meta(species_code) ON DELETE CASCADE matches every
-- other species-keyed child table (species_photos 20000, species_descriptions
-- 30000): deleting a species reaps its scores.
CREATE TABLE species_photo_scores (
  id             BIGSERIAL PRIMARY KEY,
  species_code   TEXT NOT NULL REFERENCES species_meta(species_code) ON DELETE CASCADE,
  content_hash   TEXT NOT NULL,
  model          TEXT NOT NULL,
  rubric_version TEXT NOT NULL,
  keep           BOOLEAN NOT NULL,
  quality_score  REAL,
  criteria       JSONB,
  field_marks    JSONB,
  rationale      TEXT,
  scored_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (species_code, content_hash, model, rubric_version)
);

CREATE INDEX idx_species_photo_scores_pin ON species_photo_scores (model, rubric_version);

-- Down Migration
DROP TABLE IF EXISTS species_photo_scores;

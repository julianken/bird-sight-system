-- Up Migration
CREATE TABLE ingest_runs (
  id              SERIAL PRIMARY KEY,
  kind            TEXT NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL,
  finished_at     TIMESTAMPTZ,
  obs_fetched     INTEGER,
  obs_upserted    INTEGER,
  status          TEXT NOT NULL,
  error_message   TEXT
);
CREATE INDEX ingest_runs_started_idx ON ingest_runs (started_at DESC);
CREATE INDEX ingest_runs_status_idx ON ingest_runs (status, started_at DESC);

-- Down Migration
DROP TABLE IF EXISTS ingest_runs;

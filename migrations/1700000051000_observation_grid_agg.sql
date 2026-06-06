-- Up Migration
--
-- observation_grid_agg — precomputed per-scope aggregation grid (#878).
--
-- The state-scope low-zoom `/api/observations` aggregation (getObservationsAggregated,
-- packages/db-client/src/observations.ts) aggregates EVERY in-state observation at
-- request time. For high-volume states (CA/TX, ~12-15s cold) the cost is the
-- HashAggregate/WindowAgg/Sort over the in-scope row set, NOT row-finding (AZ runs
-- the identical query + indexes in 0.13-0.22s; only row count differs). An index
-- cannot help — it speeds finding rows, not aggregating them. So we precompute the
-- aggregated grid per scope at ingest time and serve the default low-zoom view as a
-- cheap PK lookup.
--
-- One row per (scope_key, grid_multiplier, lng_bucket, lat_bucket):
--   scope_key       — a state code ('US-CA', …) OR the national key 'US'.
--   grid_multiplier — the read-api zoom→grid switch (2/4/8; app.ts:242).
--   lng_bucket /    — round(coord * grid_multiplier) / grid_multiplier, IDENTICAL
--   lat_bucket        to the live `base` CTE bucket key (observations.ts:432-433).
--   observation_count / species_count — the live `bucket_totals` (over ALL rows in
--                     the cell, incl. NULL-family rows).
--   families        — the live `families` per-bucket jsonb rollup, byte-identical to
--                     the live CTE: families ordered (count desc, code asc); species
--                     nested top-8 (count desc, code asc); NULL-family rows excluded
--                     from families[] but counted in the totals.
--
-- This is the FIRST materialized aggregation in the schema (verified: zero
-- materialized views / agg tables pre-#878). The populate (refreshGridAgg in
-- db-client/observations.ts) runs ingest-side after each /recent ingest+reconcile
-- AND after the 14-day prune — never on the request path. One ingest cycle of
-- staleness (~30 min) is acceptable (the edge cache already runs ~40 min).
CREATE TABLE observation_grid_agg (
  scope_key         TEXT             NOT NULL,
  grid_multiplier   INTEGER          NOT NULL,
  lng_bucket        DOUBLE PRECISION NOT NULL,
  lat_bucket        DOUBLE PRECISION NOT NULL,
  observation_count INTEGER          NOT NULL,
  species_count     INTEGER          NOT NULL,
  families          JSONB            NOT NULL,
  PRIMARY KEY (scope_key, grid_multiplier, lng_bucket, lat_bucket)
);

-- Down Migration
DROP TABLE IF EXISTS observation_grid_agg;

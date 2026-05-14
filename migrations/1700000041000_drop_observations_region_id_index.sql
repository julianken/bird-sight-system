-- Up Migration
-- #532 PR-3: drop the btree index on observations.region_id. The column has
-- no live reader after PR-2 (#535).
DROP INDEX IF EXISTS obs_region_idx;

-- Down Migration
CREATE INDEX IF NOT EXISTS obs_region_idx ON observations (region_id);

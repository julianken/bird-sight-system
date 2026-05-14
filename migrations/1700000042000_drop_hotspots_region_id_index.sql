-- Up Migration
-- #532 PR-3: drop the btree index on hotspots.region_id.
DROP INDEX IF EXISTS hotspots_region_idx;

-- Down Migration
CREATE INDEX IF NOT EXISTS hotspots_region_idx ON hotspots (region_id);

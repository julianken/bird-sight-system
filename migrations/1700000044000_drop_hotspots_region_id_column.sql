-- Up Migration
-- #532 PR-3: drop the region_id column on hotspots.
ALTER TABLE hotspots DROP COLUMN IF EXISTS region_id;

-- Down Migration
-- Best-effort (see migration 43000 for rationale).
ALTER TABLE hotspots ADD COLUMN IF NOT EXISTS region_id TEXT;

-- Up Migration
-- #532 PR-3: drop the FK from hotspots to regions.
ALTER TABLE hotspots DROP CONSTRAINT IF EXISTS hotspots_region_id_fkey;

-- Down Migration
-- Best-effort restore (see migration 39000 for rationale).
ALTER TABLE hotspots
  ADD CONSTRAINT hotspots_region_id_fkey
  FOREIGN KEY (region_id) REFERENCES regions(id);

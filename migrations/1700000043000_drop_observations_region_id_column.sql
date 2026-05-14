-- Up Migration
-- #532 PR-3: drop the region_id column on observations. The FK (migration
-- 39000) and the index (41000) are already gone, so this is metadata-only
-- ACCESS EXCLUSIVE — no table rewrite.
ALTER TABLE observations DROP COLUMN IF EXISTS region_id;

-- Down Migration
-- Best-effort: re-add the column as nullable TEXT. The FK target (regions)
-- may also be gone by the time we down-migrate, so we cannot restore the
-- REFERENCES clause here. Acceptable for emergency rollback — the goal is
-- to restore service, not to round-trip the region concept.
ALTER TABLE observations ADD COLUMN IF NOT EXISTS region_id TEXT;

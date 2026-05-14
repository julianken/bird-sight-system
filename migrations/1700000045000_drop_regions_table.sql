-- Up Migration
-- #532 PR-3: drop the regions table itself. By this point both FKs (39000,
-- 40000), both indexes (41000, 42000), and both region_id columns (43000,
-- 44000) are gone, so the table has no remaining references. The two
-- regions indexes (regions_geom_idx, regions_parent_idx) drop with the
-- table automatically.
DROP TABLE IF EXISTS regions;

-- Down Migration
-- Structural-only restore. Re-creates the table shape and indexes from the
-- original 1700000002000_regions.sql; does NOT re-seed the 9 AZ polygons —
-- that data would have to come from a separate re-application of the seed
-- migrations (8000 / 11000 / 12000 / 13000) or a backup.
CREATE TABLE IF NOT EXISTS regions (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  parent_id     TEXT REFERENCES regions(id),
  geom          GEOMETRY(MULTIPOLYGON, 4326) NOT NULL,
  display_color TEXT NOT NULL,
  svg_path      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS regions_geom_idx ON regions USING GIST (geom);
CREATE INDEX IF NOT EXISTS regions_parent_idx ON regions (parent_id);

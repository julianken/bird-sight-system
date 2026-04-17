-- Up Migration
CREATE TABLE regions (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  parent_id     TEXT REFERENCES regions(id),
  geom          GEOMETRY(MULTIPOLYGON, 4326) NOT NULL,
  display_color TEXT NOT NULL,
  svg_path      TEXT NOT NULL
);
CREATE INDEX regions_geom_idx ON regions USING GIST (geom);
CREATE INDEX regions_parent_idx ON regions (parent_id);

-- Down Migration
DROP TABLE IF EXISTS regions;

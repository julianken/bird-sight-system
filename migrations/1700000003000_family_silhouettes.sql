-- Up Migration
CREATE TABLE family_silhouettes (
  id           TEXT PRIMARY KEY,
  family_code  TEXT NOT NULL UNIQUE,
  svg_data     TEXT NOT NULL,
  color        TEXT NOT NULL,
  source       TEXT,
  license      TEXT
);

-- Down Migration
DROP TABLE IF EXISTS family_silhouettes;

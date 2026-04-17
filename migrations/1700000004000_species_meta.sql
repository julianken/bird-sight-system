-- Up Migration
CREATE TABLE species_meta (
  species_code  TEXT PRIMARY KEY,
  com_name      TEXT NOT NULL,
  sci_name      TEXT NOT NULL,
  family_code   TEXT NOT NULL,
  family_name   TEXT NOT NULL,
  taxon_order   NUMERIC
);
CREATE INDEX species_meta_family_idx ON species_meta (family_code);

-- Down Migration
DROP TABLE IF EXISTS species_meta;

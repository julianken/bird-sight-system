-- Up Migration
CREATE TABLE observations (
  sub_id          TEXT NOT NULL,
  species_code    TEXT NOT NULL,
  lat             DOUBLE PRECISION NOT NULL,
  lng             DOUBLE PRECISION NOT NULL,
  geom            GEOMETRY(POINT, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)) STORED,
  obs_dt          TIMESTAMPTZ NOT NULL,
  loc_id          TEXT NOT NULL,
  loc_name        TEXT,
  how_many        INTEGER,
  is_notable      BOOLEAN NOT NULL DEFAULT false,
  region_id       TEXT REFERENCES regions(id),
  silhouette_id   TEXT REFERENCES family_silhouettes(id),
  ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (sub_id, species_code)
);
CREATE INDEX obs_region_idx ON observations (region_id);
CREATE INDEX obs_species_idx ON observations (species_code);
CREATE INDEX obs_dt_idx ON observations (obs_dt DESC);
CREATE INDEX obs_geom_idx ON observations USING GIST (geom);
CREATE INDEX obs_notable_idx ON observations (is_notable) WHERE is_notable = true;

-- Down Migration
DROP TABLE IF EXISTS observations;

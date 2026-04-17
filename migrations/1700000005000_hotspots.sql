-- Up Migration
CREATE TABLE hotspots (
  loc_id              TEXT PRIMARY KEY,
  loc_name            TEXT NOT NULL,
  lat                 DOUBLE PRECISION NOT NULL,
  lng                 DOUBLE PRECISION NOT NULL,
  geom                GEOMETRY(POINT, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)) STORED,
  region_id           TEXT REFERENCES regions(id),
  num_species_alltime INTEGER,
  latest_obs_dt       TIMESTAMPTZ,
  ingested_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX hotspots_geom_idx ON hotspots USING GIST (geom);
CREATE INDEX hotspots_region_idx ON hotspots (region_id);

-- Down Migration
DROP TABLE IF EXISTS hotspots;

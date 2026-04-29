-- Up Migration
CREATE TABLE species_photos (
  id           BIGSERIAL PRIMARY KEY,
  species_code TEXT NOT NULL REFERENCES species_meta(species_code) ON DELETE CASCADE,
  purpose      TEXT NOT NULL CHECK (purpose IN ('detail-panel')),
  url          TEXT NOT NULL,
  attribution  TEXT NOT NULL,
  license      TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (species_code, purpose)
);

-- Down Migration
DROP TABLE IF EXISTS species_photos;

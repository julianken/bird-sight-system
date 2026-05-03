-- Up Migration
--
-- Adds the `species_descriptions` cache table plus the `species_meta.inat_taxon_id`
-- column the writer needs to short-circuit iNat /v1/taxa lookups on subsequent runs.
--
-- The body length CHECK (50..8192) is a defense-in-depth guard against both a
-- silently-failing DOMPurify (post-sanitize empty-string body) and a
-- pathologically long extract (Wikipedia "extract_html" is normally a single
-- paragraph; 8192 leaves room for span/lang annotations on long species pages
-- like Phainopepla without persisting full prose articles).
--
-- The license CHECK is restricted to the two CC-BY-SA variants Wikipedia ships
-- under. New license codes must be added to BOTH this CHECK and the source CHECK
-- (and reviewed for downstream attribution-rendering implications) before they
-- are accepted by the writer.
--
-- The (species_code) UNIQUE supports the upsert-on-conflict pattern in
-- `insertSpeciesDescription`: a second run with the same species_code REPLACES
-- the row's body/license/etag in place rather than accumulating duplicates. This
-- is the same shape `species_photos` uses (UNIQUE on (species_code, purpose));
-- here `purpose` is implicit because there's only one description per species.
ALTER TABLE species_meta ADD COLUMN inat_taxon_id BIGINT;

CREATE TABLE species_descriptions (
  id              BIGSERIAL PRIMARY KEY,
  species_code    TEXT NOT NULL REFERENCES species_meta(species_code) ON DELETE CASCADE,
  source          TEXT NOT NULL CHECK (source IN ('wikipedia')),
  body            TEXT NOT NULL CHECK (length(body) BETWEEN 50 AND 8192),
  license         TEXT NOT NULL CHECK (license IN ('CC-BY-SA-3.0','CC-BY-SA-4.0')),
  revision_id     BIGINT,
  etag            TEXT,
  attribution_url TEXT NOT NULL,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (species_code)
);

-- Down Migration
-- Order matters: drop the table first (it FK-references species_meta), then
-- drop the column on species_meta (no dependents). Both use IF EXISTS so the
-- down is idempotent — a partial-rollback retry won't error on the second pass.
DROP TABLE IF EXISTS species_descriptions;
ALTER TABLE species_meta DROP COLUMN IF EXISTS inat_taxon_id;

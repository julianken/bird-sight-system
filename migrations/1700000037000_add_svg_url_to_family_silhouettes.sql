-- Up Migration

-- Issue #502. Adds a nullable URL column for admin-api-uploaded silhouettes.
-- The existing svg_data column (path-d, single-path 0..24 viewBox) stays
-- load-bearing for the map's synchronous SDF sprite registration
-- (frontend/src/components/map/MapCanvas.tsx#registerSilhouetteSprite).
-- The new svg_url column powers <img>-rendered legend / detail surfaces and
-- is what the admin-api PUT endpoint writes alongside an extracted path-d
-- copy in svg_data. NULL is the steady state for rows that haven't been
-- overridden via the admin-api (all 65 current rows). DELETE via the
-- admin-api nulls both svg_url and svg_data (full revert; see D2 in
-- docs/plans/2026-05-13-silhouette-admin-api.md).

ALTER TABLE family_silhouettes ADD COLUMN svg_url TEXT NULL;

-- Down Migration

ALTER TABLE family_silhouettes DROP COLUMN svg_url;

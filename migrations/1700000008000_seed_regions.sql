-- Up Migration
--
-- Hand-authored simplified shapes for the 9 AZ birding ecoregions.
-- Replaces the Plan-1 axis-aligned rectangle placeholders with polygons that
-- approximate each ecoregion's real geography (8–16 vertices per region).
--
-- Coordinate systems:
--   geom  — WGS84 MULTIPOLYGON (SRID 4326), lng range −114.85…−109.05,
--            lat range 31.30…37.00 (AZ bounding box).
--   svg_path — SVG path string for viewBox "0 0 360 380".  Derived from geom
--              using the same linear projection as frontend/src/components/Map.tsx:
--                x = ((lng − −114.85) / (−109.05 − −114.85)) × 360
--                y = ((37.00 − lat)   / (37.00 − 31.30))     × 380
--              geom and svg_path describe the same shape; they must stay in sync.
--
-- INGEST CONTRACT (services/ingestor/src/upsert.ts):
--   SELECT id FROM regions
--   WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint($1,$2),4326))
--   ORDER BY ST_Area(geom) ASC, id ASC
--   LIMIT 1;
--   Smallest-area first gives child priority (grand-canyon wins over
--   colorado-plateau) and deterministic tie-breaking for siblings.

INSERT INTO regions (id, name, parent_id, geom, display_color, svg_path) VALUES

('colorado-plateau',
 'Colorado Plateau',
 NULL,
 ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((-114.8 37.0, -112.0 37.0, -109.05 37.0, -109.05 34.5, -110.8 34.3, -112.2 34.4, -113.3 34.6, -114.0 35.0, -114.3 35.8, -114.8 36.3, -114.8 37.0)))'), 4326),
 '#C77A2E',
 'M 3.1 0.0 L 176.9 0.0 L 360.0 0.0 L 360.0 166.7 L 251.4 180.0 L 164.5 173.3 L 96.2 160.0 L 52.8 133.3 L 34.1 80.0 L 3.1 46.7 Z'),

('grand-canyon',
 'Grand Canyon',
 'colorado-plateau',
 ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((-114.0 36.4, -113.4 36.5, -112.8 36.5, -112.2 36.4, -111.8 36.3, -111.8 35.8, -112.5 35.65, -113.3 35.7, -114.0 35.8, -114.0 36.4)))'), 4326),
 '#9B5E20',
 'M 52.8 40.0 L 90.0 33.3 L 127.2 33.3 L 164.5 40.0 L 189.3 46.7 L 189.3 80.0 L 145.9 90.0 L 96.2 86.7 L 52.8 80.0 Z'),

('mogollon-rim',
 'Mogollon Rim',
 NULL,
 ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((-114.0 35.0, -113.3 34.6, -112.2 34.4, -110.8 34.3, -109.05 34.5, -109.05 33.5, -110.2 33.2, -111.5 33.2, -112.8 33.3, -114.0 33.8, -114.0 35.0)))'), 4326),
 '#5A6B2A',
 'M 52.8 133.3 L 96.2 160.0 L 164.5 173.3 L 251.4 180.0 L 360.0 166.7 L 360.0 233.3 L 288.6 253.3 L 207.9 253.3 L 127.2 246.7 L 52.8 213.3 Z'),

('sonoran-phoenix',
 'Sonoran — Phoenix',
 NULL,
 ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((-114.0 33.8, -113.3 33.5, -112.8 33.3, -111.5 33.2, -111.0 32.6, -111.3 31.8, -112.5 31.5, -113.2 31.6, -114.0 31.7, -114.0 33.8)))'), 4326),
 '#D4923A',
 'M 52.8 213.3 L 96.2 233.3 L 127.2 246.7 L 207.9 253.3 L 239.0 293.3 L 220.3 346.7 L 145.9 366.7 L 102.4 360.0 L 52.8 353.3 Z'),

('lower-colorado',
 'Lower Colorado / Mojave',
 NULL,
 ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((-114.8 36.3, -114.5 35.8, -114.3 35.2, -114.1 34.5, -114.0 33.8, -114.0 32.8, -114.0 31.7, -114.4 31.4, -114.85 31.35, -114.8 36.3)))'), 4326),
 '#B07020',
 'M 3.1 46.7 L 21.7 80.0 L 34.1 120.0 L 46.6 166.7 L 52.8 213.3 L 52.8 280.0 L 52.8 353.3 L 27.9 373.3 L 0.0 376.7 Z'),

('sonoran-tucson',
 'Sonoran — Tucson',
 NULL,
 ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((-111.5 33.2, -110.8 33.2, -110.2 33.2, -109.05 33.5, -109.05 31.3, -110.6 31.3, -111.0 31.6, -111.0 32.1, -111.0 32.6, -111.5 33.2)))'), 4326),
 '#E0A040',
 'M 207.9 253.3 L 251.4 253.3 L 288.6 253.3 L 360.0 233.3 L 360.0 380.0 L 263.8 380.0 L 239.0 360.0 L 239.0 326.7 L 239.0 293.3 Z'),

('sky-islands-santa-ritas',
 'Sky Islands — Santa Ritas',
 NULL,
 ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((-111.2 32.05, -111.0 32.12, -110.75 32.05, -110.55 31.88, -110.58 31.68, -110.78 31.55, -111.0 31.58, -111.18 31.72, -111.2 31.9, -111.2 32.05)))'), 4326),
 '#FF0808',
 'M 226.6 330.0 L 239.0 325.3 L 254.5 330.0 L 266.9 341.3 L 265.0 354.7 L 252.6 363.3 L 239.0 361.3 L 227.8 352.0 L 226.6 340.0 Z'),

('sky-islands-huachucas',
 'Sky Islands — Huachucas',
 NULL,
 ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((-110.55 31.92, -110.32 31.95, -110.08 31.88, -110.05 31.68, -110.12 31.45, -110.32 31.4, -110.52 31.48, -110.58 31.68, -110.55 31.85, -110.55 31.92)))'), 4326),
 '#FF0808',
 'M 266.9 338.7 L 281.2 336.7 L 296.1 341.3 L 297.9 354.7 L 293.6 370.0 L 281.2 373.3 L 268.8 368.0 L 265.0 354.7 L 266.9 343.3 Z'),

('sky-islands-chiricahuas',
 'Sky Islands — Chiricahuas',
 NULL,
 ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((-109.6 32.18, -109.4 32.22, -109.15 32.15, -109.05 31.98, -109.05 31.58, -109.22 31.52, -109.45 31.55, -109.6 31.72, -109.6 31.95, -109.6 32.18)))'), 4326),
 '#FF0808',
 'M 325.9 321.3 L 338.3 318.7 L 353.8 323.3 L 360.0 334.7 L 360.0 361.3 L 349.4 365.3 L 335.2 363.3 L 325.9 352.0 L 325.9 336.7 Z');

-- Down Migration
DELETE FROM regions WHERE id IN (
  'colorado-plateau','grand-canyon','mogollon-rim','sonoran-phoenix',
  'lower-colorado','sonoran-tucson','sky-islands-santa-ritas',
  'sky-islands-huachucas','sky-islands-chiricahuas'
);

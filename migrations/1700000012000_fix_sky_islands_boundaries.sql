-- Up Migration
--
-- Clamp sky-islands-santa-ritas vertices to its declared parent
-- (sonoran-tucson) west/southwest boundary.
--
-- Background
-- ----------
-- 1700000011000_fix_region_boundaries.sql moved sonoran-tucson's west edge
-- east from lng=-111.5 onto the lng=-111.0 vertical (11000:136-144) but did
-- not rewrite the three sky-island rows — those still quote the seed geom
-- from 1700000008000_seed_regions.sql.  Santa Ritas' west lobe at
-- lng=-111.20 / x=226.552 and lng=-111.18 / x=227.793 (8000:71) therefore
-- protrudes ~12 SVG units WEST of the new parent clamp at lng=-111.0 /
-- x=238.966.  In addition, 8000's vertex (-111.0, 31.58) lies ~0.027° west
-- of parent's SW diagonal (which runs from (-110.6, 31.3) to
-- (-111.0, 31.6) — at lat=31.58 the diagonal's lng is -110.973, so a point
-- at -111.0 is strictly outside).  Huachucas is clean; Chiricahuas has two
-- x=360 vertices on the parent's east clamp (on-boundary, not outside),
-- deferred to a follow-up.
--
-- Fix (three classes of vertex moves)
-- -----------------------------------
--   a) Four vertices west of the parent west wall are clamped to
--      lng=-111.0 (x=238.966), lat/y unchanged:
--        (-111.20, 32.05)  -> (-111.0, 32.05)
--        (-111.18, 31.72)  -> (-111.0, 31.72)
--        (-111.20, 31.90)  -> (-111.0, 31.90)
--        (-111.20, 32.05)  -> (-111.0, 32.05)   (ring-close duplicate)
--   b) The SW-diagonal-violating vertex is snapped to parent's SW corner:
--        (-111.0, 31.58)   -> (-111.0, 31.60)
--   c) One existing west-wall vertex is shifted 0.02° south so it
--      coincides bit-identically with parent's mid-west-wall vertex,
--      giving a second shared seam point:
--        (-111.0, 32.12)   -> (-111.0, 32.10)
--
-- After (a)+(b)+(c) the child shares two bit-identical vertices with the
-- parent along the new seam: (-111.0, 31.6) (parent's SW corner,
-- 11000:138) and (-111.0, 32.1) (parent's mid-west-wall vertex,
-- 11000:138).  Parent's third west-edge vertex at lat=32.6 is ~0.5° north
-- of Santa Ritas' natural top (lat≈32.05) and is intentionally NOT forced
-- into the child — pulling it in would distort the shape.
--
-- Projection contract (unchanged from 8000 header)
--   x = ((lng + 114.85) / 5.8) * 360
--   y = ((37.00 - lat)  / 5.7) * 380
-- Rounded to 3 decimals to match 11000's precision exactly; using 8000's
-- 1-decimal form (239.0) would reintroduce a ~0.034-unit hairline seam.
-- `svg_path` stores only absolute M/L/Z verbs (no curves) — matches the
-- minimal subset the (removed, #133) SVG parser accepted; preserved for
-- forward compatibility with any future SVG consumer of `/api/regions`.
--
-- Ingest contract
-- ---------------
-- Smallest-area-wins ST_Contains routing at
--   packages/db-client/src/observations.ts:58-59
-- and
--   packages/db-client/src/hotspots.ts:64-71
-- is unaffected.  Santa Ritas shrinks INWARD, so any observation in the
-- excised sliver (lng ∈ [-111.20, -111.0], lat ∈ [31.58, 32.12]) will
-- route to sonoran-phoenix or sonoran-tucson on next ingest.  Historical
-- rows are NOT re-stamped here; backfill is out of scope.

UPDATE regions SET
  geom = ST_SetSRID(ST_GeomFromText(
    'MULTIPOLYGON(((-111.0 32.05, -111.0 32.1, -110.75 32.05, '
    '-110.55 31.88, -110.58 31.68, -110.78 31.55, -111.0 31.6, '
    '-111.0 31.72, -111.0 31.9, -111.0 32.05)))'
  ), 4326),
  svg_path = 'M 238.966 330.000 L 238.966 326.667 L 254.483 330.000 '
             'L 266.897 341.333 L 265.034 354.667 L 252.621 363.333 '
             'L 238.966 360.000 L 238.966 352.000 L 238.966 340.000 Z'
WHERE id = 'sky-islands-santa-ritas';

-- Down Migration
--
-- Restore the original Santa Ritas polygon verbatim from
-- migrations/1700000008000_seed_regions.sql lines 71 + 73.

UPDATE regions SET
  geom = ST_SetSRID(ST_GeomFromText(
    'MULTIPOLYGON(((-111.2 32.05, -111.0 32.12, -110.75 32.05, '
    '-110.55 31.88, -110.58 31.68, -110.78 31.55, -111.0 31.58, '
    '-111.18 31.72, -111.2 31.9, -111.2 32.05)))'
  ), 4326),
  svg_path = 'M 226.6 330.0 L 239.0 325.3 L 254.5 330.0 L 266.9 341.3 '
             'L 265.0 354.7 L 252.6 363.3 L 239.0 361.3 L 227.8 352.0 '
             'L 226.6 340.0 Z'
WHERE id = 'sky-islands-santa-ritas';

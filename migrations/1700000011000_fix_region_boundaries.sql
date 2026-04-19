-- Up Migration
--
-- Fix topology gaps and overlaps at shared boundaries between neighbouring AZ
-- ecoregion polygons, and populate `parent_id` on the three sky-island rows.
--
-- Background
-- ----------
-- The 9 polygons seeded in migrations/1700000008000_seed_regions.sql were
-- hand-authored independently per region, so neighbouring polygons did not
-- share identical vertex sequences along their common edges.  This left thin
-- gaps and small overlaps (visible when rendering, and incorrect as a
-- coverage model) between the following sibling pairs:
--
--   lower-colorado   ↔ colorado-plateau      (west edge, lat 35–36 / y≈80–120)
--   lower-colorado   ↔ mogollon-rim          (west edge, lat 34–35 / y≈133–200)
--   lower-colorado   ↔ sonoran-phoenix       (west edge, lat 31.7–33.8 / y≈200)
--   mogollon-rim     ↔ sonoran-tucson        (lat ≈33.2 at lng=-111.5)
--   sonoran-phoenix  ↔ sonoran-tucson        (lat 31.6–33.5 / SVG y≈233–360, x≈207–239)
--
-- Fix strategy
-- ------------
-- For every shared edge in the 9-region topology, pick ONE canonical sequence
-- of vertices and rewrite the neighbour so both polygons quote the same
-- sequence (in reversed order on one side).  Picked the *lower-colorado*
-- east-edge vertex sequence as canonical along the entire west side of the
-- state because those vertices approximate the true AZ western boundary most
-- faithfully (they have the finest granularity).  Picked the *mogollon-rim*
-- south edge (through the -110.2 / 33.2 dip) as canonical for the mr↔st
-- interface, snapping sonoran-tucson's top to match.  Picked the sp↔st 3-way
-- corners at (-111.5, 33.5) and (-111.0, 31.6) to force both polygons to meet
-- cleanly along a lng=-111.0 vertical segment (lat 32.6 → 31.6).
--
-- Projection contract (unchanged from 1700000008000 header):
--   x = ((lng + 114.85) / 5.8) * 360
--   y = ((37.00 - lat)  / 5.7) * 380
-- `geom` and `svg_path` describe the same shape; the SVG values below are
-- deterministically derived from the MULTIPOLYGON coordinates using that
-- formula.  The SVG path uses only absolute M/L/Z verbs — no curves — because
-- the parser in frontend/src/components/Region.tsx and frontend/src/geo/path.ts
-- only understands that subset.
--
-- Ingest contract (smallest-area-wins point-in-polygon) — TWO call sites:
--   packages/db-client/src/observations.ts:58-59
--     SELECT r.id FROM regions r
--     WHERE ST_Contains(r.geom, o.geom)
--     ORDER BY ST_Area(r.geom) ASC
--     LIMIT 1
--   packages/db-client/src/hotspots.ts:64-71
--     Same pattern, and duplicated in the re-stamp WHERE clause of the same
--     UPDATE statement.
-- Both call sites preserve child-wins-over-parent for sky-island points (a
-- point inside a sky-island is stamped with the sky-island id because
-- `ST_Area(sky-island) < ST_Area(sonoran-tucson)`).
-- (Note: the 1700000008000 header refers to a `services/ingestor/src/upsert.ts`
-- file that does not exist in the shipped codebase — the real call sites are
-- the two files above.)
--
-- Sky-island parenting (Option A from Wave 0.5 round 3)
-- -----------------------------------------------------
-- The three sky-island rows were seeded with parent_id = NULL, but the
-- `regions.parent_id` column (migrations/1700000002000_regions.sql:5) exists
-- precisely for this nesting, and `grand-canyon → colorado-plateau` already
-- uses it.  Populating parent_id = 'sonoran-tucson' on all three sky-islands:
--   * makes the data model internally consistent,
--   * lets a sibling-pair overlap check (same parent_id, neither is the
--     other's parent) correctly exclude the sky-island-inside-parent overlap
--     that is intentional by design,
--   * has no impact on the ingest contract because ST_Area(sky-island) is
--     much smaller than ST_Area(sonoran-tucson), so smallest-area-wins still
--     routes observations to the sky-island.

-- ---- Boundary fixes: one UPDATE per affected polygon ----

-- colorado-plateau: snap west edge to lower-colorado's east vertices and move
-- NW corner to lng=-114.85 (matching lc's top-west vertex).
UPDATE regions SET
  geom = ST_SetSRID(ST_GeomFromText(
    'MULTIPOLYGON(((-114.85 37.0, -112.0 37.0, -109.05 37.0, -109.05 34.5, '
    '-110.8 34.3, -112.2 34.4, -113.3 34.6, -114.1 34.5, -114.3 35.2, '
    '-114.5 35.8, -114.85 36.3, -114.85 37.0)))'
  ), 4326),
  svg_path = 'M 0.000 0.000 L 176.897 0.000 L 360.000 0.000 L 360.000 166.667 '
             'L 251.379 180.000 L 164.483 173.333 L 96.207 160.000 '
             'L 46.552 166.667 L 34.138 120.000 L 21.724 80.000 L 0.000 46.667 Z'
WHERE id = 'colorado-plateau';

-- mogollon-rim: snap NW corner to the cp/mr/lc 3-way (-114.1, 34.5) and SW
-- corner to the mr/sp/lc 3-way (-114.0, 33.8).
UPDATE regions SET
  geom = ST_SetSRID(ST_GeomFromText(
    'MULTIPOLYGON(((-114.1 34.5, -113.3 34.6, -112.2 34.4, -110.8 34.3, '
    '-109.05 34.5, -109.05 33.5, -110.2 33.2, -111.5 33.5, -112.5 33.85, '
    '-113.3 33.9, -114.0 33.8, -114.1 34.5)))'
  ), 4326),
  svg_path = 'M 46.552 166.667 L 96.207 160.000 L 164.483 173.333 '
             'L 251.379 180.000 L 360.000 166.667 L 360.000 233.333 '
             'L 288.621 253.333 L 207.931 233.333 L 145.862 210.000 '
             'L 96.207 206.667 L 52.759 213.333 Z'
WHERE id = 'mogollon-rim';

-- sonoran-phoenix: snap NW corner to (-114.0, 33.8); on the east side,
-- replace the (-111.3, 31.8) vertex with a straight lng=-111.0 run from
-- (-111.0, 32.6) through (-111.0, 32.1) to the sp/st/Mexico 3-way
-- (-111.0, 31.6).
UPDATE regions SET
  geom = ST_SetSRID(ST_GeomFromText(
    'MULTIPOLYGON(((-114.0 33.8, -113.3 33.9, -112.5 33.85, -111.5 33.5, '
    '-111.0 32.6, -111.0 32.1, -111.0 31.6, -112.5 31.5, -113.2 31.6, '
    '-114.0 31.7, -114.0 33.8)))'
  ), 4326),
  svg_path = 'M 52.759 213.333 L 96.207 206.667 L 145.862 210.000 '
             'L 207.931 233.333 L 238.966 293.333 L 238.966 326.667 '
             'L 238.966 360.000 L 145.862 366.667 L 102.414 360.000 '
             'L 52.759 353.333 Z'
WHERE id = 'sonoran-phoenix';

-- lower-colorado: the canonical west/east edges are already lc's own
-- vertices; this UPDATE is essentially a no-op on geometry but closes the
-- ring on the same vertex used as the NW corner (-114.85, 36.3) and snaps
-- the southern shared corner (-114.0, 31.7) to match sp's SW corner.  svg
-- path is refreshed to the canonical 3-decimal form.
UPDATE regions SET
  geom = ST_SetSRID(ST_GeomFromText(
    'MULTIPOLYGON(((-114.85 36.3, -114.5 35.8, -114.3 35.2, -114.1 34.5, '
    '-114.0 33.8, -114.0 32.8, -114.0 31.7, -114.4 31.4, -114.85 31.35, '
    '-114.85 36.3)))'
  ), 4326),
  svg_path = 'M 0.000 46.667 L 21.724 80.000 L 34.138 120.000 '
             'L 46.552 166.667 L 52.759 213.333 L 52.759 280.000 '
             'L 52.759 353.333 L 27.931 373.333 L 0.000 376.667 Z'
WHERE id = 'lower-colorado';

-- sonoran-tucson: snap NW corner to the mr/sp/st 3-way (-111.5, 33.5) —
-- previously 33.2 — and drop the extra (-110.8, 33.2) vertex so the north
-- edge matches mr's south edge (a single dip to -110.2, 33.2).
UPDATE regions SET
  geom = ST_SetSRID(ST_GeomFromText(
    'MULTIPOLYGON(((-111.5 33.5, -110.2 33.2, -109.05 33.5, -109.05 31.3, '
    '-110.6 31.3, -111.0 31.6, -111.0 32.1, -111.0 32.6, -111.5 33.5)))'
  ), 4326),
  svg_path = 'M 207.931 233.333 L 288.621 253.333 L 360.000 233.333 '
             'L 360.000 380.000 L 263.793 380.000 L 238.966 360.000 '
             'L 238.966 326.667 L 238.966 293.333 Z'
WHERE id = 'sonoran-tucson';

-- ---- Sky-island parent_id (Option A, Wave 0.5 round 3) ----

UPDATE regions SET parent_id = 'sonoran-tucson'
WHERE id IN (
  'sky-islands-santa-ritas',
  'sky-islands-huachucas',
  'sky-islands-chiricahuas'
);

-- Down Migration
--
-- Revert sky-island parent_id first (reverse order of the UP changes).

UPDATE regions SET parent_id = NULL
WHERE id IN (
  'sky-islands-santa-ritas',
  'sky-islands-huachucas',
  'sky-islands-chiricahuas'
);

-- Revert each boundary UPDATE by inlining the original polygon + svg_path
-- values from migrations/1700000008000_seed_regions.sql.

UPDATE regions SET
  geom = ST_SetSRID(ST_GeomFromText(
    'MULTIPOLYGON(((-114.8 37.0, -112.0 37.0, -109.05 37.0, -109.05 34.5, '
    '-110.8 34.3, -112.2 34.4, -113.3 34.6, -114.0 35.0, -114.3 35.8, '
    '-114.8 36.3, -114.8 37.0)))'
  ), 4326),
  svg_path = 'M 3.1 0.0 L 176.9 0.0 L 360.0 0.0 L 360.0 166.7 L 251.4 180.0 '
             'L 164.5 173.3 L 96.2 160.0 L 52.8 133.3 L 34.1 80.0 L 3.1 46.7 Z'
WHERE id = 'colorado-plateau';

UPDATE regions SET
  geom = ST_SetSRID(ST_GeomFromText(
    'MULTIPOLYGON(((-114.0 35.0, -113.3 34.6, -112.2 34.4, -110.8 34.3, '
    '-109.05 34.5, -109.05 33.5, -110.2 33.2, -111.5 33.5, -112.5 33.85, '
    '-113.3 33.9, -114.0 34.0, -114.0 35.0)))'
  ), 4326),
  svg_path = 'M 52.8 133.3 L 96.2 160.0 L 164.5 173.3 L 251.4 180.0 L 360.0 166.7 '
             'L 360.0 233.3 L 288.6 253.3 L 207.9 233.3 L 145.9 210.0 L 96.2 206.7 '
             'L 52.8 200.0 Z'
WHERE id = 'mogollon-rim';

UPDATE regions SET
  geom = ST_SetSRID(ST_GeomFromText(
    'MULTIPOLYGON(((-114.0 34.0, -113.3 33.9, -112.5 33.85, -111.5 33.5, '
    '-111.0 32.6, -111.3 31.8, -112.5 31.5, -113.2 31.6, -114.0 31.7, '
    '-114.0 34.0)))'
  ), 4326),
  svg_path = 'M 52.8 200.0 L 96.2 206.7 L 145.9 210.0 L 207.9 233.3 L 239.0 293.3 '
             'L 220.3 346.7 L 145.9 366.7 L 102.4 360.0 L 52.8 353.3 Z'
WHERE id = 'sonoran-phoenix';

UPDATE regions SET
  geom = ST_SetSRID(ST_GeomFromText(
    'MULTIPOLYGON(((-114.8 36.3, -114.5 35.8, -114.3 35.2, -114.1 34.5, '
    '-114.0 33.8, -114.0 32.8, -114.0 31.7, -114.4 31.4, -114.85 31.35, '
    '-114.8 36.3)))'
  ), 4326),
  svg_path = 'M 3.1 46.7 L 21.7 80.0 L 34.1 120.0 L 46.6 166.7 L 52.8 213.3 '
             'L 52.8 280.0 L 52.8 353.3 L 27.9 373.3 L 0.0 376.7 Z'
WHERE id = 'lower-colorado';

UPDATE regions SET
  geom = ST_SetSRID(ST_GeomFromText(
    'MULTIPOLYGON(((-111.5 33.2, -110.8 33.2, -110.2 33.2, -109.05 33.5, '
    '-109.05 31.3, -110.6 31.3, -111.0 31.6, -111.0 32.1, -111.0 32.6, '
    '-111.5 33.2)))'
  ), 4326),
  svg_path = 'M 207.9 253.3 L 251.4 253.3 L 288.6 253.3 L 360.0 233.3 L 360.0 380.0 '
             'L 263.8 380.0 L 239.0 360.0 L 239.0 326.7 L 239.0 293.3 Z'
WHERE id = 'sonoran-tucson';

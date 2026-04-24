-- Up Migration
--
-- Replace the bright-red #FF0808 fill on the three sky-island rows with a
-- desaturated brick red (#B84C3A) that fits the earth-tone palette of the
-- other six regions.  See tmp/svg-investigation/01-visual-evidence.md S0#3
-- for the original defect (live site: https://bird-maps.com) and the
-- ticket body of issue #89 for the palette rationale ("reads as distinct
-- without leaving the earth-tone palette").
--
-- `display_color` is a column on the `regions` table — the fix lives in
-- the DB seed because the column is part of the `/api/regions` data
-- contract (`packages/db-client/src/regions.ts:12`, exposed as
-- `Region.displayColor` on `packages/shared-types/src/index.ts`).  The
-- original SVG region-fill renderer that consumed it was removed in #133;
-- the current MapLibre map does not draw region polygons, so no live
-- frontend reader exists today.  A static token at
-- `frontend/src/tokens.ts` (`color.palette.skyIslands`) mirrors this hex
-- as a forward-compat reference — keep the DB value and the token in sync
-- if either changes.
--
-- Timestamp `1700000013000` is the next slot after the most recent
-- sky-islands migration (`1700000012000_fix_sky_islands_boundaries.sql`,
-- merged as #95); `1700000012XXX` was reserved by the boundary fix.

UPDATE regions SET display_color = '#B84C3A'
WHERE id IN (
  'sky-islands-santa-ritas',
  'sky-islands-huachucas',
  'sky-islands-chiricahuas'
);

-- Down Migration
--
-- Restore the pre-fix bright-red (#FF0808) seeded in
-- 1700000008000_seed_regions.sql lines 72, 79, 86.

UPDATE regions SET display_color = '#FF0808'
WHERE id IN (
  'sky-islands-santa-ritas',
  'sky-islands-huachucas',
  'sky-islands-chiricahuas'
);

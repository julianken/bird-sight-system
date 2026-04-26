-- Up Migration
--
-- Issue #246 (epic #251). Adds a `common_name` to the `_FALLBACK` row
-- inserted by migration 1700000018000.
--
-- Slot ordering: must run AFTER 1700000019000 (which adds the
-- common_name column from #249) and AFTER 1700000019500 (which seeds
-- the 25 baseline+expansion families). Slotted at 19700 so it lands
-- after both without colliding with future migrations at 20000+.
--
-- Why not include common_name in 18000's INSERT: the column didn't
-- exist yet at slot 18000 (added by #249 at 19000). Splitting the
-- attribute write into a separate migration keeps each migration
-- self-consistent against the schema as it existed at that slot.
--
-- 'Unknown family' is the user-facing label that the FamilyLegend (#249)
-- displays when a row has no Phylopic-curated taxonomic name. Mirrors
-- the visual signal of the neutral grey color (#555555) and 50%
-- icon-opacity that the SDF symbol layer uses for _FALLBACK.
UPDATE family_silhouettes
   SET common_name = 'Unknown family'
 WHERE family_code = '_FALLBACK';

-- Down Migration
UPDATE family_silhouettes SET common_name = NULL WHERE family_code = '_FALLBACK';

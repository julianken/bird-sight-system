-- Up Migration
-- Issue #922 (family-name hygiene) — CORRECTED (inverted-spelling fix).
-- Dedupe the spelling-variant duplicate in family_silhouettes for the
-- silky-flycatcher family, keeping the spelling production actually resolves
-- against.
--
-- The table carries BOTH spellings of the silky-flycatcher family:
--   * `ptiliogonatidae` — eBird's family scientific-name spelling
--     ("Ptiliogonatidae", extra `i`). Because family_code is
--     `lower(familySciName)`, this is what species_meta.family_code holds for
--     Phainopepla, so the silhouette-stamp join (db-client observations.ts)
--     writes observations.silhouette_id = 'ptiliogonatidae'. THE LOAD-BEARING
--     ROW. Inserted by migration 34000, palette set in 46000 (#73596a).
--   * `ptilogonatidae` — a no-`i` spelling seeded in migration 15000 before the
--     eBird-derived family_code convention existed. NOTHING joins to it: it is
--     an orphan. Named 'Silky-Flycatchers' in 19500, palette set in 46000
--     (#5b5b9c).
--
-- WHY THE ORIGINAL 52000 FAILED: it deleted `ptiliogonatidae` (the load-bearing
-- row) on the inverted belief that `ptilogonatidae` was canonical. In
-- production that DELETE hit observations_silhouette_id_fkey (real observation
-- rows reference 'ptiliogonatidae'), so it errored on every deploy
-- (deploy-migrations red since 2026-06-07) — yet passed CI, because
-- testcontainers run against an empty observations table where the FK check
-- never fires. The premise in the old comment ("no observation references the
-- extra-`i` spelling") was the exact inversion of prod reality.
--
-- FIX: keep `ptiliogonatidae` (eBird-canonical, prod-referenced), transfer the
-- orphan's maintained palette + title-case common_name onto it, then delete the
-- orphan `ptilogonatidae`. No ingest alias is ever needed because the surviving
-- spelling already matches what eBird ingest produces — the alias the old
-- comment worried about was an artifact of keeping the wrong row.

-- 1. FK safety: repoint any observation stamped with the orphan spelling onto
--    the survivor before deleting it. In prod this matches zero rows (the orphan
--    is unreferenced), but it makes the migration correct under any data state
--    and lets the DELETE below never violate the FK.
UPDATE observations SET silhouette_id = 'ptiliogonatidae' WHERE silhouette_id = 'ptilogonatidae';

-- 2. Transfer the orphan's maintained palette (migration 46000) and title-case
--    common_name (migration 19500) onto the survivor, so the surviving row
--    keeps the WCAG-calibrated colors and the 'Silky-Flycatchers' casing.
--    UPDATE...FROM becomes a no-op once the orphan is gone (idempotent re-run).
UPDATE family_silhouettes AS keep
   SET color = src.color, color_dark = src.color_dark, common_name = src.common_name
  FROM family_silhouettes AS src
 WHERE keep.family_code = 'ptiliogonatidae' AND src.family_code = 'ptilogonatidae';

-- 3. Drop the orphan spelling. Idempotent (no-op if already absent).
DELETE FROM family_silhouettes WHERE family_code = 'ptilogonatidae';

-- Down Migration
-- Restore the two-row pre-migration state: re-insert the `ptilogonatidae` orphan
-- with its pre-Up values (NULL svg_data/source/license/creator, migration 19500
-- title-case 'Silky-Flycatchers', migration 46000 dual palette #5b5b9c), and
-- revert the survivor `ptiliogonatidae` to its own pre-Up values (#73596a,
-- migration 34000 'Silky-flycatchers' lowercase `f`). ON CONFLICT keeps the
-- INSERT idempotent.
INSERT INTO family_silhouettes
  (id, family_code, svg_data, color, color_dark, source, license, creator, common_name)
VALUES
  ('ptilogonatidae', 'ptilogonatidae', NULL, '#5b5b9c', '#5b5b9c', NULL, NULL, NULL, 'Silky-Flycatchers')
ON CONFLICT (id) DO NOTHING;

UPDATE family_silhouettes
   SET color = '#73596a', color_dark = '#73596a', common_name = 'Silky-flycatchers'
 WHERE family_code = 'ptiliogonatidae';

-- Up Migration
-- Issue #922 (family-name hygiene). Dedupe the spelling-variant duplicate in
-- family_silhouettes for the silky-flycatcher family.
--
-- The table carries BOTH spellings of the Ptilogonatidae family:
--   * `ptilogonatidae`  — the PROJECT CANONICAL key, which is
--     `lower(familySciName)` (the same shape every other family_code uses,
--     and the key observations.family_code / species_meta.family_code resolve
--     against). Seeded in migration 15000, named 'Silky-Flycatchers' in 19500,
--     dual-palette colored in 46000.
--   * `ptiliogonatidae` — an extra-`i` variant matching eBird's own family
--     scientific-name spelling (`Ptiliogonatidae`). Inserted as a separate row
--     in migration 34000 (issue #495 AZ backfill) with common_name
--     'Silky-flycatchers' (note the lowercase `f` — a casing inconsistency too).
--
-- Both rows currently carry a common_name, so rendering is fine TODAY. But two
-- rows for one family is latent taxonomy drift, and once a `family_silhouettes`
-- join is added on the read path (PR4 / issue #925), a `LEFT JOIN` on
-- family_code could match two rows for this family. Removing the variant now
-- keeps that join single-row-per-family.
--
-- We keep `ptilogonatidae` (the project canonical) and delete the
-- `ptiliogonatidae` variant. No observation or species_meta row references the
-- extra-`i` spelling (family_code is `lower(familySciName)` = `ptilogonatidae`),
-- so nothing is orphaned. The surviving canonical row keeps its non-null
-- common_name ('Silky-Flycatchers') unchanged.
--
-- eBird-join normalization note (scoped to a comment, NOT live code): the
-- project's family_code is `lower(familySciName)`, while eBird's taxonomy
-- spells this family `Ptiliogonatidae` (extra `i`) — so a future
-- `lower(familySciName)` join against eBird's `familyComName` would need the
-- alias `ptiliogonatidae -> ptilogonatidae`. No eBird name-refresh consumer
-- ships in this work, so the alias stays documented-only until one exists; see
-- docs/analyses/2026-06-07-family-colloquial-names/report.md (Authoritative
-- source) for the full normalization gotcha.
DELETE FROM family_silhouettes WHERE family_code = 'ptiliogonatidae';

-- Down Migration
-- Re-insert the `ptiliogonatidae` variant exactly as it stood in the
-- fully-migrated forward state: NULL svg_data/source/license/creator (it was a
-- skip-family row in 34000), common_name 'Silky-flycatchers', and the
-- dual-palette colors set by migration 46000 (color/color_dark = #73596a).
-- ON CONFLICT keeps this idempotent if the row somehow already exists.
INSERT INTO family_silhouettes
  (id, family_code, svg_data, color, color_dark, source, license, creator, common_name)
VALUES
  ('ptiliogonatidae', 'ptiliogonatidae', NULL, '#73596a', '#73596a', NULL, NULL, NULL, 'Silky-flycatchers')
ON CONFLICT (id) DO NOTHING;

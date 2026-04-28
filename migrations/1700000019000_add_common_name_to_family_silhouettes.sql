-- Up Migration
-- Issue #249 — extend family_silhouettes with an English common-name column.
-- NULL is the defensive fallback for unseeded families landing post-deploy
-- (FamilyLegend falls back to prettyFamily(familyCode) on null). The
-- companion data migration 1700000019500 populates the seeded baseline.
ALTER TABLE family_silhouettes ADD COLUMN common_name TEXT NULL;

-- Down Migration
ALTER TABLE family_silhouettes DROP COLUMN common_name;

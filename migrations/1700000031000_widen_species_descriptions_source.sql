-- Up Migration
--
-- Widens the `species_descriptions.source` CHECK to accept the new 'inat'
-- value alongside the original 'wikipedia'. Enables the iNat /v1/taxa
-- `wikipedia_summary` fallback path in `run-descriptions.ts`: when Wikipedia
-- REST returns 404 for a species page, the orchestrator falls back to iNat's
-- per-id taxon endpoint and writes a row with source='inat'. Lifts coverage
-- from ~85% (Wikipedia-only) toward the empirical ~95% ceiling.
--
-- The body length CHECK (50..8192) is unchanged. The license CHECK is
-- unchanged: iNat-fallback rows still license as CC-BY-SA-4.0 because the
-- underlying source is the same Wikipedia article (iNat's `wikipedia_summary`
-- field is plaintext extracted from the article — no relicense, no new
-- rightsholder).
--
-- The original CHECK from migration 30000 is an inline column-level CHECK
-- with no explicit name. Postgres's auto-generated convention for that shape
-- is `<table>_<column>_check` → `species_descriptions_source_check`. Verified
-- empirically (see species-descriptions-inat-source-migration.test.ts: "the
-- auto-generated constraint name is `species_descriptions_source_check`").
ALTER TABLE species_descriptions DROP CONSTRAINT IF EXISTS species_descriptions_source_check;
ALTER TABLE species_descriptions ADD CONSTRAINT species_descriptions_source_check
  CHECK (source IN ('wikipedia', 'inat'));

-- Down Migration
-- Revert to wikipedia-only. IF EXISTS makes the DROP idempotent so a partial
-- rollback retry won't error. Re-adding the original CHECK shape keeps the
-- pre-31000 contract identical for any code that depends on it.
ALTER TABLE species_descriptions DROP CONSTRAINT IF EXISTS species_descriptions_source_check;
ALTER TABLE species_descriptions ADD CONSTRAINT species_descriptions_source_check
  CHECK (source IN ('wikipedia'));

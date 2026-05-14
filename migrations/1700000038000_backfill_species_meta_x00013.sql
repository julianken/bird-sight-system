-- Up Migration
--
-- Issue #527 (PR-1 of 3). Backfills the species_meta row for eBird hybrid
-- code `x00013` ("Bullock's x Baltimore Oriole"), which has been observed in
-- US-AZ since ~2026-05-12 with no matching species_meta parent — tripping
-- the ingest invariant added in #484 (services/ingestor/src/run-ingest.ts:54-63)
-- and exiting the `recent` ingest cron non-zero every 30 minutes for ~40
-- hours before this hotfix lands.
--
-- Root cause is identical to #484: `runTaxonomy` filters eBird's taxonomy
-- stream to `category === 'species'` (services/ingestor/src/run-taxonomy.ts:46),
-- which drops every `hybrid` row. Recent observation ingest
-- (`/data/obs/US-AZ/recent`) is NOT filtered the same way, so hybrid codes
-- flow into `observations` without a matching `species_meta` parent. The
-- invariant correctly refuses the insert; this row unblocks the cron.
--
-- PR-2 and PR-3 of this epic widen `runTaxonomy` to keep hybrid/spuh/slash/
-- form/domestic rows and add alarming so future occurrences surface in
-- minutes instead of hours. Until those land, this single-row backfill is
-- the minimal hotfix.
--
-- Source: eBird taxonomy v2 API,
-- /v2/ref/taxonomy/ebird?species=x00013&fmt=json, queried 2026-05-14.
-- The row carries (speciesCode, comName, sciName, familyCode, familyName,
-- taxonOrder) verbatim from eBird, with familyCode lowercased per the
-- ingestor's existing convention in services/ingestor/src/run-taxonomy.ts:
-- `(t.familySciName ?? t.familyCode ?? '').toLowerCase()` — i.e. 'icteridae'
-- (lowercased `familySciName`), not eBird's raw `familyCode` 'icteri1'.
--
-- Family JOIN: `family_code = 'icteridae'` already exists in
-- `family_silhouettes` per migration 1700000033000, so `silhouette_id` will
-- be non-NULL and the hybrid renders with the icteridae icon and #F4B400
-- color used by Western Meadowlark, the orioles, and the grackles.
--
-- ON CONFLICT DO NOTHING preserves any row a future `runTaxonomy` run might
-- legitimately produce (e.g. if eBird reclassifies the code or PR-2's
-- widened filter lands first).
INSERT INTO species_meta (species_code, com_name, sci_name, family_code, family_name, taxon_order)
VALUES
  -- Bullock's x Baltimore Oriole hybrid. Both parents (Icterus bullockii,
  -- I. galbula) are Icteridae. Observed live in AZ from 2026-05-12.
  ('x00013', 'Bullock''s x Baltimore Oriole (hybrid)', 'Icterus bullockii x galbula', 'icteridae', 'Troupials and Allies', 33771)
ON CONFLICT (species_code) DO NOTHING;

-- Down Migration
--
-- Removes only the single row this migration inserted. Defensive: filters by
-- the exact species_code so a future migration that legitimately adds OTHER
-- icteridae or hybrid rows won't be reverted here.
DELETE FROM species_meta WHERE species_code = 'x00013';

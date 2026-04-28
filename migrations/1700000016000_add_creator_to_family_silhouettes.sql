-- Up Migration
-- Issue #245 (epic #251). Extends `family_silhouettes` with a `creator` text
-- column so that the Phylopic seed migration (1700000017000) can capture
-- per-row creator attribution alongside the silhouette path data, source URL,
-- and license short identifier. Per-silhouette attribution lands in the
-- AttributionModal (#250) — the column is the storage substrate.
--
-- NULL is the defensive value: for families with no usable Phylopic
-- silhouette (Phylopic-less policy from #246), the seed migration explicitly
-- writes NULL into svg_data, source, license, and creator together so the
-- _FALLBACK consumer renders gracefully.
--
-- Slot ordering: this migration MUST run BEFORE 1700000017000_seed_*_phylopic.sql
-- (node-pg-migrate applies files in lexical order — `16000` < `17000`).
-- Otherwise the seed UPDATE that writes `creator` would fail with
-- `column "creator" of relation "family_silhouettes" does not exist`.
--
-- After version-one → main merge that includes this migration AND the
-- companion seed (17000), the operator runs `scripts/purge-silhouettes-cache.sh`
-- (introduced in #252) as part of the production deploy runbook to purge the
-- CDN cache for `/api/silhouettes` so users see real silhouettes immediately
-- instead of waiting for max-age=604800 to expire on stale browser caches.
ALTER TABLE family_silhouettes ADD COLUMN creator TEXT NULL;

-- Down Migration
ALTER TABLE family_silhouettes DROP COLUMN creator;

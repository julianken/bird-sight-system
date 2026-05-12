-- Up Migration
--
-- Issue #482. The 2026-04-26 Phylopic curation (migration 1700000017000)
-- enumerated 25 families but omitted Icteridae, so every icterid observed
-- in AZ (Western Meadowlark, Great-tailed Grackle, Brown-headed Cowbird,
-- Hooded/Bullock's Oriole, Red-winged/Yellow-headed/Brewer's Blackbird)
-- silently dropped out of <FamilyLegend> and rendered the neutral
-- _FALLBACK shape in detail + cluster surfaces. The legend join in
-- frontend/src/components/FamilyLegend.tsx silently skips any family code
-- with no row in family_silhouettes — one root cause, three rendering
-- symptoms.
--
-- Fix: INSERT an icteridae row with a real CC0 Phylopic silhouette
-- (Icteridae family-level node, primary image f783a5c3-8f88-442d-9005-
-- 42791b943d7a, attributed to Matt Wilkins, CC0-1.0).
--
-- Pipeline: the path-d was extracted from the Phylopic vector.svg via the
-- same scripts/curate-phylopic.mjs `extractPathD` routine that produced
-- the 22 other Phylopic-seeded rows in migration 17000 — potrace
-- <g transform=...> flattening + normalize-to-0..24-viewBox. The frontend
-- renderer (frontend/src/components/ds/FamilySilhouette.tsx) sets
-- viewBox="0 0 24 24" when pathD is present, so the coordinate space
-- matches.
--
-- The audit query in the issue body returns ~39 observed AZ families with
-- no silhouette row (alaudidae, hirundinidae, turdidae, vireonidae, etc.).
-- Those land in a follow-up — adding 39 hand-curated Phylopic picks here
-- would exceed this PR's scope and would re-implement what
-- scripts/curate-phylopic.mjs is designed to do at batch. This migration
-- ships icteridae alone because it has the most user-visible impact
-- (49 Western Meadowlark observations live, plus all the orioles and
-- grackles).
--
-- Color: #F4B400 (deep gold) — evokes the Western Meadowlark breast and
-- Hooded Oriole; visually distinct from #E0A82E (fringillidae) and
-- #D4C84A (parulidae).
--
-- common_name: "Blackbirds, Orioles & Allies" — matches the standard
-- ornithological grouping convention used by migration 1700000019500
-- (e.g. "Cardinals & Allies", "Mockingbirds & Thrashers").
--
-- After this migration lands in main, the operator runs
-- scripts/purge-silhouettes-cache.sh (#252) as part of the production
-- deploy runbook to purge the CDN cache for /api/silhouettes so users see
-- the new row immediately instead of waiting for max-age=604800 to expire
-- on stale browser caches.

-- icteridae — CC0-1.0, creator: Matt Wilkins
-- Source: https://www.phylopic.org/images/f783a5c3-8f88-442d-9005-42791b943d7a
INSERT INTO family_silhouettes (id, family_code, svg_data, color, source, license, creator, common_name) VALUES (
  'icteridae',
  'icteridae',
  'M 8.077 0.016 c -0.479 0.034 -1.038 0.187 -1.47 0.402 -0.089 0.044 -0.612 0.243 -1.162 0.443 -0.552 0.2 -1.003 0.367 -1.003 0.372 0 0.013 1.584 0.587 1.663 0.602 0.101 0.019 0.13 0.036 0.258 0.159 0.248 0.239 0.579 0.753 0.918 1.431 l 0.08 0.159 -0.058 0.127 c -0.242 0.527 -0.394 1.128 -0.425 1.675 -0.019 0.347 0.016 0.836 0.089 1.227 0.175 0.948 0.625 1.984 1.293 2.984 0.547 0.819 1.311 1.723 2.053 2.426 0.154 0.146 0.274 0.271 0.268 0.277 -0.006 0.006 -0.276 0.075 -0.597 0.151 -0.56 0.133 -0.595 0.14 -0.836 0.149 l -0.253 0.011 -0.299 -0.149 -0.299 -0.149 -0.178 0.011 c -0.114 0.006 -0.195 0.019 -0.217 0.036 -0.031 0.019 -0.042 0.019 -0.063 0.002 -0.015 -0.011 -0.487 -0.443 -1.05 -0.959 -0.561 -0.514 -1.027 -0.936 -1.034 -0.936 -0.006 0 -0.049 0.034 -0.094 0.075 -0.162 0.146 -0.227 0.313 -0.24 0.623 l -0.008 0.203 0.904 0.852 c 0.497 0.469 0.923 0.871 0.949 0.896 0.034 0.032 0.047 0.065 0.055 0.133 0.006 0.05 0.016 0.091 0.023 0.091 0.005 0 0.026 -0.016 0.047 -0.036 l 0.039 -0.036 0.058 0.06 0.06 0.058 -0.084 0.49 -0.086 0.49 0.037 0.039 c 0.068 0.071 0.346 0.117 0.584 0.092 l 0.118 -0.011 -0.083 -0.028 c -0.092 -0.032 -0.183 -0.092 -0.3 -0.203 l -0.08 -0.075 0.081 -0.261 c 0.044 -0.143 0.083 -0.264 0.088 -0.268 0.003 -0.003 0.125 0.105 0.269 0.242 0.255 0.24 0.266 0.253 0.331 0.394 0.12 0.256 0.258 0.417 0.376 0.44 0.089 0.016 0.097 -0.006 0.026 -0.081 -0.089 -0.094 -0.169 -0.203 -0.123 -0.172 0.018 0.013 0.404 0.375 0.857 0.802 0.555 0.524 0.819 0.785 0.813 0.802 -0.08 0.209 -0.034 0.48 0.102 0.61 l 0.049 0.045 -0.024 -0.07 c -0.029 -0.084 -0.018 -0.247 0.024 -0.37 l 0.028 -0.081 0.414 0.391 c 0.227 0.216 0.482 0.456 0.565 0.534 l 0.151 0.143 -0.097 0.316 c -0.112 0.355 -0.136 0.527 -0.101 0.709 0.026 0.13 0.096 0.266 0.172 0.339 l 0.058 0.057 -0.042 -0.092 c -0.076 -0.166 -0.07 -0.329 0.016 -0.432 0.032 -0.039 0.19 -0.38 0.269 -0.586 l 0.016 -0.039 0.062 0.06 c 0.047 0.045 0.073 0.094 0.105 0.193 0.026 0.073 0.071 0.18 0.104 0.239 0.06 0.109 0.237 0.299 0.294 0.313 0.031 0.008 0.031 0.003 -0.01 -0.076 -0.023 -0.045 -0.058 -0.133 -0.08 -0.195 l -0.039 -0.112 0.036 0.031 c 0.067 0.057 6.09 5.738 6.221 5.867 l 0.131 0.128 0.065 -0.135 c 0.075 -0.154 0.19 -0.29 0.287 -0.341 0.094 -0.047 0.217 -0.044 0.325 0.011 l 0.083 0.042 -0.122 -0.12 c -0.067 -0.067 -0.709 -0.693 -1.428 -1.394 -1.623 -1.582 -2.238 -2.195 -2.267 -2.264 -0.047 -0.115 -0.745 -0.793 -2.685 -2.616 -0.204 -0.19 -0.37 -0.347 -0.37 -0.35 0 -0.013 0.363 -1.009 0.409 -1.121 0.117 -0.284 0.784 -1.759 0.795 -1.754 0.016 0.005 0.678 0.988 0.889 1.321 l 0.177 0.279 0.18 0.63 c 0.605 2.116 1.108 3.386 1.504 3.803 0.211 0.221 0.396 0.144 0.493 -0.204 0.019 -0.071 0.041 -0.135 0.045 -0.141 0.006 -0.006 0.083 0.11 0.172 0.26 0.35 0.589 0.595 0.886 0.68 0.816 0.016 -0.013 0.041 -0.011 0.097 0.01 0.088 0.032 0.122 0.021 0.144 -0.054 0.019 -0.067 0 -0.315 -0.036 -0.477 -0.131 -0.584 -0.623 -1.931 -1.243 -3.406 l -0.427 -1.016 -0.011 -0.962 c -0.006 -0.527 -0.008 -0.961 -0.003 -0.961 0.003 0 0.06 0.071 0.125 0.157 0.133 0.177 0.535 0.686 0.544 0.686 0.003 0 -0.005 -0.042 -0.016 -0.094 -0.013 -0.05 -0.084 -0.363 -0.161 -0.696 -0.733 -3.175 -2.122 -6.448 -3.807 -8.97 -0.414 -0.62 -1.142 -1.59 -1.407 -1.876 -0.062 -0.065 -0.083 -0.114 -0.2 -0.443 -0.133 -0.378 -0.203 -0.522 -0.411 -0.853 -0.284 -0.449 -0.678 -0.883 -1.05 -1.15 -0.511 -0.37 -1.025 -0.558 -1.631 -0.602 -0.23 -0.016 -0.219 -0.016 -0.462 0 z m 3.088 12.723 c 0.438 0.221 1.123 0.471 1.777 0.647 0.227 0.06 0.414 0.114 0.419 0.117 0.003 0.003 -0.023 0.17 -0.058 0.372 -0.164 0.935 -0.471 1.655 -0.892 2.098 l -0.122 0.127 -0.011 -0.068 c -0.015 -0.088 -0.054 -0.128 -0.208 -0.219 -0.227 -0.133 -0.372 -0.182 -0.636 -0.211 l -0.092 -0.01 -1.092 -1.008 c -0.6 -0.553 -1.12 -1.034 -1.154 -1.066 l -0.062 -0.06 0.067 -0.125 0.068 -0.125 0.14 -0.042 c 0.078 -0.023 0.485 -0.146 0.904 -0.274 0.42 -0.127 0.767 -0.232 0.776 -0.234 0.006 0 0.086 0.036 0.178 0.081 z m -2.543 0.169 c 0.06 0.036 0.104 0.083 0.104 0.112 0 0.003 -0.021 0.023 -0.047 0.041 l -0.047 0.034 -0.083 -0.075 -0.084 -0.076 0.036 -0.037 c 0.019 -0.021 0.041 -0.039 0.044 -0.039 0.005 0 0.041 0.018 0.078 0.041 z m 3.472 3.352 c 0.024 0.039 -0.028 0.003 -0.123 -0.084 l -0.105 -0.097 0.109 0.083 c 0.062 0.047 0.114 0.091 0.12 0.099 z',
  '#F4B400',
  'https://www.phylopic.org/images/f783a5c3-8f88-442d-9005-42791b943d7a',
  'CC0-1.0',
  'Matt Wilkins',
  'Blackbirds, Orioles & Allies'
);

-- Down Migration
DELETE FROM family_silhouettes WHERE id = 'icteridae';

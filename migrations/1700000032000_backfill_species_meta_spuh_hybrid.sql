-- Up Migration
--
-- Issue #484. Backfills 10 species_meta rows for eBird hybrid/spuh codes that
-- have been observed in US-AZ but lack a species_meta row, causing
-- /api/species/:code to 404 even though the codes appear in /api/observations.
--
-- Root cause: `runTaxonomy` filters eBird's taxonomy stream to
-- `category === 'species'` (services/ingestor/src/run-taxonomy.ts:46), which
-- drops every `hybrid`, `spuh`, `slash`, `domestic`, and `form` row. Recent
-- observation ingest (`/data/obs/US-AZ/recent`) is NOT filtered the same way,
-- so hybrid codes flow into `observations` without a matching `species_meta`
-- parent. The read-api 404 path is services/read-api/src/app.ts:119.
--
-- The companion fix in this PR adds an ingest-time invariant
-- (services/ingestor/src/run-ingest.ts) that fails the ingest loudly when an
-- observation references a missing `species_meta` row — so any FUTURE eBird
-- hybrid/spuh code that surfaces in the AZ feed will trip the invariant
-- before silently creating another 404, instead of waiting for a user report.
--
-- Family-bucket strategy: every hybrid maps to the lowercased scientific
-- family of its parent species' family (eBird's `familySciName` lowercased).
-- All 5 referenced families (anatidae, cardinalidae, odontophoridae,
-- parulidae, trochilidae) already exist in `family_silhouettes`, so this
-- migration ships zero new silhouettes — observations of these hybrids
-- render with the parent family's existing icon and color.
--
-- Source: eBird taxonomy v2 API,
-- /v2/ref/taxonomy/ebird?species=<codes>&fmt=json, queried 2026-05-12.
-- Each row carries (speciesCode, comName, sciName, familyCode, familyName,
-- taxonOrder) verbatim from eBird, with familyCode lowercased per the
-- ingestor's existing convention in services/ingestor/src/run-taxonomy.ts:
-- `(t.familySciName ?? t.familyCode ?? '').toLowerCase()`.
--
-- ON CONFLICT DO NOTHING preserves any row a future `runTaxonomy` run might
-- legitimately produce (e.g. if eBird reclassifies a code from hybrid → species).
INSERT INTO species_meta (species_code, com_name, sci_name, family_code, family_name, taxon_order)
VALUES
  -- Lazuli x Indigo Bunting hybrid. Both parents (Passerina amoena, P. cyanea)
  -- are Cardinalidae. AZ birders care about this hybrid — keeping it visible.
  ('ixlbun', 'Lazuli x Indigo Bunting (hybrid)', 'Passerina amoena x cyanea', 'cardinalidae', 'Cardinals and Allies', 34609),
  -- Mallard x Mexican Duck hybrid. eBird taxonomy lists this code under
  -- `category=hybrid`, not the domestic-Mallard form (`mallar3`). Both parents
  -- are Anatidae.
  ('mallar4', 'Mallard x Mexican Duck (hybrid)', 'Anas platyrhynchos x diazi', 'anatidae', 'Ducks, Geese, and Waterfowl', 569),
  -- Townsend's x Hermit Warbler hybrid. Both parents are Parulidae.
  ('x00059', 'Townsend''s x Hermit Warbler (hybrid)', 'Setophaga townsendi x occidentalis', 'parulidae', 'New World Warblers', 34213),
  -- Anna's x Costa's Hummingbird hybrid. Both parents are Trochilidae.
  ('x00618', 'Anna''s x Costa''s Hummingbird (hybrid)', 'Calypte anna x costae', 'trochilidae', 'Hummingbirds', 4821),
  -- Scaled x Gambel's Quail hybrid. Both parents are Odontophoridae.
  ('x00689', 'Scaled x Gambel''s Quail (hybrid)', 'Callipepla squamata x gambelii', 'odontophoridae', 'New World Quail', 1111),
  -- Graylag x Canada Goose hybrid. Both parents are Anatidae.
  ('x00758', 'Graylag x Canada Goose (hybrid)', 'Anser anser x Branta canadensis', 'anatidae', 'Ducks, Geese, and Waterfowl', 358),
  -- Graylag x Swan Goose hybrid. Both parents are Anatidae.
  ('x00776', 'Graylag x Swan Goose (hybrid)', 'Anser anser x cygnoides', 'anatidae', 'Ducks, Geese, and Waterfowl', 286),
  -- Broad-billed x White-eared Hummingbird hybrid. Both parents are Trochilidae.
  ('x01129', 'Broad-billed x White-eared Hummingbird (hybrid)', 'Cynanthus latirostris x Basilinna leucotis', 'trochilidae', 'Hummingbirds', 4924),
  -- Broad-billed x Berylline Hummingbird hybrid. Both parents are Trochilidae.
  ('x01172', 'Broad-billed x Berylline Hummingbird (hybrid)', 'Cynanthus latirostris x Saucerottia beryllina', 'trochilidae', 'Hummingbirds', 5065),
  -- Broad-tailed x White-eared Hummingbird hybrid. Both parents are Trochilidae.
  ('x01228', 'Broad-tailed x White-eared Hummingbird (hybrid)', 'Selasphorus platycercus x Basilinna leucotis', 'trochilidae', 'Hummingbirds', 4923)
ON CONFLICT (species_code) DO NOTHING;

-- Down Migration
--
-- Removes only the 10 rows this migration inserted. Defensive: filters by the
-- exact species_code list rather than by sci_name LIKE '% x %', so a future
-- migration that legitimately adds OTHER hybrid rows won't be reverted here.
DELETE FROM species_meta WHERE species_code IN (
  'ixlbun', 'mallar4',
  'x00059', 'x00618', 'x00689', 'x00758', 'x00776',
  'x01129', 'x01172', 'x01228'
);

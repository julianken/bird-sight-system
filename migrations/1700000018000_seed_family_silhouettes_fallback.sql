-- Up Migration
--
-- Issue #246 (epic #251). Adds the `_FALLBACK` row to family_silhouettes —
-- the sprite the MapCanvas symbol layer paints for observations whose family
-- has no usable Phylopic silhouette (either the row doesn't exist, or it
-- exists with svg_data = NULL per migration 1700000017000's Phylopic-less
-- policy).
--
-- Slot ordering: 18000 is between 1700000017000 (Phylopic seed for the 22
-- families with usable silhouettes) and 1700000019000 (commonName schema).
-- Co-located with its consumer (the SDF symbol layer + the silhouettes-
-- prop GeoJSON join in frontend/src/components/map/observation-layers.ts).
--
-- Sort-order note (locale collation): the leading underscore in `_FALLBACK`
-- DOES sort before lowercase letters under ASCII (`COLLATE "C"`) but does
-- NOT under PostgreSQL's default locale-aware collation
-- (en_US.UTF-8 on most installs, which treats underscore as punctuation
-- and skips it in the primary weight). The DB-side `getSilhouettes` query
-- uses `ORDER BY family_code` without an explicit COLLATE, so the row
-- lands in the *locale* position (typically near the start of the
-- alphabet — between 'cuculidae' and 'cyanocittidae' depending on the
-- locale's UCA tailoring). This is intentional: the
-- packages/db-client/src/silhouettes.test.ts parity tests assert the
-- locale order, and the consumer never depends on `_FALLBACK` being first.
-- Don't add `COLLATE "C"` to the SELECT without updating those tests.
--
-- Color: `--color-text-muted` (#555) — the same value FAMILY_COLOR_FALLBACK
-- in frontend/src/data/family-color.ts uses for the resolver miss path.
-- Keeping these in sync means the legend's family-less chip and the map's
-- _FALLBACK silhouette share the same neutral grey.
--
-- SVG: a generic passerine outline at 24-viewBox, single black path so the
-- SDF tint pipeline works (multi-color paths flatten poorly under SDF; see
-- the gotcha note in the issue body). Black-on-transparent is the
-- convention for SDF source images.
--
-- source / license / creator: NULL — this is a hand-drawn generic shape, not
-- a Phylopic asset, so there's nothing to attribute. AttributionModal (#250)
-- already handles NULL creator/license by skipping the row.
INSERT INTO family_silhouettes (id, family_code, svg_data, color, source, license, common_name, creator) VALUES
  (
    '_FALLBACK',
    '_FALLBACK',
    -- Generic passerine outline (head, body, tail), 24-viewBox, single
    -- closed path. Hand-authored to match the visual weight of the
    -- migration-9000 placeholder shapes — readable at 24-28px (the scale
    -- the legend chip and map symbol layer both render at).
    'M 6 12 C 6 9 8 7 11 7 C 13 7 14 8 15 9 L 18 8 L 18 10 L 16 11 L 16 14 L 14 16 L 9 16 L 6 14 Z',
    '#555555',
    NULL,
    NULL,
    'Unknown family',
    NULL
  );

-- Down Migration
DELETE FROM family_silhouettes WHERE id = '_FALLBACK';

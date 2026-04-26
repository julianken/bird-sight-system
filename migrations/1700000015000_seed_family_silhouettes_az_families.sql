-- Up Migration
--
-- Issue #244 (epic #251). Expands the family_silhouettes seed to cover the
-- ~10 highly-common AZ bird families that the original 15-row seed in
-- migration 9000 missed (per the #55 audit). The `_FALLBACK` row stays
-- under #246's scope and lands via migration 1700000018000.
--
-- Without these rows, observations of the listed species fail the JOIN
-- against family_silhouettes during ingest stamping (`silhouette_id` ends up
-- NULL) and the map's symbol layer renders nothing for those families.
--
-- Each row uses a 24-viewBox single-path placeholder SVG matching the style
-- of migration 9000 and a visually distinct neutral color. Real Phylopic
-- silhouettes replace these via UPDATEs in #245 — keeping the geometry to a
-- single 24-viewBox path lets that swap be a clean per-row UPDATE.
--
-- Post-migration behavior:
--   (a) The next taxonomy cron (`ScheduledKind = 'taxonomy'`) triggers
--       `runReconcileStamping` (packages/db-client/src/observations.ts),
--       which backfills `silhouette_id` on existing observations whose
--       `family_code` matches one of the new rows.
--   (b) After version-one → main merge that includes this migration, the
--       operator runs `scripts/purge-silhouettes-cache.sh` (introduced in
--       #252) as part of the production deploy runbook to purge the CDN
--       cache for `/api/silhouettes`. NOT per-PR on version-one — the
--       script targets the production zone, which is fronted by main's
--       deploy.
INSERT INTO family_silhouettes (id, family_code, svg_data, color, source, license) VALUES
('cardinalidae',      'cardinalidae',      'M5 14 C5 9 9 7 13 8 L17 5 L18 7 L17 9 L15 10 L15 14 L13 16 L8 16 L5 14 Z',           '#B0231A', 'placeholder', 'CC0'),
('mimidae',           'mimidae',           'M4 14 C4 10 8 9 12 10 L16 8 L18 10 L16 12 L15 14 L13 16 L8 16 L4 14 Z',              '#8E7B5A', 'placeholder', 'CC0'),
('columbidae',        'columbidae',        'M5 13 C5 10 9 9 13 10 L17 9 L18 11 L17 13 L15 14 L13 16 L9 16 L5 13 Z',              '#A89880', 'placeholder', 'CC0'),
('parulidae',         'parulidae',         'M6 14 C6 10 9 9 12 10 L15 9 L16 11 L15 12 L14 14 L12 15 L9 15 L6 14 Z',              '#D4C84A', 'placeholder', 'CC0'),
('ptilogonatidae',    'ptilogonatidae',    'M5 13 C5 9 9 7 13 8 L17 6 L17 9 L15 10 L15 13 L14 16 L12 17 L8 16 L5 13 Z',          '#1F1F35', 'placeholder', 'CC0'),
('paridae',           'paridae',           'M6 14 C6 11 9 10 12 11 L15 10 L16 12 L15 13 L13 14 L11 15 L9 15 L6 14 Z',             '#4A6FA5', 'placeholder', 'CC0'),
('fringillidae',      'fringillidae',      'M5 14 C5 10 8 9 12 10 L16 9 L17 11 L15 12 L15 14 L13 16 L9 16 L5 14 Z',              '#E0A82E', 'placeholder', 'CC0'),
('caprimulgidae',     'caprimulgidae',     'M3 13 L7 11 Q12 8 17 11 L21 13 L17 14 L13 15 L9 15 L3 14 Z',                          '#3D2E5C', 'placeholder', 'CC0'),
('remizidae',         'remizidae',         'M6 14 C6 11 9 10 12 11 L15 10 L16 11 L15 13 L13 14 L11 14 L9 15 L6 14 Z',             '#9AAE8C', 'placeholder', 'CC0'),
('threskiornithidae', 'threskiornithidae', 'M3 13 C3 10 7 9 12 10 L17 9 L20 7 L21 9 L19 11 L18 13 L16 15 L8 16 L3 13 Z',         '#C56B9D', 'placeholder', 'CC0');

-- Down Migration
DELETE FROM family_silhouettes WHERE id IN (
  'cardinalidae','mimidae','columbidae','parulidae','ptilogonatidae',
  'paridae','fringillidae','caprimulgidae','remizidae','threskiornithidae'
);

-- Up Migration
-- Issue #249 — populate English common names for every family seeded by
-- migration 1700000009000. Names follow standard ornithological grouping
-- (e.g. cardinalidae would render as "Cardinals & Allies" — kept here as
-- an inline reference for any future expansion). Update both this file and
-- packages/db-client/src/silhouettes.test.ts in the same change.
UPDATE family_silhouettes SET common_name = 'Hawks, Eagles & Kites'   WHERE family_code = 'accipitridae';
UPDATE family_silhouettes SET common_name = 'Ducks, Geese & Swans'    WHERE family_code = 'anatidae';
UPDATE family_silhouettes SET common_name = 'Herons & Egrets'         WHERE family_code = 'ardeidae';
UPDATE family_silhouettes SET common_name = 'New World Vultures'      WHERE family_code = 'cathartidae';
UPDATE family_silhouettes SET common_name = 'Crows, Jays & Magpies'   WHERE family_code = 'corvidae';
UPDATE family_silhouettes SET common_name = 'Cuckoos & Roadrunners'   WHERE family_code = 'cuculidae';
UPDATE family_silhouettes SET common_name = 'New World Quail'         WHERE family_code = 'odontophoridae';
UPDATE family_silhouettes SET common_name = 'New World Sparrows'      WHERE family_code = 'passerellidae';
UPDATE family_silhouettes SET common_name = 'Woodpeckers'             WHERE family_code = 'picidae';
UPDATE family_silhouettes SET common_name = 'Sandpipers'              WHERE family_code = 'scolopacidae';
UPDATE family_silhouettes SET common_name = 'Owls'                    WHERE family_code = 'strigidae';
UPDATE family_silhouettes SET common_name = 'Hummingbirds'            WHERE family_code = 'trochilidae';
UPDATE family_silhouettes SET common_name = 'Wrens'                   WHERE family_code = 'troglodytidae';
UPDATE family_silhouettes SET common_name = 'Trogons'                 WHERE family_code = 'trogonidae';
UPDATE family_silhouettes SET common_name = 'Tyrant Flycatchers'      WHERE family_code = 'tyrannidae';

-- Down Migration
UPDATE family_silhouettes SET common_name = NULL
WHERE family_code IN (
  'accipitridae','anatidae','ardeidae','cathartidae','corvidae',
  'cuculidae','odontophoridae','passerellidae','picidae','scolopacidae',
  'strigidae','trochilidae','troglodytidae','trogonidae','tyrannidae'
);

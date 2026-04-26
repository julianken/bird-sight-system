-- Up Migration
-- Issue #249 — populate English common names for every family seeded by
-- migration 1700000009000 (15 baseline) and migration 1700000015000 (10
-- AZ expansion from #244). Names follow standard ornithological grouping.
-- Update both this file and packages/db-client/src/silhouettes.test.ts in
-- the same change; the parity snapshot enforces the mapping at test time.
-- Baseline (migration 9000):
UPDATE family_silhouettes SET common_name = 'Hawks, Eagles & Kites'    WHERE family_code = 'accipitridae';
UPDATE family_silhouettes SET common_name = 'Ducks, Geese & Swans'     WHERE family_code = 'anatidae';
UPDATE family_silhouettes SET common_name = 'Herons & Egrets'          WHERE family_code = 'ardeidae';
UPDATE family_silhouettes SET common_name = 'New World Vultures'       WHERE family_code = 'cathartidae';
UPDATE family_silhouettes SET common_name = 'Crows, Jays & Magpies'    WHERE family_code = 'corvidae';
UPDATE family_silhouettes SET common_name = 'Cuckoos & Roadrunners'    WHERE family_code = 'cuculidae';
UPDATE family_silhouettes SET common_name = 'New World Quail'          WHERE family_code = 'odontophoridae';
UPDATE family_silhouettes SET common_name = 'New World Sparrows'       WHERE family_code = 'passerellidae';
UPDATE family_silhouettes SET common_name = 'Woodpeckers'              WHERE family_code = 'picidae';
UPDATE family_silhouettes SET common_name = 'Sandpipers'               WHERE family_code = 'scolopacidae';
UPDATE family_silhouettes SET common_name = 'Owls'                     WHERE family_code = 'strigidae';
UPDATE family_silhouettes SET common_name = 'Hummingbirds'             WHERE family_code = 'trochilidae';
UPDATE family_silhouettes SET common_name = 'Wrens'                    WHERE family_code = 'troglodytidae';
UPDATE family_silhouettes SET common_name = 'Trogons'                  WHERE family_code = 'trogonidae';
UPDATE family_silhouettes SET common_name = 'Tyrant Flycatchers'       WHERE family_code = 'tyrannidae';
-- AZ expansion (migration 15000, issue #244):
UPDATE family_silhouettes SET common_name = 'Cardinals & Allies'       WHERE family_code = 'cardinalidae';
UPDATE family_silhouettes SET common_name = 'Mockingbirds & Thrashers' WHERE family_code = 'mimidae';
UPDATE family_silhouettes SET common_name = 'Pigeons & Doves'          WHERE family_code = 'columbidae';
UPDATE family_silhouettes SET common_name = 'New World Warblers'       WHERE family_code = 'parulidae';
UPDATE family_silhouettes SET common_name = 'Silky-Flycatchers'        WHERE family_code = 'ptilogonatidae';
UPDATE family_silhouettes SET common_name = 'Tits, Chickadees & Titmice' WHERE family_code = 'paridae';
UPDATE family_silhouettes SET common_name = 'Finches'                  WHERE family_code = 'fringillidae';
UPDATE family_silhouettes SET common_name = 'Nightjars'                WHERE family_code = 'caprimulgidae';
UPDATE family_silhouettes SET common_name = 'Verdins'                  WHERE family_code = 'remizidae';
UPDATE family_silhouettes SET common_name = 'Ibises & Spoonbills'      WHERE family_code = 'threskiornithidae';

-- Down Migration
UPDATE family_silhouettes SET common_name = NULL
WHERE family_code IN (
  'accipitridae','anatidae','ardeidae','cathartidae','corvidae',
  'cuculidae','odontophoridae','passerellidae','picidae','scolopacidae',
  'strigidae','trochilidae','troglodytidae','trogonidae','tyrannidae',
  'cardinalidae','mimidae','columbidae','parulidae','ptilogonatidae',
  'paridae','fringillidae','caprimulgidae','remizidae','threskiornithidae'
);

-- Up Migration
-- Adaptive-grid tile contrast Phase 1 (#570, closes G7).
-- Path B (dual palette): add color_dark column for dark-mode rendering.
-- Task 1 empirically established zero dual-axis failures: every color that
-- fails contrast fails only ONE basemap (light=#f4f1ea OR dark=#0E1116).
-- This makes Path A (single shared hex) infeasible without hue-killing
-- collisions, so we use Path B: separate color_dark column.
--
-- Strategy:
--   Light-failing (24 pastels): color -> darkened hex (passes both basemaps);
--     color_dark -> original hex (the original already passes #0E1116).
--   Dark-failing (22 near-blacks): color -> lightened hex (passes both
--     basemaps); color_dark -> same lightened hex.
--   Families already passing both (19): color unchanged, color_dark = color.
--
-- All replacement hexes computed via HSL darkening/lightening in 1% L steps,
-- first candidate satisfying >= 3:1 against both basemaps selected.
-- See /tmp/phase1-task1-failures.txt for the full failure audit.

ALTER TABLE family_silhouettes ADD COLUMN color_dark VARCHAR(7);

-- Default: color_dark = color (no behavior change for families that pass both)
UPDATE family_silhouettes SET color_dark = color WHERE color IS NOT NULL;

-- -------------------------------------------------------------------------
-- Light-failing entries (24): darken color to pass light basemap >= 3:1.
-- color_dark = original color (which already passes dark basemap >= 3:1).
-- -------------------------------------------------------------------------

UPDATE family_silhouettes SET color = '#a28662', color_dark = '#C2B098' WHERE family_code = 'aegithalidae';
-- was #C2B098 (light=1.87), new color: light=3.04 dark=5.51, color_dark dark=8.97

UPDATE family_silhouettes SET color = '#ac814d', color_dark = '#B89060' WHERE family_code = 'alaudidae';
-- was #B89060 (light=2.59), new color: light=3.10 dark=5.40, color_dark dark=6.48

UPDATE family_silhouettes SET color = '#ab8144', color_dark = '#C9A878' WHERE family_code = 'bombycillidae';
-- was #C9A878 (light=1.99), new color: light=3.13 dark=5.36, color_dark dark=8.43

UPDATE family_silhouettes SET color = '#b78129', color_dark = '#E5C28A' WHERE family_code = 'calcariidae';
-- was #E5C28A (light=1.50), new color: light=3.01 dark=5.57, color_dark dark=11.18

UPDATE family_silhouettes SET color = '#a58455', color_dark = '#BFA682' WHERE family_code = 'charadriidae';
-- was #BFA682 (light=2.07), new color: light=3.09 dark=5.43, color_dark dark=8.10

UPDATE family_silhouettes SET color = '#99876b', color_dark = '#A89880' WHERE family_code = 'columbidae';
-- was #A89880 (light=2.49), new color: light=3.09 dark=5.43, color_dark dark=6.73

UPDATE family_silhouettes SET color = '#b1821a', color_dark = '#E0A82E' WHERE family_code = 'fringillidae';
-- was #E0A82E (light=1.90), new color: light=3.06 dark=5.47, color_dark dark=8.83

UPDATE family_silhouettes SET color = '#4693b6', color_dark = '#5BA0C0' WHERE family_code = 'hirundinidae';
-- was #5BA0C0 (light=2.57), new color: light=3.05 dark=5.50, color_dark dark=6.51

UPDATE family_silhouettes SET color = '#b28300', color_dark = '#F4B400' WHERE family_code = 'icteridae';
-- was #F4B400 (light=1.64), new color: light=3.03 dark=5.53, color_dark dark=10.24

UPDATE family_silhouettes SET color = '#998809', color_dark = '#F4E04D' WHERE family_code = 'icteriidae';
-- was #F4E04D (light=1.19), new color: light=3.17 dark=5.30, color_dark dark=14.06

UPDATE family_silhouettes SET color = '#708fa1', color_dark = '#8FA7B5' WHERE family_code = 'laridae';
-- was #8FA7B5 (light=2.23), new color: light=3.04 dark=5.52, color_dark dark=7.53

UPDATE family_silhouettes SET color = '#958b23', color_dark = '#D4C84A' WHERE family_code = 'parulidae';
-- was #D4C84A (light=1.53), new color: light=3.11 dark=5.40, color_dark dark=10.95

UPDATE family_silhouettes SET color = '#bc7d29', color_dark = '#D4923A' WHERE family_code = 'passerellidae';
-- was #D4923A (light=2.34), new color: light=3.05 dark=5.50, color_dark dark=7.18

UPDATE family_silhouettes SET color = '#b3813a', color_dark = '#E8D4B8' WHERE family_code = 'pelecanidae';
-- was #E8D4B8 (light=1.28), new color: light=3.04 dark=5.51, color_dark dark=13.09

UPDATE family_silhouettes SET color = '#788ca0', color_dark = '#A8B5C2' WHERE family_code = 'polioptilidae';
-- was #A8B5C2 (light=1.85), new color: light=3.07 dark=5.46, color_dark dark=9.05

UPDATE family_silhouettes SET color = '#3b9d4b', color_dark = '#3FA850' WHERE family_code = 'psittacidae';
-- was #3FA850 (light=2.69), new color: light=3.05 dark=5.50, color_dark dark=6.24

UPDATE family_silhouettes SET color = '#3d9790', color_dark = '#4FB8B0' WHERE family_code = 'psittaculidae';
-- was #4FB8B0 (light=2.11), new color: light=3.09 dark=5.43, color_dark dark=7.94

UPDATE family_silhouettes SET color = '#c47484', color_dark = '#E1B8C0' WHERE family_code = 'recurvirostridae';
-- was #E1B8C0 (light=1.58), new color: light=3.01 dark=5.56, color_dark dark=10.64

UPDATE family_silhouettes SET color = '#68964b', color_dark = '#6FA050' WHERE family_code = 'regulidae';
-- was #6FA050 (light=2.73), new color: light=3.08 dark=5.45, color_dark dark=6.14

UPDATE family_silhouettes SET color = '#789166', color_dark = '#9AAE8C' WHERE family_code = 'remizidae';
-- was #9AAE8C (light=2.11), new color: light=3.08 dark=5.44, color_dark dark=7.93

UPDATE family_silhouettes SET color = '#a18199', color_dark = '#A88AA0' WHERE family_code = 'tityridae';
-- was #A88AA0 (light=2.73), new color: light=3.04 dark=5.51, color_dark dark=6.13

UPDATE family_silhouettes SET color = '#c3772d', color_dark = '#C77A2E' WHERE family_code = 'tyrannidae';
-- was #C77A2E (light=2.98), new color: light=3.10 dark=5.40, color_dark dark=5.63

UPDATE family_silhouettes SET color = '#aa8434', color_dark = '#D6B878' WHERE family_code = 'tytonidae';
-- was #D6B878 (light=1.69), new color: light=3.07 dark=5.46, color_dark dark=9.89

UPDATE family_silhouettes SET color = '#769156', color_dark = '#7E9B5C' WHERE family_code = 'vireonidae';
-- was #7E9B5C (light=2.77), new color: light=3.13 dark=5.36, color_dark dark=6.06

-- -------------------------------------------------------------------------
-- Dark-failing entries (22): lighten color to pass dark basemap >= 3:1.
-- New color passes both basemaps; color_dark = new color.
-- -------------------------------------------------------------------------

UPDATE family_silhouettes SET color = '#626262', color_dark = '#626262' WHERE family_code = 'accipitridae';
-- was #222222 (dark=1.19), new color: light=5.41 dark=3.10

UPDATE family_silhouettes SET color = '#686058', color_dark = '#686058' WHERE family_code = 'apodidae';
-- was #36322E (dark=1.49), new color: light=5.47 dark=3.06

UPDATE family_silhouettes SET color = '#6c52a3', color_dark = '#6c52a3' WHERE family_code = 'caprimulgidae';
-- was #3D2E5C (dark=1.57), new color: light=5.52 dark=3.04

UPDATE family_silhouettes SET color = '#b9251b', color_dark = '#b9251b' WHERE family_code = 'cardinalidae';
-- was #B0231A (dark=2.79), new color: light=5.57 dark=3.01

UPDATE family_silhouettes SET color = '#606060', color_dark = '#606060' WHERE family_code = 'cathartidae';
-- was #444444 (dark=1.94), new color: light=5.57 dark=3.01

UPDATE family_silhouettes SET color = '#805939', color_dark = '#805939' WHERE family_code = 'certhiidae';
-- was #6B4A30 (dark=2.38), new color: light=5.47 dark=3.07

UPDATE family_silhouettes SET color = '#5858ac', color_dark = '#5858ac' WHERE family_code = 'corvidae';
-- was #222244 (dark=1.24), new color: light=5.47 dark=3.07

UPDATE family_silhouettes SET color = '#795f29', color_dark = '#795f29' WHERE family_code = 'cuculidae';
-- was #5E4A20 (dark=2.23), new color: light=5.35 dark=3.14

UPDATE family_silhouettes SET color = '#546272', color_dark = '#546272' WHERE family_code = 'falconidae';
-- was #475360 (dark=2.41), new color: light=5.53 dark=3.03

UPDATE family_silhouettes SET color = '#626262', color_dark = '#626262' WHERE family_code = '_FALLBACK';
-- was #555555 (dark=2.54), new color: light=5.41 dark=3.10

UPDATE family_silhouettes SET color = '#4c637a', color_dark = '#4c637a' WHERE family_code = 'gaviidae';
-- was #2B3845 (dark=1.58), new color: light=5.52 dark=3.04

UPDATE family_silhouettes SET color = '#86582c', color_dark = '#86582c' WHERE family_code = 'odontophoridae';
-- was #7A5028 (dark=2.71), new color: light=5.40 dark=3.10

UPDATE family_silhouettes SET color = '#7c5936', color_dark = '#7c5936' WHERE family_code = 'pandionidae';
-- was #4A3520 (dark=1.64), new color: light=5.58 dark=3.01

UPDATE family_silhouettes SET color = '#51665e', color_dark = '#51665e' WHERE family_code = 'phalacrocoracidae';
-- was #26302C (dark=1.39), new color: light=5.46 dark=3.07

UPDATE family_silhouettes SET color = '#406a65', color_dark = '#406a65' WHERE family_code = 'podicipedidae';
-- was #2F4D4A (dark=2.05), new color: light=5.37 dark=3.12

UPDATE family_silhouettes SET color = '#73596a', color_dark = '#73596a' WHERE family_code = 'ptiliogonatidae';
-- was #1A1418 (dark=1.04), new color: light=5.53 dark=3.03

UPDATE family_silhouettes SET color = '#5b5b9c', color_dark = '#5b5b9c' WHERE family_code = 'ptilogonatidae';
-- was #1F1F35 (dark=1.18), new color: light=5.44 dark=3.08

UPDATE family_silhouettes SET color = '#63605a', color_dark = '#63605a' WHERE family_code = 'rallidae';
-- was #403E3A (dark=1.77), new color: light=5.56 dark=3.02

UPDATE family_silhouettes SET color = '#725e35', color_dark = '#725e35' WHERE family_code = 'strigidae';
-- was #5A4A2A (dark=2.20), new color: light=5.53 dark=3.03

UPDATE family_silhouettes SET color = '#6b5885', color_dark = '#6b5885' WHERE family_code = 'sturnidae';
-- was #2D2538 (dark=1.29), new color: light=5.54 dark=3.03

UPDATE family_silhouettes SET color = '#9637ad', color_dark = '#9637ad' WHERE family_code = 'trochilidae';
-- was #7B2D8E (dark=2.35), new color: light=5.40 dark=3.10

UPDATE family_silhouettes SET color = '#86582c', color_dark = '#86582c' WHERE family_code = 'troglodytidae';
-- was #7A5028 (dark=2.71), new color: light=5.40 dark=3.10

-- Add NOT NULL constraint after populating
ALTER TABLE family_silhouettes ALTER COLUMN color_dark SET NOT NULL;

-- Down Migration
ALTER TABLE family_silhouettes DROP COLUMN color_dark;

-- Restore original light-failing colors
UPDATE family_silhouettes SET color = '#C2B098' WHERE family_code = 'aegithalidae';
UPDATE family_silhouettes SET color = '#B89060' WHERE family_code = 'alaudidae';
UPDATE family_silhouettes SET color = '#C9A878' WHERE family_code = 'bombycillidae';
UPDATE family_silhouettes SET color = '#E5C28A' WHERE family_code = 'calcariidae';
UPDATE family_silhouettes SET color = '#BFA682' WHERE family_code = 'charadriidae';
UPDATE family_silhouettes SET color = '#A89880' WHERE family_code = 'columbidae';
UPDATE family_silhouettes SET color = '#E0A82E' WHERE family_code = 'fringillidae';
UPDATE family_silhouettes SET color = '#5BA0C0' WHERE family_code = 'hirundinidae';
UPDATE family_silhouettes SET color = '#F4B400' WHERE family_code = 'icteridae';
UPDATE family_silhouettes SET color = '#F4E04D' WHERE family_code = 'icteriidae';
UPDATE family_silhouettes SET color = '#8FA7B5' WHERE family_code = 'laridae';
UPDATE family_silhouettes SET color = '#D4C84A' WHERE family_code = 'parulidae';
UPDATE family_silhouettes SET color = '#D4923A' WHERE family_code = 'passerellidae';
UPDATE family_silhouettes SET color = '#E8D4B8' WHERE family_code = 'pelecanidae';
UPDATE family_silhouettes SET color = '#A8B5C2' WHERE family_code = 'polioptilidae';
UPDATE family_silhouettes SET color = '#3FA850' WHERE family_code = 'psittacidae';
UPDATE family_silhouettes SET color = '#4FB8B0' WHERE family_code = 'psittaculidae';
UPDATE family_silhouettes SET color = '#E1B8C0' WHERE family_code = 'recurvirostridae';
UPDATE family_silhouettes SET color = '#6FA050' WHERE family_code = 'regulidae';
UPDATE family_silhouettes SET color = '#9AAE8C' WHERE family_code = 'remizidae';
UPDATE family_silhouettes SET color = '#A88AA0' WHERE family_code = 'tityridae';
UPDATE family_silhouettes SET color = '#C77A2E' WHERE family_code = 'tyrannidae';
UPDATE family_silhouettes SET color = '#D6B878' WHERE family_code = 'tytonidae';
UPDATE family_silhouettes SET color = '#7E9B5C' WHERE family_code = 'vireonidae';

-- Restore original dark-failing colors
UPDATE family_silhouettes SET color = '#222222' WHERE family_code = 'accipitridae';
UPDATE family_silhouettes SET color = '#36322E' WHERE family_code = 'apodidae';
UPDATE family_silhouettes SET color = '#3D2E5C' WHERE family_code = 'caprimulgidae';
UPDATE family_silhouettes SET color = '#B0231A' WHERE family_code = 'cardinalidae';
UPDATE family_silhouettes SET color = '#444444' WHERE family_code = 'cathartidae';
UPDATE family_silhouettes SET color = '#6B4A30' WHERE family_code = 'certhiidae';
UPDATE family_silhouettes SET color = '#222244' WHERE family_code = 'corvidae';
UPDATE family_silhouettes SET color = '#5E4A20' WHERE family_code = 'cuculidae';
UPDATE family_silhouettes SET color = '#475360' WHERE family_code = 'falconidae';
UPDATE family_silhouettes SET color = '#555555' WHERE family_code = '_FALLBACK';
UPDATE family_silhouettes SET color = '#2B3845' WHERE family_code = 'gaviidae';
UPDATE family_silhouettes SET color = '#7A5028' WHERE family_code = 'odontophoridae';
UPDATE family_silhouettes SET color = '#4A3520' WHERE family_code = 'pandionidae';
UPDATE family_silhouettes SET color = '#26302C' WHERE family_code = 'phalacrocoracidae';
UPDATE family_silhouettes SET color = '#2F4D4A' WHERE family_code = 'podicipedidae';
UPDATE family_silhouettes SET color = '#1A1418' WHERE family_code = 'ptiliogonatidae';
UPDATE family_silhouettes SET color = '#1F1F35' WHERE family_code = 'ptilogonatidae';
UPDATE family_silhouettes SET color = '#403E3A' WHERE family_code = 'rallidae';
UPDATE family_silhouettes SET color = '#5A4A2A' WHERE family_code = 'strigidae';
UPDATE family_silhouettes SET color = '#2D2538' WHERE family_code = 'sturnidae';
UPDATE family_silhouettes SET color = '#7B2D8E' WHERE family_code = 'trochilidae';
UPDATE family_silhouettes SET color = '#7A5028' WHERE family_code = 'troglodytidae';

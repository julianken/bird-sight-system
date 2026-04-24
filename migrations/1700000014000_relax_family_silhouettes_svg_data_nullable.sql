-- Up Migration
ALTER TABLE family_silhouettes ALTER COLUMN svg_data DROP NOT NULL;

-- Down Migration
ALTER TABLE family_silhouettes ALTER COLUMN svg_data SET NOT NULL;

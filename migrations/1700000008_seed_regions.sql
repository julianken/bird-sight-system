-- Up Migration
INSERT INTO regions (id, name, parent_id, geom, display_color, svg_path) VALUES

('colorado-plateau',
 'Colorado Plateau',
 NULL,
 ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((-114.05 35.85, -109.05 35.85, -109.05 37.00, -114.05 37.00, -114.05 35.85)))'), 4326),
 '#C77A2E',
 'M 20 20 L 340 20 L 340 110 L 20 110 Z'),

('grand-canyon',
 'Grand Canyon',
 'colorado-plateau',
 ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((-114.00 35.85, -111.50 35.85, -111.50 36.50, -114.00 36.50, -114.00 35.85)))'), 4326),
 '#9B5E20',
 'M 60 40 L 130 40 L 130 80 L 60 80 Z'),

('mogollon-rim',
 'Mogollon Rim',
 NULL,
 ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((-114.05 33.50, -109.05 33.50, -109.05 35.85, -114.05 35.85, -114.05 33.50)))'), 4326),
 '#5A6B2A',
 'M 20 110 L 340 110 L 340 170 L 20 170 Z'),

('sonoran-phoenix',
 'Sonoran — Phoenix',
 NULL,
 ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((-113.50 32.50, -111.00 32.50, -111.00 34.00, -113.50 34.00, -113.50 32.50)))'), 4326),
 '#D4923A',
 'M 20 170 L 200 170 L 200 260 L 20 260 Z'),

('lower-colorado',
 'Lower Colorado / Mojave',
 NULL,
 ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((-114.80 32.50, -113.50 32.50, -113.50 35.00, -114.80 35.00, -114.80 32.50)))'), 4326),
 '#B07020',
 'M 20 260 L 90 260 L 90 360 L 20 360 Z'),

('sonoran-tucson',
 'Sonoran — Tucson',
 NULL,
 ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((-112.00 32.00, -110.00 32.00, -110.00 33.00, -112.00 33.00, -112.00 32.00)))'), 4326),
 '#E0A040',
 'M 90 260 L 240 260 L 240 360 L 90 360 Z'),

('sky-islands-santa-ritas',
 'Sky Islands — Santa Ritas',
 NULL,
 ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((-111.20 31.50, -110.60 31.50, -110.60 32.00, -111.20 32.00, -111.20 31.50)))'), 4326),
 '#FF0808',
 'M 200 170 L 340 170 L 340 215 L 200 215 Z'),

('sky-islands-huachucas',
 'Sky Islands — Huachucas',
 NULL,
 ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((-110.60 31.30, -110.10 31.30, -110.10 31.70, -110.60 31.70, -110.60 31.30)))'), 4326),
 '#FF0808',
 'M 200 215 L 270 215 L 270 260 L 200 260 Z'),

('sky-islands-chiricahuas',
 'Sky Islands — Chiricahuas',
 NULL,
 ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((-109.40 31.70, -109.00 31.70, -109.00 32.10, -109.40 32.10, -109.40 31.70)))'), 4326),
 '#FF0808',
 'M 270 215 L 340 215 L 340 260 L 270 260 Z');

-- Down Migration
DELETE FROM regions WHERE id IN (
  'colorado-plateau','grand-canyon','mogollon-rim','sonoran-phoenix',
  'lower-colorado','sonoran-tucson','sky-islands-santa-ritas',
  'sky-islands-huachucas','sky-islands-chiricahuas'
);

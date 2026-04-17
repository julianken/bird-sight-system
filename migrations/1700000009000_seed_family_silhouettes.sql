-- Up Migration
INSERT INTO family_silhouettes (id, family_code, svg_data, color, source, license) VALUES
('passerellidae',  'passerellidae',  'M5 14 C5 9 9 7 13 8 L17 6 L17 9 L15 10 L15 14 L13 16 L8 16 L5 14 Z', '#D4923A', 'placeholder', 'CC0'),
('trochilidae',    'trochilidae',    'M3 13 L8 11 L13 12 L18 9 L22 11 L18 13 L13 14 L8 14 L3 15 Z',          '#7B2D8E', 'placeholder', 'CC0'),
('accipitridae',   'accipitridae',   'M2 12 L8 9 Q12 5 16 9 L22 12 L16 12 L14 15 L10 15 L8 12 Z',             '#222222', 'placeholder', 'CC0'),
('strigidae',      'strigidae',      'M6 14 C6 9 10 8 14 9 C18 8 18 14 14 16 L10 16 L6 14 Z',                 '#5A4A2A', 'placeholder', 'CC0'),
('ardeidae',       'ardeidae',       'M4 14 C4 11 8 9 13 10 L18 9 L19 7 L20 9 L19 11 L18 12 L18 15 L15 17 L7 17 L4 14 Z', '#5A6B2A', 'placeholder', 'CC0'),
('anatidae',       'anatidae',       'M3 14 C3 11 8 11 12 12 L18 11 L20 14 L18 16 L8 16 L3 14 Z',             '#3A6B8E', 'placeholder', 'CC0'),
('scolopacidae',   'scolopacidae',   'M5 14 L8 12 L13 13 L17 12 L19 14 L17 15 L13 15 L8 15 L5 16 Z',          '#9B7B3A', 'placeholder', 'CC0'),
('picidae',        'picidae',        'M6 13 C6 9 10 8 13 9 L16 7 L17 9 L15 11 L15 14 L13 16 L8 16 L6 13 Z',   '#FF0808', 'placeholder', 'CC0'),
('corvidae',       'corvidae',       'M4 13 L8 10 Q12 7 16 10 L20 13 L16 14 L14 16 L10 16 L8 13 Z',           '#222244', 'placeholder', 'CC0'),
('odontophoridae', 'odontophoridae', 'M5 15 C5 12 9 11 13 12 C17 11 18 14 17 16 L8 17 L5 15 Z',               '#7A5028', 'placeholder', 'CC0'),
('cathartidae',    'cathartidae',    'M2 12 L8 10 Q12 8 16 10 L22 12 L16 12 L14 14 L10 14 L8 12 Z',           '#444444', 'placeholder', 'CC0'),
('tyrannidae',     'tyrannidae',     'M5 13 C5 9 9 8 13 9 L17 7 L17 10 L15 11 L15 14 L13 15 L8 15 L5 13 Z',   '#C77A2E', 'placeholder', 'CC0'),
('troglodytidae',  'troglodytidae',  'M6 14 C6 11 9 10 12 11 L15 10 L15 13 L12 15 L8 15 L6 14 Z',             '#7A5028', 'placeholder', 'CC0'),
('cuculidae',      'cuculidae',      'M3 13 L7 11 L12 12 L18 10 L20 12 L18 14 L14 14 L9 15 L3 14 Z',          '#5E4A20', 'placeholder', 'CC0'),
('trogonidae',     'trogonidae',     'M5 13 C5 10 9 9 13 10 L17 9 L17 11 L15 12 L15 15 L13 17 L9 17 L5 13 Z', '#FF0808', 'placeholder', 'CC0');

-- Down Migration
DELETE FROM family_silhouettes WHERE id IN (
  'passerellidae','trochilidae','accipitridae','strigidae','ardeidae',
  'anatidae','scolopacidae','picidae','corvidae','odontophoridae',
  'cathartidae','tyrannidae','troglodytidae','cuculidae','trogonidae'
);

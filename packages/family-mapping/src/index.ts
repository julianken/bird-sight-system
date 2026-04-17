export const FALLBACK_FAMILY = 'passerellidae';

const FAMILY_TO_SILHOUETTE: Record<string, string> = {
  passerellidae: 'passerellidae',
  trochilidae: 'trochilidae',
  accipitridae: 'accipitridae',
  strigidae: 'strigidae',
  ardeidae: 'ardeidae',
  anatidae: 'anatidae',
  scolopacidae: 'scolopacidae',
  picidae: 'picidae',
  corvidae: 'corvidae',
  odontophoridae: 'odontophoridae',
  cathartidae: 'cathartidae',
  tyrannidae: 'tyrannidae',
  troglodytidae: 'troglodytidae',
  cuculidae: 'cuculidae',
  trogonidae: 'trogonidae',
};

const FAMILY_TO_COLOR: Record<string, string> = {
  passerellidae: '#D4923A',
  trochilidae: '#7B2D8E',
  accipitridae: '#222222',
  strigidae: '#5A4A2A',
  ardeidae: '#5A6B2A',
  anatidae: '#3A6B8E',
  scolopacidae: '#9B7B3A',
  picidae: '#FF0808',
  corvidae: '#222244',
  odontophoridae: '#7A5028',
  cathartidae: '#444444',
  tyrannidae: '#C77A2E',
  troglodytidae: '#7A5028',
  cuculidae: '#5E4A20',
  trogonidae: '#FF0808',
};

const FALLBACK_COLOR = '#888888';

export function silhouetteForFamily(familyCode: string): string {
  return FAMILY_TO_SILHOUETTE[familyCode.toLowerCase()] ?? FALLBACK_FAMILY;
}

export function colorForFamily(familyCode: string): string {
  return FAMILY_TO_COLOR[familyCode.toLowerCase()] ?? FALLBACK_COLOR;
}

export function listMappedFamilies(): readonly string[] {
  return Object.keys(FAMILY_TO_SILHOUETTE);
}

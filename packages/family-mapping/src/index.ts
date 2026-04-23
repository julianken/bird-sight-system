// Family → color mapping was removed by issue #55 option (a): the DB-backed
// `family_silhouettes` table is now the single source of truth, fetched via
// the Read API's `/api/silhouettes` route. Frontend callers resolve color via
// `frontend/src/data/family-color.ts`'s `buildFamilyColorResolver`. This
// package retains the silhouette-ID mapping (static per deploy, keyed to
// bundled SVG assets) until the Phylopic silhouette curation track also
// moves under the DB. Do NOT re-add FAMILY_TO_COLOR here.

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

export function silhouetteForFamily(familyCode: string): string {
  return FAMILY_TO_SILHOUETTE[familyCode.toLowerCase()] ?? FALLBACK_FAMILY;
}

export function listMappedFamilies(): readonly string[] {
  return Object.keys(FAMILY_TO_SILHOUETTE);
}

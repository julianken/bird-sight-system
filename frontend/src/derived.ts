import type { Observation } from '@bird-watch/shared-types';
import type { FamilyOption, SpeciesOption } from './components/FiltersBar.js';

// Issue #57 — first-class familyCode.
//
// Previously this module fell back to `silhouetteId` when `familyCode`
// was absent, leaning on the seed-time equality
// `family_silhouettes.id == family_code`. That equality is not a contract
// — it breaks silently the moment a silhouette id diverges from a family
// code (e.g. per-subfamily silhouettes). The Read API now projects
// `familyCode` directly from `species_meta` via a LEFT JOIN, so this
// module reads `familyCode` as the single source of truth for the family
// bucket.
//
// Nullability is load-bearing:
//   - LEFT JOIN yields NULL when species_meta is missing a species row
//     — the data-gap signal is preserved end-to-end.
//   - Stale CDN responses predating this field deserialize with
//     `familyCode === undefined`; the falsy guards below treat `null`
//     and `undefined` identically, so no cache bump is required.

export function deriveFamilies(observations: Observation[]): FamilyOption[] {
  const set = new Map<string, string>();
  for (const o of observations) {
    // Skip observations with no resolvable family — do NOT bucket them
    // under a synthetic `""`/`undefined` family.
    if (!o.familyCode) continue;
    set.set(o.familyCode, o.familyCode);
  }
  return Array.from(set.entries())
    .map(([code]) => ({ code, name: prettyFamily(code) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function deriveSpeciesIndex(observations: Observation[]): SpeciesOption[] {
  // One entry per speciesCode. First occurrence wins for comName +
  // taxonOrder + familyCode; observations of the same species rarely
  // disagree on these, and a later observation lacking taxonOrder must
  // not overwrite an earlier one that has it (null-last sort relies on
  // a stable taxonOrder per species).
  const byCode = new Map<
    string,
    { code: string; comName: string; taxonOrder: number | null; familyCode: string | null }
  >();
  for (const o of observations) {
    if (byCode.has(o.speciesCode)) continue;
    byCode.set(o.speciesCode, {
      code: o.speciesCode,
      comName: o.comName,
      taxonOrder: o.taxonOrder ?? null,
      familyCode: o.familyCode ?? null,
    });
  }
  return Array.from(byCode.values()).sort((a, b) => a.comName.localeCompare(b.comName));
}

// Exported for reuse in SpeciesAutocomplete family group headers.
// Note: we only capitalize the family code — we have no vernacular dictionary
// to map codes like "Tyrannidae" → "Tyrant Flycatchers". A future enhancement
// could add a static map if the display name matters more than simplicity.
export function prettyFamily(code: string): string {
  return code.charAt(0).toUpperCase() + code.slice(1);
}

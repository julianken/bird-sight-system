import type { Observation } from '@bird-watch/shared-types';
import type { FamilyOption, SpeciesOption } from './components/FiltersBar.js';

// COUPLING NOTE (Plan 3 scope, not 4c):
// deriveFamilies uses o.silhouetteId as a proxy for the family code.
// This works today because the seed migration (1700000009000_seed_family_silhouettes.sql)
// sets family_silhouettes.id == family_code, and the ingestor stamps observations.silhouette_id
// via `JOIN family_silhouettes fs ON fs.family_code = sm.family_code` (services/ingestor/src/upsert.ts).
// If the silhouette IDs ever diverge from family codes (e.g. a Phylopic migration renames them),
// this function will group by silhouette bucket instead of taxonomic family.
//
// The correct fix is to add `familyCode` to the Observation DTO in packages/shared-types/src/index.ts
// and join sm.family_code in the getObservations query (packages/db-client/src/observations.ts).
// That join already exists (LEFT JOIN species_meta sm) — it just doesn't SELECT sm.family_code yet.
// Deferring to Plan 3 because it changes the API surface and shared-types contract.
export function deriveFamilies(observations: Observation[]): FamilyOption[] {
  const set = new Map<string, string>();
  for (const o of observations) {
    if (o.silhouetteId) set.set(o.silhouetteId, o.silhouetteId);
  }
  return Array.from(set.entries())
    .map(([code]) => ({ code, name: prettyFamily(code) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function deriveSpeciesIndex(observations: Observation[]): SpeciesOption[] {
  const set = new Map<string, string>();
  for (const o of observations) {
    if (!set.has(o.speciesCode)) set.set(o.speciesCode, o.comName);
  }
  return Array.from(set.entries())
    .map(([code, comName]) => ({ code, comName }))
    .sort((a, b) => a.comName.localeCompare(b.comName));
}

function prettyFamily(code: string): string {
  return code.charAt(0).toUpperCase() + code.slice(1);
}

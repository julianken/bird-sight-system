import type { Observation } from '@bird-watch/shared-types';
import type { FamilyOption, SpeciesOption } from './components/FiltersBar.js';

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

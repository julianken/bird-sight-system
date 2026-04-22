import type { Observation } from '@bird-watch/shared-types';
import type { FamilyOption, SpeciesOption } from './components/FiltersBar.js';

// Coupling history (Plan 6 Task 10 minimally decouples — full resolution
// tracked in #57):
//
// The seed migration (1700000009000_seed_family_silhouettes.sql) sets
// family_silhouettes.id == family_code, and the ingestor stamps
// observations.silhouette_id via the family_silhouettes JOIN
// (packages/db-client/src/observations.ts:62–67). Before Plan 6 Task 10
// we leaned on that equality and used silhouetteId directly as a family
// bucket. Plan 6 Task 10 flips the precedence: read
// observation.familyCode first and fall back to silhouetteId only when
// familyCode is null/absent. The Observation wire type now carries an
// optional familyCode (packages/shared-types/src/index.ts) that the
// read-api can populate without a frontend rev; today it's absent and
// the silhouetteId path still delivers the family bucket.
//
// When the ingestor/Read-API begins populating observation.familyCode
// directly, the silhouette fallback becomes dead-but-harmless — #57
// resolves when silhouetteId is detached from the family surface entirely.

/** Resolve the family bucket for a single observation. */
function familyFor(o: Observation): string | null {
  if (o.familyCode) return o.familyCode;
  if (o.silhouetteId) return o.silhouetteId;
  return null;
}

export function deriveFamilies(observations: Observation[]): FamilyOption[] {
  const set = new Map<string, string>();
  for (const o of observations) {
    const code = familyFor(o);
    if (code) set.set(code, code);
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
      familyCode: familyFor(o),
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

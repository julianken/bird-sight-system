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

// Exported for reuse across surfaces that surface a family label (FiltersBar
// option label, MapSurface lede + cell/marker popovers, AttributionModal
// Phylopic section). Pre-#688 this also fed the species autocomplete's family group
// headers; that component was deleted but the function still has 9+ live
// consumers across kept surfaces.
//
// This is the TERMINAL FALLBACK in the family-name resolver chain, NOT the
// primary display path. A vernacular dictionary DOES exist: every observed
// family has a curated colloquial name in `family_silhouettes.common_name`
// (e.g. `tyrannidae` → "Tyrant Flycatchers"), reachable on the map via the
// `/api/silhouettes` payload the app already fetches; the longer official
// eBird name lives in `species_meta.family_name`. The shared `resolveFamilyName`
// helper (issue #920) resolves `family.name ?? silhouette.commonName ??
// prettyFamily(familyCode)`, so `prettyFamily` only runs when neither dictionary
// has an entry — e.g. a brand-new family observed before its silhouette row
// exists. It just capitalizes the lowercased `family_code` so that last-resort
// case still renders something legible instead of `tyrannidae`.
export function prettyFamily(code: string): string {
  // Defensive: a missing/empty code (malformed data, a stale-shape bucket) must
  // not crash a render. Return '' rather than throwing on `undefined`/empty.
  if (!code) return '';
  return code.charAt(0).toUpperCase() + code.slice(1);
}

/**
 * Resolve a family's display name from the unified colloquial-name chain
 * (issue #920, epic #924):
 *
 *   family.name ?? silhouette.commonName ?? prettyFamily(familyCode)
 *
 * - `name` (`AggregatedFamily.name`) is the drift-proof server projection
 *   `COALESCE(family_silhouettes.common_name, species_meta.family_name)`. It is
 *   undefined until PR4 populates it — accepting the arg NOW means PR4 is a pure
 *   server-side upgrade with zero call-site churn.
 * - `commonName` (`FamilySilhouette.commonName`, from `/api/silhouettes` which
 *   the app already fetches) covers all 95 observed families today and delivers
 *   the entire visible win — exactly what `FamilyLegend.tsx` already does.
 * - `prettyFamily(familyCode)` stays the terminal fallback. It must never return
 *   `''` for a real code (its existing empty-code guard is preserved), so an
 *   unseeded family still gets a capitalized scientific label rather than a
 *   blank header.
 *
 * Both name inputs are nullish-coalesced, so an explicit `null` (the DB / wire
 * absence value) falls through identically to `undefined`.
 */
export function resolveFamilyName(
  familyCode: string,
  // The value types include `undefined` (not just the `?` presence flag) so a
  // direct `silhouette?.commonName` access — which is `string | null | undefined`
  // — type-checks under `exactOptionalPropertyTypes: true` without forcing every
  // caller to coalesce first.
  opts?: { name?: string | null | undefined; commonName?: string | null | undefined },
): string {
  return opts?.name ?? opts?.commonName ?? prettyFamily(familyCode);
}

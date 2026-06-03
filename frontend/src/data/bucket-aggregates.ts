import type { AggregatedBucket, AggregatedFamily } from '@bird-watch/shared-types';
import type { FamilyAggregate, SpeciesAggregate } from '../components/map/adaptive-grid.js';
import type { SpeciesDictionary } from './use-species-dictionary.js';
import type { FamilyOption } from '../components/FiltersBar.js';
import { prettyFamily } from '../derived.js';

/**
 * Pure aggregation helpers for the #859 low-zoom (aggregated) render path.
 *
 * Each `AggregatedBucket` carries its own families with exact counts and the
 * top-8 species per family (codes only — names live in the species dictionary).
 * These helpers (1) merge a cluster's member-bucket families client-side, (2)
 * resolve species codes to display rows via the dictionary, and (3) derive the
 * EXACT per-family / total counts the family legend and the "{N} species" copy
 * read — never the capped species-list length (#852 consistency).
 */

/**
 * Display cap for a family's species rows in a popover. Mirrors the backend's
 * `TOP_SPECIES_PER_FAMILY` (packages/db-client/src/observations.ts) so a merged
 * cluster re-caps to the same ceiling a single bucket already obeys.
 */
export const TOP_SPECIES_PER_FAMILY = 8;

/**
 * Merge the per-bucket `families` of several buckets into a single
 * `AggregatedFamily[]` — the client-side counterpart of the server-side
 * aggregation, run when a maplibre cluster groups multiple bucket-features.
 *
 * - `count` is summed exactly per family across the input buckets.
 * - `speciesCount` is summed across buckets. This is APPROXIMATE — a species
 *   present in two cells is counted in each cell's `speciesCount`, so the
 *   merged total can exceed the true distinct-species count. Accepted per #859:
 *   it only feeds the "+N more" overflow hint, where a slight over-count is
 *   harmless (the drill-in re-queries exact data at higher zoom).
 * - `species` is merged by code (summing counts), re-sorted by summed count
 *   desc (ties by code asc), and re-capped to TOP_SPECIES_PER_FAMILY.
 * - Families are ordered by summed observation count desc (ties by code asc),
 *   matching the wire ordering of a single bucket.
 */
export function mergeBucketFamilies(
  bucketFamilies: ReadonlyArray<ReadonlyArray<AggregatedFamily>>,
): AggregatedFamily[] {
  const byFamily = new Map<
    string,
    { count: number; speciesCount: number; species: Map<string, number> }
  >();

  for (const families of bucketFamilies) {
    for (const f of families) {
      let agg = byFamily.get(f.code);
      if (!agg) {
        agg = { count: 0, speciesCount: 0, species: new Map() };
        byFamily.set(f.code, agg);
      }
      agg.count += f.count;
      agg.speciesCount += f.speciesCount;
      for (const s of f.species) {
        agg.species.set(s.code, (agg.species.get(s.code) ?? 0) + s.count);
      }
    }
  }

  const out: AggregatedFamily[] = [];
  for (const [code, agg] of byFamily) {
    const species = Array.from(agg.species, ([c, count]) => ({ code: c, count }))
      .sort((a, b) => (a.count !== b.count ? b.count - a.count : a.code.localeCompare(b.code)))
      .slice(0, TOP_SPECIES_PER_FAMILY);
    out.push({ code, count: agg.count, speciesCount: agg.speciesCount, species });
  }
  out.sort((a, b) => (a.count !== b.count ? b.count - a.count : a.code.localeCompare(b.code)));
  return out;
}

/**
 * Resolve a family's capped `species` codes into popover rows
 * (`SpeciesAggregate`). The common name comes from the dictionary; when a code
 * is missing (cold dictionary, or a species absent from the dict) the row falls
 * back to the bare code — NEVER the Latin family code, and never a crash. The
 * `speciesCode` is always the real eBird code, so the row links to a working
 * species detail.
 *
 * Input is already sorted by count desc (from the wire / `mergeBucketFamilies`);
 * the order is preserved.
 */
export function resolveSpeciesRows(
  family: AggregatedFamily,
  dictionary: SpeciesDictionary,
): SpeciesAggregate[] {
  return family.species.map(s => ({
    speciesCode: s.code,
    comName: dictionary.get(s.code)?.comName ?? s.code,
    count: s.count,
  }));
}

/**
 * EXACT per-family observation counts across every bucket in view, summed from
 * `families[].count`. This is the family legend's source of truth (#859 F):
 * the capped species list is NEVER counted, and a family present in ANY bucket
 * appears with its true total.
 */
export function familyCountsFromBuckets(
  buckets: ReadonlyArray<AggregatedBucket>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const b of buckets) {
    for (const f of b.families) {
      counts.set(f.code, (counts.get(f.code) ?? 0) + f.count);
    }
  }
  return counts;
}

/**
 * Family options (code + display name) for every family present in any bucket,
 * sorted by display name — the aggregated-mode analogue of
 * `deriveFamilies(observations)`.
 */
export function deriveFamiliesFromBuckets(
  buckets: ReadonlyArray<AggregatedBucket>,
): FamilyOption[] {
  const codes = new Set<string>();
  for (const b of buckets) for (const f of b.families) codes.add(f.code);
  return Array.from(codes)
    .map(code => ({ code, name: prettyFamily(code) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Exact total observation count across all buckets (sum of bucket.count). */
export function totalCountFromBuckets(buckets: ReadonlyArray<AggregatedBucket>): number {
  let total = 0;
  for (const b of buckets) total += b.count;
  return total;
}

/** A maplibre cluster leaf — only its serialized bucket families are read. */
interface LeafWithFamilies {
  properties?: { familiesJson?: unknown } | null;
}

/** Resolved data a cluster popover (`ClusterListPopover`) consumes. */
export interface MergedLeafBuckets {
  /** Families ordered by summed observation count desc (FamilyAggregate shape). */
  families: FamilyAggregate[];
  /** Resolved species rows per family code (real names, working codes). */
  speciesByFamily: ReadonlyMap<string, ReadonlyArray<SpeciesAggregate>>;
  /** Distinct species beyond the shown rows, per family code — drives "+N more". */
  overflowByFamily: ReadonlyMap<string, number>;
}

/**
 * Merge the member buckets of a maplibre cluster (read via `getClusterLeaves`)
 * into the data a `ClusterListPopover` renders. Each leaf carries its bucket's
 * families serialized in `properties.familiesJson` (per `bucketsToGeoJson`);
 * this parses them (tolerating malformed/absent JSON), merges via
 * `mergeBucketFamilies`, and resolves species codes to display rows.
 *
 * The merge is client-side because maplibre clustering only sums scalar
 * `clusterProperties` — it cannot merge the per-family species arrays. The
 * approximate-across-cells `speciesCount` (see `mergeBucketFamilies`) is fine
 * here: it only sizes the "+N more" hint.
 */
export function mergeLeafBuckets(
  leaves: ReadonlyArray<LeafWithFamilies>,
  dictionary: SpeciesDictionary,
): MergedLeafBuckets {
  const bucketFamilies: AggregatedFamily[][] = [];
  for (const leaf of leaves) {
    const raw = leaf.properties?.familiesJson;
    if (typeof raw !== 'string') continue;
    try {
      const parsed = JSON.parse(raw) as AggregatedFamily[];
      if (Array.isArray(parsed)) bucketFamilies.push(parsed);
    } catch {
      // Malformed leaf — skip it rather than crash the whole popover.
    }
  }

  const merged = mergeBucketFamilies(bucketFamilies);
  const families: FamilyAggregate[] = merged.map(f => ({ familyCode: f.code, count: f.count }));
  const speciesByFamily = new Map<string, ReadonlyArray<SpeciesAggregate>>();
  const overflowByFamily = new Map<string, number>();
  for (const f of merged) {
    const rows = resolveSpeciesRows(f, dictionary);
    speciesByFamily.set(f.code, rows);
    // Overflow = exact distinct species minus the rows actually shown. `f.species`
    // is already capped to the top-N; `rows.length` is what the popover renders.
    // (The merged `speciesCount` is an across-cell approximation per #859 — it
    // only sizes this hint.) Clamp at 0 so a single-cell-undercount can't go
    // negative.
    overflowByFamily.set(f.code, Math.max(0, f.speciesCount - rows.length));
  }
  return { families, speciesByFamily, overflowByFamily };
}

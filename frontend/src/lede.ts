import { formatCount } from './lib/format-count.js';
import { totalCountFromBuckets } from './data/bucket-aggregates.js';
import type { AggregatedBucket, Observation } from '@bird-watch/shared-types';

/**
 * #1283: select the count the lede displays.
 *
 * The UNFILTERED lede stays REGIONAL — it counts the whole scope's fetch
 * (`totalCountFromBuckets(buckets)` in aggregated mode, `observations.length`
 * in per-observation mode), so the headline reflects the region the user
 * chose regardless of where the camera happens to sit.
 *
 * The FILTERED lede (a family or species filter is active) instead counts what
 * is IN THE VIEWPORT, by reading the already-viewport-clipped data the legend
 * uses (`filterObservationsByBounds` / `filterBucketsByBounds` in App.tsx). This
 * makes "163 sightings of Woodpeckers" equal the legend's "in view" total and
 * match what is actually painted on the map — the raw unclipped fetch
 * over-counted vs. the markers (RCA for #1283). It also dissolves the transient
 * national "13,451" on a filtered deep-link, because the stage-1 CONUS/z3 seed
 * aggregate gets clipped to the seed viewport.
 *
 * Pure: callers pass BOTH the raw fetch arrays and the pre-clipped arrays (the
 * clipping itself stays in App.tsx where the live `LngLatBounds` lives), so this
 * helper never imports map state.
 */
export function selectLedeCount(args: {
  mode: 'observations' | 'aggregated';
  filterActive: boolean;
  /** Whole-scope fetch (regional path). */
  buckets: ReadonlyArray<AggregatedBucket>;
  observations: ReadonlyArray<Observation>;
  /** Viewport-clipped fetch (filtered path) — `viewportObservations` in App.tsx. */
  viewportBuckets: ReadonlyArray<AggregatedBucket>;
  viewportObservations: ReadonlyArray<Observation>;
}): number {
  const buckets = args.filterActive ? args.viewportBuckets : args.buckets;
  const observations = args.filterActive
    ? args.viewportObservations
    : args.observations;
  return args.mode === 'aggregated'
    ? totalCountFromBuckets(buckets)
    : observations.length;
}

// Placeholder shown while an observations refetch is in flight but a stale count
// is still mounted (#872 state->state guard). Lived inline in App.tsx before the
// lede computation was extracted here for unit testability.
export const LEDE_LOADING_PLACEHOLDER = 'Updating…';

export interface LedeInput {
  /** Active scope's region label; null ⟺ unscoped (the chooser landing). */
  region: string | null;
  /** EXACT total sightings: bucket totals in aggregated mode, row count in per-obs. */
  observationCount: number;
  /**
   * Distinct species in the PER-OBSERVATION rows. Always 0 in aggregated mode
   * (#859 carries no per-obs rows there) — used only by the guards and the
   * coincidental-single-species fallback, NOT to name the active filter.
   */
  speciesCount: number;
  observationsLoading: boolean;
  noFiltersActive: boolean;
  /**
   * #1175: the name of the ACTIVE species filter (`state.speciesCode` resolved
   * via the species dictionary), or null when no species filter is set / the
   * dictionary has not resolved it yet. This is mode-INDEPENDENT — it is what
   * lets the qualifier survive aggregated (low-zoom) mode, where `observations`
   * is empty and the per-obs fallback below resolves to null. Naming the active
   * FILTER is distinct from a distinct-species COUNT, so it does not reintroduce
   * the #1047 "N species" metric that aggregated mode intentionally omits.
   */
  activeSpeciesName: string | null;
  /**
   * `observations[0].comName` when `speciesCount === 1` — the coincidental
   * "only one species happens to be in view" case (per-observation mode only).
   * Preserved as a fallback so a single-species viewport with NO explicit filter
   * still names the species, exactly as before.
   */
  singleObservedSpeciesName: string | null;
  /** Resolved colloquial family name for an active family-only filter, else null. */
  familyName: string | null;
}

/**
 * The AppHeader identity-card count lede (#800/#779/#828). Pure so it is unit-
 * testable (#1175) and reused verbatim by the O1 (#776) aria-live narration, so
 * the screen-reader announcement and the visible lede never diverge.
 *
 * Returns null to render NOTHING (unscoped, or the cold-load guard). The
 * `LEDE_LOADING_PLACEHOLDER` covers an in-flight refetch that still has a stale
 * count mounted (#872). The non-zero templates unify on the sightings count
 * (#1047: no distinct-species count in aggregated mode); the species/family
 * qualifier names the active FILTER, not a count.
 */
export function craftLede(i: LedeInput): string | null {
  if (i.region === null) return null;
  // Cold-load guard (#716/#720): suppress the lede entirely while the FIRST
  // fetch is in flight (nothing to count yet).
  if (i.observationsLoading && i.observationCount === 0 && i.speciesCount === 0) {
    return null;
  }
  // #872 state->state guard: any in-flight refetch shows a count-free placeholder
  // rather than the previous scope's stale number.
  if (i.observationsLoading) return LEDE_LOADING_PLACEHOLDER;

  if (i.observationCount === 0 && i.speciesCount === 0) {
    return i.noFiltersActive ? 'No recent sightings' : 'No matches for these filters';
  }

  // Active species FILTER wins (works in both modes); the coincidental single
  // species in per-obs rows is the fallback.
  const speciesCommonName = i.activeSpeciesName ?? i.singleObservedSpeciesName;
  if (speciesCommonName) {
    return `${formatCount(i.observationCount)} sightings of ${speciesCommonName}`;
  }
  if (i.familyName) {
    return `${formatCount(i.observationCount)} sightings of ${i.familyName}`;
  }
  return `${formatCount(i.observationCount)} sightings`;
}

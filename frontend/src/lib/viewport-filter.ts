import type { LngLatBounds } from 'maplibre-gl';
import type { AggregatedBucket, Observation } from '@bird-watch/shared-types';

/**
 * Filter observations to those whose `[lng, lat]` falls inside a MapLibre
 * `LngLatBounds`. Pure helper — no React, no map state, no side effects.
 *
 * Contract:
 *   - `bounds === null` returns the input array unchanged (referentially
 *     equal). Callers gate on `view === 'map'` upstream and pass `null`
 *     to short-circuit. This lets `App.tsx`'s `viewportObservations` memo
 *     reuse the same identity for downstream consumers (FamilyLegend) when
 *     no filtering applies.
 *   - `bounds !== null` returns a new array containing only observations
 *     whose coordinates are contained by the bounds. `LngLatBounds.contains`
 *     is inclusive on the boundary (corner + edge points pass), which mirrors
 *     how MapLibre itself decides whether a feature is "in view".
 *   - Input order is preserved.
 *
 * Performance: O(N) per call. At today's ~344 observations this is sub-
 * millisecond; the memo upstream re-runs only when `[observations,
 * viewportBounds, view]` change, so per-frame cost stays bounded.
 */
export function filterObservationsByBounds(
  observations: Observation[],
  bounds: LngLatBounds | null,
): Observation[] {
  if (bounds === null) return observations;
  return observations.filter((o) => bounds.contains([o.lng, o.lat]));
}

/**
 * Aggregated-mode analogue (#859): filter `AggregatedBucket`s to those whose
 * grid-center `[lng, lat]` falls inside the bounds. Same null/identity and
 * order-preservation contract as `filterObservationsByBounds`. Feeds the family
 * legend's EXACT per-family counts (via `familyCountsFromBuckets`) at low zoom.
 */
export function filterBucketsByBounds(
  buckets: AggregatedBucket[],
  bounds: LngLatBounds | null,
): AggregatedBucket[] {
  if (bounds === null) return buckets;
  return buckets.filter((b) => bounds.contains([b.lng, b.lat]));
}

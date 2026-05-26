import { REGION_LABEL } from '../config/region.js';

export type Freshness = 'fresh' | 'recent' | 'stale' | 'empty' | 'error';

export interface MapLedeProps {
  /** Number of distinct species across the active filter scope. */
  speciesCount: number;
  /** Number of observations across the active filter scope. */
  observationCount: number;
  /** Common name of the active species filter; null when no species is selected. */
  speciesCommonName: string | null;
  /** Pretty-printed family name (e.g. "woodpeckers"); null when no family filter. */
  familyName: string | null;
  /** Period clause text (e.g. "14 days", "7 days"). */
  period: string;
  /** Freshness state from voice-and-content spec; "stale" drops the period clause. */
  freshness: Freshness;
  /**
   * Issue #716: when true, suppress Template 1 — counts are 0 because the
   * initial fetch hasn't resolved yet, not because filters narrowed to empty.
   * Re-fetches don't reset `observations` to `[]` (see use-bird-data.ts),
   * so this flag only matters on first paint. The freshness meta-line is
   * already empty during loading (deriveFreshness(null) → label ''), so the
   * context strip collapses to nothing — matching FeedSurface's own loading
   * branch.
   *
   * Issue #720: this must be driven by useBirdData's `observationsLoading`
   * — NOT the combined `loading` — because under typical network conditions
   * the hotspots fetch resolves before observations, and the combined flag
   * would clear during a window where observations is still empty (the
   * exact race that #716 set out to suppress).
   */
  loading: boolean;
}

/**
 * Newspaper lede for the map / feed / species surfaces. 4 templates in
 * priority order — see docs/design/01-spec/voice-and-content.md §"Lede
 * contract". Stale data drops the "in the last {period}" clause.
 */
export function MapLede({
  speciesCount,
  observationCount,
  speciesCommonName,
  familyName,
  period,
  freshness,
  loading,
}: MapLedeProps) {
  // Issue #716: suppress the lede during the cold-load window. Without this
  // guard, the empty seed `observations: []` from useBirdData causes Template 1
  // ("No sightings match your current filters.") to fire — misleading because
  // the user hasn't applied any filters yet. Suppressing the lede entirely
  // (rather than swapping in "Loading sightings…") avoids a transient string
  // that would flash and get replaced ~1s later.
  if (loading && observationCount === 0 && speciesCount === 0) {
    return null;
  }

  const periodClause = freshness === 'stale' ? '' : ` in the last ${period}`;

  let text: string;
  if (observationCount === 0 && speciesCount === 0) {
    // Template 1
    text = 'No sightings match your current filters.';
  } else if (speciesCommonName) {
    // Template 2
    text = `${observationCount} sightings of ${speciesCommonName} in ${REGION_LABEL}${periodClause}.`;
  } else if (familyName) {
    // Template 3
    text = `${speciesCount} species of ${familyName} seen across ${REGION_LABEL}${periodClause}.`;
  } else {
    // Template 4
    text = `${speciesCount} species seen across ${REGION_LABEL}${periodClause}.`;
  }

  return <h1 className="map-lede">{text}</h1>;
}

export type Freshness = 'fresh' | 'recent' | 'stale' | 'empty' | 'error';

export interface MapLedeProps {
  /**
   * Runtime region label for the active scope (from `regionLabelFor`, #738/C5).
   * `null` ⟺ the unscoped/chooser landing — MapLede renders nothing in that
   * case (the chooser is shown instead of the map; #740/#742 gate the render).
   * Non-null is "USA" (`?scope=us`) or the resolved state name (`?state=`).
   */
  region: string | null;
  /**
   * #738/C7: caller-computed "no filters are active" flag. App.tsx (#740)
   * owns the `since === DEFAULTS.since` comparison so MapLede stays
   * presentational. When true AND counts are zero, the lede reads as a
   * data-availability state (sparse region) rather than a filter mistake.
   */
  noFiltersActive: boolean;
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
 *
 * Zero-count narration (#738/C7) is split into two cases so a scoped-but-thin
 * region reads as a *data-availability* state, not a *filter-narrowed* one:
 *   - no filters active → "No recent sightings in {region} yet." (sparse)
 *   - filters active    → "No sightings match your current filters."
 */
export function MapLede({
  region,
  noFiltersActive,
  speciesCount,
  observationCount,
  speciesCommonName,
  familyName,
  period,
  freshness,
  loading,
}: MapLedeProps) {
  // #738/C7: unscoped (region=null) → the chooser is shown, not the map, so
  // there is no region to claim. Return null — same discipline as the
  // cold-load guard below (#716/#720). Guarding before the loading check is
  // safe because both branches return null.
  if (region === null) {
    return null;
  }

  // Issue #716: suppress the lede during the cold-load window. Without this
  // guard, the empty seed `observations: []` from useBirdData causes the
  // zero-count Template 1 to fire — misleading because the data simply hasn't
  // arrived yet. Suppressing the lede entirely (rather than swapping in
  // "Loading sightings…") avoids a transient string that would flash and get
  // replaced ~1s later. This wins over the data-availability branch too: a
  // sparse-region read must not flash before the first fetch resolves.
  if (loading && observationCount === 0 && speciesCount === 0) {
    return null;
  }

  const periodClause = freshness === 'stale' ? '' : ` in the last ${period}`;

  let text: string;
  if (observationCount === 0 && speciesCount === 0) {
    // #738/C7 — split the zero-count branch on whether any filter is active.
    text = noFiltersActive
      ? // Data-availability: the region itself is sparse; the user didn't
        // narrow anything. Keep this copy in lockstep with #741's e2e spec.
        `No recent sightings in ${region} yet.`
      : // Filter-narrowing: the user's active filters excluded everything.
        'No sightings match your current filters.';
  } else if (speciesCommonName) {
    // Template 2
    text = `${observationCount} sightings of ${speciesCommonName} in ${region}${periodClause}.`;
  } else if (familyName) {
    // Template 3
    text = `${speciesCount} species of ${familyName} seen across ${region}${periodClause}.`;
  } else {
    // Template 4
    text = `${speciesCount} species seen across ${region}${periodClause}.`;
  }

  return <h1 className="map-lede">{text}</h1>;
}

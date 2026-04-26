import type { Observation } from '@bird-watch/shared-types';
import { ObservationFeedRow } from './ObservationFeedRow.js';
import { SpeciesAutocomplete } from './SpeciesAutocomplete.js';
import { SurfaceFooter } from './SurfaceFooter.js';
import type { SpeciesOption } from './FiltersBar.js';

export interface SpeciesSearchSurfaceProps {
  loading: boolean;
  speciesCode: string | null;
  observations: Observation[];
  speciesIndex: SpeciesOption[];
  now: Date;
  onSelectSpecies: (speciesCode: string) => void;
}

/** Stable module-level no-op. */
const ROW_NOOP: (speciesCode: string) => void = () => {};

/**
 * Species-first surface (`?view=species`). Dedicated navigation
 * autocomplete at the top; below it, when `?species=` is set, a
 * "Recent sightings for this species" list — filtered client-side
 * from the parent's observation set, rendered via the shared
 * `<ObservationFeedRow>`.
 *
 * Navigation vs filter (critical distinction):
 *   - `FiltersBar`'s species input NARROWS the observation set in place.
 *     The feed reacts, the URL sets `?species=`, but the user stays on
 *     the feed surface.
 *   - `SpeciesAutocomplete` here is NAVIGATION. Committing a species sets
 *     `?detail=` + `?view=detail` which opens the SpeciesDetailSurface.
 *
 * Clicking a row in the recent-sightings list intentionally does NOT
 * re-open the panel (panel is already open for the same species). The
 * row's `onSelectSpecies` receives a no-op handler so the row renders
 * with the same accessible contract as in `FeedSurface`, but a user
 * click does nothing observable — the panel does not flash.
 */
export function SpeciesSearchSurface(props: SpeciesSearchSurfaceProps) {
  const { loading, speciesCode, observations, speciesIndex, now, onSelectSpecies } = props;

  const filtered = speciesCode
    ? observations.filter(o => o.speciesCode === speciesCode)
    : [];

  return (
    <div className="species-search-surface">
      <SpeciesAutocomplete
        speciesIndex={speciesIndex}
        onSelectSpecies={onSelectSpecies}
      />

      {speciesCode === null && (
        <p className="species-search-prompt" role="status">
          Start typing a species name to explore its recent sightings.
        </p>
      )}

      {speciesCode !== null && loading && (
        <p className="species-search-empty" role="status" aria-live="polite">
          Loading observations…
        </p>
      )}

      {speciesCode !== null && !loading && filtered.length === 0 && (
        <p className="species-search-empty" role="status">
          No recent sightings for this species in the current window.
        </p>
      )}

      {speciesCode !== null && !loading && filtered.length > 0 && (
        <ol className="feed" aria-label="Recent sightings">
          {filtered.map(o => (
            <ObservationFeedRow
              key={`${o.subId}:${o.speciesCode}`}
              observation={o}
              now={now}
              onSelectSpecies={ROW_NOOP}
            />
          ))}
        </ol>
      )}

      <SurfaceFooter />
    </div>
  );
}

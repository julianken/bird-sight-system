import type { Observation } from '@bird-watch/shared-types';
import type { Since } from '../state/url-state.js';
import { ObservationFeedRow } from './ObservationFeedRow.js';

export interface FeedSurfaceFilters {
  notable: boolean;
  since: Since;
}

export interface FeedSurfaceProps {
  loading: boolean;
  observations: Observation[];
  now: Date;
  filters: FeedSurfaceFilters;
  onSelectSpecies: (speciesCode: string) => void;
}

/**
 * Default view for the bird-maps site: reverse-chronological observation
 * rows. The parent (App.tsx) supplies already-filtered observations — this
 * component does NOT re-filter by `notable` or `since`. The `filters` prop
 * is consumed only to generate filter-aware empty-state copy.
 *
 * Empty-state branches (spec):
 *   - loading       → "Loading observations…"
 *   - notable=true  → "No notable sightings in this window."
 *   - since=1d      → "No observations reported today."
 *   - otherwise     → "No observations to show."
 *
 * NOTE on error states: a broken API surfaces as the full-screen
 * `.error-screen` in App.tsx (it returns early). By the time a FeedSurface
 * renders, we know the request succeeded — an empty array means zero
 * matches, not a backend outage. That's why no empty branch mentions
 * "something broke" or "try again".
 */
export function FeedSurface(props: FeedSurfaceProps) {
  const { loading, observations, now, filters, onSelectSpecies } = props;

  if (loading) {
    return (
      <div className="feed-empty" role="status" aria-live="polite">
        Loading observations…
      </div>
    );
  }

  if (observations.length === 0) {
    let hint: string;
    if (filters.notable) {
      hint = 'No notable sightings in this window. Try widening the time window or turning off Notable only.';
    } else if (filters.since === '1d') {
      hint = 'No observations reported today. Try expanding the time window.';
    } else {
      hint = 'No observations to show.';
    }
    return (
      <div className="feed-empty" role="status">
        {hint}
      </div>
    );
  }

  return (
    <ol className="feed" aria-label="Observations">
      {observations.map(o => (
        <ObservationFeedRow
          key={o.subId}
          observation={o}
          now={now}
          onSelectSpecies={onSelectSpecies}
        />
      ))}
    </ol>
  );
}

import { useMemo, useState } from 'react';
import type { Observation } from '@bird-watch/shared-types';
import type { Since } from '../state/url-state.js';
import type { SpeciesOption } from './FiltersBar.js';
import { ObservationFeedRow } from './ObservationFeedRow.js';

export interface FeedSurfaceFilters {
  notable: boolean;
  since: Since;
}

export type FeedSortMode = 'recent' | 'taxonomic';

export interface FeedSurfaceProps {
  loading: boolean;
  observations: Observation[];
  now: Date;
  filters: FeedSurfaceFilters;
  onSelectSpecies: (speciesCode: string) => void;
  /**
   * Per-species lookup used by the "Taxonomic" sort. Optional for
   * backward-compat with callers that haven't been updated; when absent
   * the taxonomic sort falls back to alphabetical-by-comName (same shape
   * as the all-null-taxonOrder cold-load case).
   */
  speciesIndex?: SpeciesOption[];
}

/**
 * Default view for the bird-maps site: reverse-chronological observation
 * rows. The parent (App.tsx) supplies already-filtered observations — this
 * component does NOT re-filter by `notable` or `since`. The `filters` prop
 * is consumed only to generate filter-aware empty-state copy.
 *
 * Sort contract (Plan 6 Task 10 / issue #119):
 *   - "Recent" (default): the server order is preserved. No client
 *     re-sort; the Read API already returns observations by `obs_dt DESC`.
 *   - "Taxonomic": sort by `speciesIndex[code].taxonOrder ASC`, with
 *     null values placed AFTER all non-null values. Within the null
 *     group, sort alphabetically by `comName` so the output is
 *     deterministic regardless of the input order. Rationale: on a
 *     cold load, no cached `SpeciesMeta` means every `taxonOrder` is
 *     null and taxonomic sort degrades to alphabetical — the same
 *     contract documented on the issue body.
 *
 * The sort mode is COMPONENT-LOCAL state (not URL-persisted) per the
 * "Out of scope" note on issue #119. A future URL-persistent iteration
 * would lift this into useUrlState.
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
  const { loading, observations, now, filters, onSelectSpecies, speciesIndex } = props;
  const [sortMode, setSortMode] = useState<FeedSortMode>('recent');

  // Derive a code→taxonOrder lookup from speciesIndex once per render.
  // Missing speciesIndex or species without a taxonOrder bucket as null
  // (sorted last per the documented contract above).
  const taxonMap = useMemo(() => {
    const map = new Map<string, number | null>();
    if (speciesIndex) {
      for (const s of speciesIndex) map.set(s.code, s.taxonOrder);
    }
    return map;
  }, [speciesIndex]);

  const visibleObservations = useMemo(() => {
    if (sortMode === 'recent') return observations;
    // Taxonomic: nulls last, ascending by taxonOrder, ties broken by comName.
    // The slice() preserves the parent's array reference identity so
    // server-order memoisation higher up isn't defeated.
    return observations.slice().sort((a, b) => {
      const ta = taxonMap.get(a.speciesCode) ?? null;
      const tb = taxonMap.get(b.speciesCode) ?? null;
      if (ta === null && tb === null) return a.comName.localeCompare(b.comName);
      if (ta === null) return 1; // a after b
      if (tb === null) return -1; // a before b
      if (ta === tb) return a.comName.localeCompare(b.comName);
      return ta - tb;
    });
  }, [observations, sortMode, taxonMap]);

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
    <>
      {/* Radio group for native keyboard arrow-key traversal. role=radiogroup
          with a visible label satisfies axe without an explicit aria-labelledby
          on every radio. */}
      <div
        className="feed-sort"
        role="radiogroup"
        aria-label="Sort observations"
      >
        <label className="feed-sort-option">
          <input
            type="radio"
            name="feed-sort"
            value="recent"
            checked={sortMode === 'recent'}
            onChange={() => setSortMode('recent')}
          />
          <span>Recent</span>
        </label>
        <label className="feed-sort-option">
          <input
            type="radio"
            name="feed-sort"
            value="taxonomic"
            checked={sortMode === 'taxonomic'}
            onChange={() => setSortMode('taxonomic')}
          />
          <span>Taxonomic</span>
        </label>
      </div>
      <ol className="feed" aria-label="Observations">
        {visibleObservations.map(o => (
          <ObservationFeedRow
            key={o.subId}
            observation={o}
            now={now}
            onSelectSpecies={onSelectSpecies}
          />
        ))}
      </ol>
    </>
  );
}

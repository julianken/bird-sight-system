import { useMemo, useState } from 'react';
import type { Observation, NotableObservation } from '@bird-watch/shared-types';
import type { Since } from '../state/url-state.js';
import type { SpeciesOption } from './FiltersBar.js';
import { FeedCard } from './FeedCard.js';
import { FeedRow } from './FeedRow.js';
import { FilterSentence } from './ds/FilterSentence.js';
import { SortLabel } from './ds/SortLabel.js';

export interface FeedSurfaceFilters {
  notable: boolean;
  since: Since;
  speciesCode: string | null;
  familyCode: string | null;
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
  /**
   * Total unique-species count for the lede template (Priority 4).
   * When absent, FeedSurface derives it from observations.length as a
   * rough fallback (may overcount if multiple obs share a species code).
   */
  observationCount?: number;
  /** Human-readable region label for the lede ("Arizona"). */
  regionLabel?: string;
  /** Human-readable period for the lede ("14 days"). */
  period?: string;
  /**
   * Common name of the selected species — present when speciesCode filter
   * is active. Triggers the Priority 2 lede template.
   */
  speciesName?: string;
  /**
   * Common name of the selected family — present when familyCode filter is
   * active. Triggers the Priority 3 lede template.
   */
  familyName?: string;
}

/**
 * Feed surface — Sky Atlas Phase 5.
 *
 * Lede templates (evaluated in priority order, from
 * docs/design/01-spec/voice-and-content.md §Lede contract):
 *   1. Zero results → "No sightings match your current filters."
 *   2. speciesName set → "{N} sightings of {name} in {region} in the last {period}."
 *   3. familyName set → "{N} species of {family} seen across {region} in the last {period}."
 *   4. Default → "{N} species seen across {region} in the last {period}."
 *
 * <SortLabel> is a separate sibling ABOVE <FilterSentence> in the context
 * strip. These are independent components that must NOT be composed together
 * (docs/design/01-spec/components.md §<FilterSentence>: "Sort prefix is NOT
 * this component").
 *
 * The top-notable observation (first isNotable=true in the observations array)
 * renders as an elevated <FeedCard>. Remaining observations render as flat
 * <FeedRow> items. Both are children of the same <ol> to preserve list semantics.
 *
 * Sort contract (unchanged from existing implementation):
 *   - "Recent" (default): server order preserved. No client re-sort.
 *   - "Taxonomic": taxonOrder ASC, nulls last, ties by comName.
 */
export function FeedSurface(props: FeedSurfaceProps) {
  const {
    loading,
    observations,
    now,
    filters,
    onSelectSpecies,
    speciesIndex,
    observationCount,
    regionLabel = 'Arizona',
    period = '14 days',
    speciesName,
    familyName,
  } = props;

  const [sortMode, setSortMode] = useState<FeedSortMode>('recent');

  const taxonMap = useMemo(() => {
    const map = new Map<string, number | null>();
    if (speciesIndex) {
      for (const s of speciesIndex) map.set(s.code, s.taxonOrder ?? null);
    }
    return map;
  }, [speciesIndex]);

  const visibleObservations = useMemo(() => {
    if (sortMode === 'recent') return observations;
    return observations.slice().sort((a, b) => {
      const ta = taxonMap.get(a.speciesCode) ?? null;
      const tb = taxonMap.get(b.speciesCode) ?? null;
      if (ta === null && tb === null) return a.comName.localeCompare(b.comName);
      if (ta === null) return 1;
      if (tb === null) return -1;
      if (ta === tb) return a.comName.localeCompare(b.comName);
      return ta - tb;
    });
  }, [observations, sortMode, taxonMap]);

  // Derive the lede string using the 4-template priority state machine.
  // Templates are explicit branches — no string-template engine.
  // (docs/design/01-spec/voice-and-content.md §Templates are explicit)
  const effectiveCount = observationCount ?? observations.length;
  const lede: string = useMemo(() => {
    if (effectiveCount === 0) {
      return 'No sightings match your current filters.';
    }
    if (speciesName) {
      return `${effectiveCount} sightings of ${speciesName} in ${regionLabel} in the last ${period}.`;
    }
    if (familyName) {
      return `${effectiveCount} species of ${familyName} seen across ${regionLabel} in the last ${period}.`;
    }
    return `${effectiveCount} species seen across ${regionLabel} in the last ${period}.`;
  }, [effectiveCount, speciesName, familyName, regionLabel, period]);

  // Build the ActiveFilters shape expected by <FilterSentence>.
  // Forward all four filter dimensions so FilterSentence renders the same
  // active-filter sentence as the species surface. Omitting speciesCode/
  // familyCode caused cross-surface drift: feed lede named the species but
  // the sibling FilterSentence omitted it (fix for PR #429 review finding).
  const activeFilters = useMemo(() => ({
    notable: filters.notable,
    since: filters.since,
    speciesCode: filters.speciesCode,
    familyCode: filters.familyCode,
  }), [filters]);

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
      <div className="feed-surface">
        <p className="feed-lede">{lede}</p>
        <div className="feed-empty" role="status">
          {hint}
        </div>
      </div>
    );
  }

  // Find the first notable observation for the elevated card treatment.
  // "First" respects the current sort order. Narrowed to NotableObservation
  // (Observation & { isNotable: true }) to satisfy FeedCard's type contract.
  const topNotable: NotableObservation | null =
    visibleObservations.find((o): o is NotableObservation => o.isNotable) ?? null;

  // All other observations (non-card rows): if a notable is elevated,
  // exclude it from the flat list so it doesn't appear twice.
  const flatObservations: Observation[] = topNotable
    ? visibleObservations.filter(o => o !== topNotable)
    : visibleObservations;

  return (
    <div className="feed-surface">
      {/* Lede — runtime truth claim, Priority 1–4 state machine */}
      <p className="feed-lede">{lede}</p>

      {/* Context strip: SortLabel sibling ABOVE FilterSentence.
          These are independent; do not compose or merge them. */}
      <SortLabel mode={sortMode} />
      <FilterSentence filters={activeFilters} />

      {/* Sort toggle — radio group for native keyboard arrow-key traversal */}
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

      {/* Unified observation list: top-notable card-row first, then flat rows */}
      <ol className="feed" aria-label="Observations">
        {topNotable && (
          <FeedCard
            key={`card:${topNotable.subId}:${topNotable.speciesCode}`}
            observation={topNotable}
            now={now}
            onSelectSpecies={onSelectSpecies}
          />
        )}
        {flatObservations.map(o => (
          <FeedRow
            key={`${o.subId}:${o.speciesCode}`}
            observation={o}
            now={now}
            onSelectSpecies={onSelectSpecies}
          />
        ))}
      </ol>
    </div>
  );
}

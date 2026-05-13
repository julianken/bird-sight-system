import type { Observation } from '@bird-watch/shared-types';
import type { Since } from '../state/url-state.js';
import { FeedRow } from './FeedRow.js';
import { SpeciesAutocomplete } from './SpeciesAutocomplete.js';
import { FilterSentence } from './ds/FilterSentence.js';
import type { SpeciesOption } from './FiltersBar.js';
import type { Freshness } from './MapLede.js';

export interface ActiveFilters {
  notable: boolean;
  since: Since;
  speciesCode: string | null;
  familyCode: string | null;
}

export interface SpeciesSearchSurfaceProps {
  loading: boolean;
  speciesCode: string | null;
  observations: Observation[];
  speciesIndex: SpeciesOption[];
  now: Date;
  onSelectSpecies: (speciesCode: string) => void;
  onClearSpecies?: () => void;
  /**
   * Active filter state for the <FilterSentence> context strip.
   * Optional: when absent, FilterSentence receives zero-filter state
   * (live region still mounts; visible sentence is null).
   */
  activeFilters?: ActiveFilters;
  /**
   * Human-readable vernacular label for the active family filter.
   * Forwarded to <FilterSentence> so the visible sentence renders
   * the vernacular name instead of the raw familyCode.
   */
  familyName?: string;
  /**
   * Human-readable common name for the active species filter.
   * Forwarded to <FilterSentence> so the visible sentence renders
   * the common name instead of the raw speciesCode.
   */
  speciesName?: string;
  /**
   * Freshness state from the 4-state machine (#456 W3-A). Optional for
   * backward-compat; when absent, no freshness meta line is rendered.
   * Spec: docs/design/01-spec/voice-and-content.md §Freshness label state machine.
   */
  freshness?: Freshness;
  /**
   * Pre-computed freshness label (e.g. "Updated 11 min ago · Source: eBird").
   * Displayed below the autocomplete hero on the species surface.
   */
  freshnessLabel?: string;
}

/** Stable module-level no-op for the recent-sightings row list. */
const ROW_NOOP: (speciesCode: string) => void = () => {};

const DEFAULT_FILTERS: ActiveFilters = {
  notable: false,
  since: '14d',
  speciesCode: null,
  familyCode: null,
};

/**
 * Species-first surface — Sky Atlas Phase 5.
 *
 * Visual distinction between the two species inputs:
 *   - <FiltersBar> species input (in the header): chip-shaped, narrow,
 *     class="filters-bar-species-input". It NARROWS the observation set.
 *   - <SpeciesAutocomplete> here: hero-sized, full-width, search icon,
 *     wrapped in .species-search-hero. It NAVIGATES to the detail surface.
 *
 * The hero wrapper and icon are purely visual. <SpeciesAutocomplete>'s
 * ARIA contract (role="combobox", aria-autocomplete="list", aria-expanded,
 * aria-controls, aria-activedescendant, flat-sentinel group headers,
 * ArrowDown/Up/Enter/Escape) is preserved verbatim — do NOT pass additional
 * ARIA attributes via the wrapper.
 *
 * <FilterSentence> mounts in the context strip below the hero autocomplete.
 * The live region is always present (even at zero filters); the visible
 * sentence renders only when filters are active.
 *
 * Recent-sightings row list uses <FeedRow> (not <ObservationFeedRow>).
 * Rows receive ROW_NOOP for onSelectSpecies — clicking a row when the panel
 * is already open for the same species is a no-op by design.
 */
export function SpeciesSearchSurface(props: SpeciesSearchSurfaceProps) {
  const {
    loading,
    speciesCode,
    observations,
    speciesIndex,
    now,
    onSelectSpecies,
    activeFilters = DEFAULT_FILTERS,
    familyName,
    speciesName,
    freshness: _freshness,
    freshnessLabel,
  } = props;

  const filtered = speciesCode
    ? observations.filter(o => o.speciesCode === speciesCode)
    : [];

  return (
    <div className="species-search-surface">
      {/* Page-level heading for screen readers — visually hidden so it does
          not duplicate the autocomplete placeholder or disrupt the visual
          design. Provides the required <h1> per WCAG 1.3.1 and 2.4.6.
          A11Y-3 fix (issue #513). */}
      <h1 className="sr-only">Search Species</h1>
      {/* Hero autocomplete — navigates to detail surface.
          The wrapper class establishes visual distinction from the header filter chip. */}
      <div className="species-search-hero">
        <span className="species-search-hero-icon" aria-hidden="true">
          {/* SVG search icon — rendered as inline SVG so it inherits currentColor
              and is not a separate network request. The icon slot is purely decorative;
              aria-hidden prevents SR double-announcement (combobox label already conveys
              the search affordance). */}
          <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <circle cx="8.5" cy="8.5" r="5.75" stroke="currentColor" strokeWidth="1.5" />
            <path d="M13.25 13.25L17 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
        <SpeciesAutocomplete
          speciesIndex={speciesIndex}
          onSelectSpecies={onSelectSpecies}
        />
      </div>

      {/* Freshness meta line — 4-state machine per voice-and-content.md (#456 W3-A) */}
      {freshnessLabel && (
        <p className="species-freshness">{freshnessLabel}</p>
      )}

      {/* Context strip: FilterSentence (always-mounted live region) */}
      <FilterSentence
        filters={activeFilters}
        {...(familyName !== undefined ? { familyName } : {})}
        {...(speciesName !== undefined ? { speciesName } : {})}
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
            <FeedRow
              key={`${o.subId}:${o.speciesCode}`}
              observation={o}
              now={now}
              onSelectSpecies={ROW_NOOP}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

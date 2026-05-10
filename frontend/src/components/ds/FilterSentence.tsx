/**
 * <FilterSentence>
 *
 * Renders the active-filter narrative. Template-driven; collapses to null
 * at zero filters. Always-mounted hidden live region provides SR
 * announcements with 500ms debounce (rapid filter toggles → one
 * announcement) and 1500ms clear-hold ("All filters cleared." persists
 * in the live region after the visual element collapses).
 *
 * Two separate DOM elements with separate lifecycles:
 *   1. .filter-sentence__visible — the readable sentence (null at zero filters)
 *   2. .filter-sentence-live     — always mounted; holds text for SR only
 *
 * Template: "Showing {filter-terms-with-bullets} from the last {period}."
 *   0 filters → null (visual collapses)
 *   1 filter  → "notable sightings"
 *   2+ filters → comma-joined ("notable sightings, woodpeckers")
 *
 * Sort prefix is NOT this component. <SortLabel> is a separate sibling.
 *
 * Spec: docs/design/01-spec/components.md#filtersentence
 *       docs/design/01-spec/accessibility.md (FilterSentence live region)
 *       docs/design/01-spec/voice-and-content.md (FilterSentence template)
 */
import { useState, useEffect, useRef, type ReactNode } from 'react';
import type { UrlState } from '../../state/url-state.js';
import {
  FILTER_SENTENCE_DEBOUNCE_MS,
  FILTER_SENTENCE_CLEAR_HOLD_MS,
} from '../../config/filter.js';

export interface FilterSentenceProps {
  filters: UrlState;
}

function buildFilterTerms(filters: UrlState): string[] {
  const terms: string[] = [];
  if (filters.notable) terms.push('notable sightings');
  if (filters.familyCode) terms.push(filters.familyCode);
  if (filters.speciesCode) terms.push(filters.speciesCode);
  return terms;
}

function buildSentence(filters: UrlState): string | null {
  const terms = buildFilterTerms(filters);
  if (terms.length === 0) return null;
  const period = filters.since === '1d' ? '1 day'
    : filters.since === '7d' ? '7 days'
    : filters.since === '30d' ? '30 days'
    : '14 days';
  return `Showing ${terms.join(', ')} from the last ${period}.`;
}

export function FilterSentence({ filters }: FilterSentenceProps): ReactNode {
  const sentence = buildSentence(filters);
  const [liveText, setLiveText] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHoldRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevSentenceRef = useRef<string | null>(null);

  useEffect(() => {
    const prev = prevSentenceRef.current;
    prevSentenceRef.current = sentence;

    // Clear any in-flight timers
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (clearHoldRef.current) clearTimeout(clearHoldRef.current);

    if (sentence === null && prev !== null) {
      // Filters just cleared: announce immediately (no debounce),
      // then hold for CLEAR_HOLD_MS before going silent.
      // The DEBOUNCE only applies to filter-set/change announcements.
      setLiveText('All filters cleared.');
      clearHoldRef.current = setTimeout(() => {
        setLiveText('');
      }, FILTER_SENTENCE_CLEAR_HOLD_MS);
    } else if (sentence !== null) {
      // Filters set or changed: debounce the SR announcement.
      debounceRef.current = setTimeout(() => {
        setLiveText(sentence);
      }, FILTER_SENTENCE_DEBOUNCE_MS);
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (clearHoldRef.current) clearTimeout(clearHoldRef.current);
    };
  }, [sentence]);

  return (
    <>
      {sentence && (
        <p className="filter-sentence__visible">
          Showing{' '}
          {buildFilterTerms(filters).map((term, i, arr) => (
            <span key={term}>
              <span className="filter-bullet">{term}</span>
              {i < arr.length - 1 ? ', ' : ''}
            </span>
          ))}{' '}
          from the last{' '}
          {filters.since === '1d' ? '1 day'
            : filters.since === '7d' ? '7 days'
            : filters.since === '30d' ? '30 days'
            : '14 days'}.
        </p>
      )}
      <div
        className="filter-sentence-live"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-relevant="text"
        style={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap' }}
      >
        {liveText}
      </div>
    </>
  );
}

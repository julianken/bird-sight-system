import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SpeciesOption } from './FiltersBar.js';
import { prettyFamily } from '../derived.js';

export interface SpeciesAutocompleteProps {
  speciesIndex: SpeciesOption[];
  onSelectSpecies: (speciesCode: string) => void;
  /**
   * Fires when the user begins typing a query (empty → non-empty). Lets
   * the parent react to search-start without firing per keystroke — used
   * by SpeciesSearchSurface to clear the current `?species=` so the
   * observations refetch unfiltered and the species catalog opens back
   * up for navigation.
   */
  onSearchStart?: () => void;
}

/**
 * Species navigation autocomplete — distinct from `FiltersBar`'s species
 * input. FiltersBar narrows the observation set in-place; this autocomplete
 * NAVIGATES by setting `?detail=` + `?view=detail` on commit, which opens the
 * SpeciesDetailSurface.
 *
 * WAI-ARIA 1.2 combobox pattern — input + listbox, with the input carrying
 * `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded`,
 * `aria-controls` pointing at the listbox id, and `aria-activedescendant`
 * pointing at the currently-highlighted option's id. The listbox renders
 * only while the user has typed AND matches exist.
 *
 * Dropdown positioning — reads `input.getBoundingClientRect().bottom` on
 * every open/requery and compares against `window.innerHeight`. If the
 * dropdown (estimated at `DROPDOWN_HEIGHT_PX`) would overflow the viewport,
 * `data-position` flips to `"above"` and CSS docks the listbox to the top
 * of the input wrapper instead of the bottom. No portal — the wrapper
 * establishes the positioning context.
 *
 * Match semantics (this release): case-insensitive match against
 * `comName`. Prefix hits sort before substring hits so the most specific
 * typing intention lands first in the list.
 *
 * Family grouping: matches are clustered by `familyCode`. Groups sort by the
 * first member's `taxonOrder` (ascending); when absent, alphabetically by
 * family display name. Options with no resolvable family fall into an "Other"
 * bucket rendered last. Group headers are `<li role="presentation">` siblings
 * of the option elements (flat-sentinel pattern) so the ARIA ownership chain
 * listbox → option is unbroken per WAI-ARIA 1.2. Keyboard nav (ArrowDown/
 * ArrowUp) traverses the flat option order without skipping, and
 * `aria-activedescendant` stays anchored to option ids.
 */

// Estimated max dropdown height in px — if the element would not fit below
// the input, we flip. A fixed estimate is sufficient; we do not measure the
// dropdown after render to avoid a second layout pass. This keeps the
// positioning decision purely input-rect driven.
const DROPDOWN_HEIGHT_PX = 280;

// Cap option list to keep the listbox scannable even when the user types a
// broad prefix. 8 matches the desktop dropdown height estimate (8 rows @
// ~34px + padding ≈ DROPDOWN_HEIGHT_PX). When more matches exist they are
// truncated silently — the user narrows further by typing more.
const MAX_VISIBLE_OPTIONS = 8;

const OTHER_FAMILY_CODE = '__other__';

interface RankedOption extends SpeciesOption {
  /**
   * 0 = prefix match, 1 = substring match. Lower ranks render first.
   */
  rank: 0 | 1;
}

interface FamilyGroup {
  /** Family code, or `OTHER_FAMILY_CODE` for the catch-all bucket. */
  code: string;
  /** Display name shown in the group header. */
  displayName: string;
  /** First member's taxonOrder, used for group sort (null for Other). */
  firstTaxonOrder: number | null;
  items: RankedOption[];
}

function rankMatches(query: string, speciesIndex: SpeciesOption[]): RankedOption[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];
  const out: RankedOption[] = [];
  for (const option of speciesIndex) {
    const name = option.comName.toLowerCase();
    if (name.startsWith(q)) {
      out.push({ ...option, rank: 0 });
    } else if (name.includes(q)) {
      out.push({ ...option, rank: 1 });
    }
  }
  out.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.comName.localeCompare(b.comName);
  });
  return out.slice(0, MAX_VISIBLE_OPTIONS);
}

/**
 * Group ranked matches by familyCode. Groups sort by the first member's
 * taxonOrder (ascending, nulls last). When taxonOrder is absent for both
 * groups, fall back to alphabetical display name. The "Other" bucket always
 * sorts last regardless.
 *
 * Intra-group order preserves the existing flat rank order so keyboard nav
 * is unchanged — groups are purely visual.
 */
function groupMatches(matches: RankedOption[]): FamilyGroup[] {
  const groupMap = new Map<string, FamilyGroup>();

  for (const m of matches) {
    const code = m.familyCode ?? OTHER_FAMILY_CODE;
    if (!groupMap.has(code)) {
      groupMap.set(code, {
        code,
        displayName: code === OTHER_FAMILY_CODE ? 'Other' : prettyFamily(code),
        firstTaxonOrder: m.taxonOrder ?? null,
        items: [],
      });
    }
    groupMap.get(code)!.items.push(m);
  }

  return Array.from(groupMap.values()).sort((a, b) => {
    // "Other" always last.
    if (a.code === OTHER_FAMILY_CODE) return 1;
    if (b.code === OTHER_FAMILY_CODE) return -1;
    // Sort by first member taxonOrder (ascending, nulls last).
    if (a.firstTaxonOrder !== null && b.firstTaxonOrder !== null) {
      return a.firstTaxonOrder - b.firstTaxonOrder;
    }
    if (a.firstTaxonOrder !== null) return -1;
    if (b.firstTaxonOrder !== null) return 1;
    // Both null — alphabetical by display name.
    return a.displayName.localeCompare(b.displayName);
  });
}

export function SpeciesAutocomplete(props: SpeciesAutocompleteProps) {
  const { speciesIndex, onSelectSpecies, onSearchStart } = props;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState<string>('');
  const [highlighted, setHighlighted] = useState<number>(-1);
  const [position, setPosition] = useState<'above' | 'below'>('below');
  const listboxId = useId();
  const optionIdPrefix = useId();
  const groupIdPrefix = useId();

  const matches = useMemo(() => rankMatches(query, speciesIndex), [query, speciesIndex]);
  const groups = useMemo(() => groupMatches(matches), [matches]);

  // Flatten groups into a single array that mirrors the render order (group-
  // sorted by taxonOrder, then intra-group order as preserved by groupMatches).
  // This ensures matches[i] always corresponds to the i-th visible option so
  // `highlighted`, `commit(i)`, and the render's flatIndex all index the same
  // sequence — preventing the divergence where the visually-highlighted option
  // and the Enter-commit target point at different rows.
  const orderedMatches = useMemo(
    () => groups.flatMap(g => g.items),
    [groups],
  );

  // Auto-highlight the first option whenever the match list goes from empty →
  // non-empty so Enter always commits something (WAI-ARIA APG "list
  // autocomplete with automatic selection" variant). When the list is empty
  // (no matches, or the query was cleared) reset to -1 as before.
  useEffect(() => {
    setHighlighted(orderedMatches.length > 0 ? 0 : -1);
  }, [query, orderedMatches.length]);

  // Recalculate dropdown position on every query change that keeps the
  // listbox open. `useLayoutEffect` runs before paint so the flip happens
  // synchronously with the listbox appearing — no visible "opens below,
  // then jumps above" flash.
  useLayoutEffect(() => {
    if (orderedMatches.length === 0) return;
    const input = inputRef.current;
    if (!input) return;
    const rect = input.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - rect.bottom;
    if (spaceBelow < DROPDOWN_HEIGHT_PX && rect.top > DROPDOWN_HEIGHT_PX) {
      setPosition('above');
    } else {
      setPosition('below');
    }
  }, [orderedMatches]);

  const listboxOpen = query.trim() !== '' && orderedMatches.length > 0;

  function commit(index: number) {
    const pick = orderedMatches[index];
    if (!pick) return;
    onSelectSpecies(pick.code);
    // Clear the query so the listbox closes and the input is ready for the
    // next navigation. We do not echo the committed name back into the input
    // because this autocomplete is navigation — the act of selecting already
    // opened the panel; leaving the text behind would be misleading input
    // state ("is this still what I'm filtering by?").
    setQuery('');
    setHighlighted(-1);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      setQuery('');
      setHighlighted(-1);
      inputRef.current?.blur();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (orderedMatches.length === 0) return;
      setHighlighted(prev => {
        if (prev < 0 || prev >= orderedMatches.length - 1) return 0;
        return prev + 1;
      });
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (orderedMatches.length === 0) return;
      setHighlighted(prev => {
        if (prev <= 0) return orderedMatches.length - 1;
        return prev - 1;
      });
      return;
    }
    if (event.key === 'Enter') {
      if (highlighted >= 0 && orderedMatches[highlighted]) {
        event.preventDefault();
        commit(highlighted);
      } else if (orderedMatches.length > 0 && !orderedMatches[highlighted]) {
        // When matches changed shape and highlighted is now invalid (negative
        // or out-of-bounds), commit the first match so Enter is never a no-op.
        event.preventDefault();
        commit(0);
      }
      return;
    }
  }

  const activeDescendant =
    highlighted >= 0 && orderedMatches[highlighted]
      ? `${optionIdPrefix}-opt-${highlighted}`
      : undefined;

  // Pre-derive whether to show the "No matches" hint so we can gate the CSS
  // class alongside it. The hint is announced as a status region so screen-
  // reader users hear it surface as they type.
  const showNoMatches = query.trim() !== '' && orderedMatches.length === 0;

  // Build a lookup map from species code → position in orderedMatches so the
  // render can derive each option's flat index without a mutable counter.
  const optionIndexMap = useMemo(() => {
    const m = new Map<string, number>();
    orderedMatches.forEach((opt, i) => m.set(opt.code, i));
    return m;
  }, [orderedMatches]);

  return (
    <div
      className="species-autocomplete"
      data-position={position}
    >
      <input
        ref={inputRef}
        type="search"
        className="species-autocomplete-input"
        role="combobox"
        aria-label="Search species"
        aria-autocomplete="list"
        aria-expanded={listboxOpen}
        aria-controls={listboxId}
        aria-activedescendant={activeDescendant}
        placeholder="Start typing a species…"
        value={query}
        onChange={e => {
          const next = e.target.value;
          // Fire search-start on empty → non-empty transition so the
          // parent can clear any filter that would collapse the catalog.
          if (query === '' && next !== '') {
            onSearchStart?.();
          }
          setQuery(next);
        }}
        onKeyDown={handleKeyDown}
      />

      {listboxOpen && (
        <ul
          id={listboxId}
          role="listbox"
          className="species-autocomplete-listbox"
          aria-label="Species suggestions"
        >
          {/* Flat-sentinel pattern: group headers are <li role="presentation"> siblings
              of the option elements, not wrapper containers. This preserves the ARIA
              ownership chain required by WAI-ARIA 1.2 — listbox owns option directly. */}
          {groups.map(group => {
            const headerId = `${groupIdPrefix}-grp-${group.code}`;
            return (
              <Fragment key={group.code}>
                <li
                  role="presentation"
                  id={headerId}
                  className="autocomplete-group-header"
                >
                  {group.displayName}
                </li>
                {group.items.map(m => {
                  const i = optionIndexMap.get(m.code)!;
                  const id = `${optionIdPrefix}-opt-${i}`;
                  const selected = i === highlighted;
                  return (
                    <li
                      key={m.code}
                      id={id}
                      role="option"
                      aria-selected={selected}
                      className={`species-autocomplete-option${selected ? ' is-highlighted' : ''}`}
                      // onMouseDown (not onClick) so commit fires before the input
                      // loses focus — prevents a visible close-then-reopen flash.
                      onMouseDown={e => {
                        e.preventDefault();
                        commit(i);
                      }}
                      onMouseEnter={() => setHighlighted(i)}
                    >
                      {m.comName}
                    </li>
                  );
                })}
              </Fragment>
            );
          })}
        </ul>
      )}

      {showNoMatches && (
        <div
          className="species-autocomplete-no-matches"
          role="status"
          aria-live="polite"
        >
          No matches
        </div>
      )}
    </div>
  );
}

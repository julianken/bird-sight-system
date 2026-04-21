import { memo, type KeyboardEvent } from 'react';
import type { Observation } from '@bird-watch/shared-types';
import { formatRelativeTime } from '../utils/format-time.js';

export interface ObservationFeedRowProps {
  observation: Observation;
  now: Date;
  onSelectSpecies: (speciesCode: string) => void;
}

/**
 * Single feed row. DOM column order:
 *   notable badge → comName → count chip → locName → relative time
 *
 * The row is a semantic `<li>` styled as `role="button"` so both assistive
 * technology and pointer/keyboard users get a single clickable target per
 * observation. Enter and Space activate it; click opens the SpeciesPanel
 * via `?species=` (the parent FeedSurface maps speciesCode → URL state).
 *
 * Row-level `isNotable` is INDEPENDENT of the global `?notable=true` filter.
 * A user toggling "Notable only" narrows the FEED (parent filters the list)
 * but the badge still renders on every remaining row whose observation.
 * isNotable is true — see ObservationFeedRow.test.tsx for the contract.
 *
 * Memoised so a 2000-row feed does not re-render every row on unrelated
 * state changes (filter toggles, SurfaceNav tab focus). Identity-stable
 * props from the parent (`onSelectSpecies` via useCallback, `now` via a
 * top-level ref) are required for the memo to actually fire.
 */
function ObservationFeedRowImpl(props: ObservationFeedRowProps) {
  const { observation, now, onSelectSpecies } = props;

  function activate() {
    onSelectSpecies(observation.speciesCode);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLLIElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate();
    }
  }

  // howMany display rules (per spec):
  //   null → "—" (em dash)
  //   1    → chip omitted (solo sighting is the default; no noise)
  //   >1   → "×N" chip
  const countContent: { chip: string | null; dash: boolean } =
    observation.howMany === null
      ? { chip: null, dash: true }
      : observation.howMany > 1
      ? { chip: `×${observation.howMany}`, dash: false }
      : { chip: null, dash: false };

  return (
    <li
      className={`feed-row${observation.isNotable ? ' feed-row-notable' : ''}`}
      tabIndex={0}
      role="button"
      aria-label={`${observation.comName}, ${formatRelativeTime(observation.obsDt, now)}${observation.locName ? `, at ${observation.locName}` : ''}`}
      onClick={activate}
      onKeyDown={handleKeyDown}
    >
      {observation.isNotable && (
        <span
          className="feed-row-badge"
          aria-label="Notable sighting"
          title="Notable sighting"
        >
          {/* Visible "!" glyph — aria-label above carries the accessible name. */}
          <span aria-hidden="true">!</span>
        </span>
      )}
      <span className="feed-row-name">{observation.comName}</span>
      {countContent.chip !== null && (
        <span className="feed-row-count" aria-label={`Count ${observation.howMany}`}>
          {countContent.chip}
        </span>
      )}
      {countContent.dash && (
        <span className="feed-row-count feed-row-count-unknown" aria-label="Count unknown">—</span>
      )}
      {observation.locName !== null && (
        <span className="feed-row-loc">{observation.locName}</span>
      )}
      <span className="feed-row-time">
        {formatRelativeTime(observation.obsDt, now)}
      </span>
    </li>
  );
}

export const ObservationFeedRow = memo(ObservationFeedRowImpl);

import { memo } from 'react';
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
 * The visual row is a `<button>` nested inside an `<li>` — WCAG requires
 * `<ol>` children to be `listitem`s, so we cannot put `role="button"`
 * directly on the `<li>` (axe's `aria-required-children` rule fires,
 * tripping the WCAG 2.1 AA gate in `e2e/axe.spec.ts`). The button carries
 * the accessible name, focus, and keyboard semantics; the `<li>` keeps the
 * list structure intact. Enter/Space get native-button behaviour for free.
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

  // Build ONE comprehensive accessible name on the button. Children's
  // aria-label/aria-labelledby are silenced when the parent carries an
  // aria-label, so the button must carry every signal we want announced.
  // Order matches the plan's spec (#116 + Plan 6 Task 7): notable flag →
  // comName → count → locName → relative time.
  const countSlot =
    observation.howMany === null
      ? 'count unknown'
      : observation.howMany > 1
      ? `${observation.howMany} birds`
      : null;
  const ariaLabel = [
    observation.isNotable ? 'Notable sighting' : null,
    observation.comName,
    countSlot,
    observation.locName ? `at ${observation.locName}` : null,
    formatRelativeTime(observation.obsDt, now),
  ]
    .filter((s): s is string => s !== null)
    .join(', ');

  return (
    <li className="feed-row-item">
      <button
        type="button"
        className={`feed-row${observation.isNotable ? ' feed-row-notable' : ''}`}
        aria-label={ariaLabel}
        onClick={activate}
      >
        {observation.isNotable && (
          <span className="feed-row-badge" aria-hidden="true" title="Notable sighting">
            !
          </span>
        )}
        <span className="feed-row-name" aria-hidden="true">{observation.comName}</span>
        {countContent.chip !== null && (
          <span className="feed-row-count" aria-hidden="true">
            {countContent.chip}
          </span>
        )}
        {countContent.dash && (
          <span className="feed-row-count feed-row-count-unknown" aria-hidden="true">—</span>
        )}
        {observation.locName !== null && (
          <span className="feed-row-loc" aria-hidden="true">{observation.locName}</span>
        )}
        <span className="feed-row-time" aria-hidden="true">
          {formatRelativeTime(observation.obsDt, now)}
        </span>
      </button>
    </li>
  );
}

export const ObservationFeedRow = memo(ObservationFeedRowImpl);

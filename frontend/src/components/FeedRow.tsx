import { memo } from 'react';
import type { Observation } from '@bird-watch/shared-types';
import { formatRelativeTime } from '../utils/format-time.js';
import { FamilySilhouette } from './ds/FamilySilhouette.js';

export interface FeedRowProps {
  observation: Observation;
  now: Date;
  onSelectSpecies: (speciesCode: string) => void;
  /**
   * Concrete hex color from the DB silhouettes payload resolved by the
   * parent (FeedSurface) via buildFamilyColorResolver. When provided,
   * overrides the palette channel fill in <FamilySilhouette>. When absent,
   * falls back to the null-family grey (graceful degradation).
   */
  color?: string;
  /**
   * Raw SVG path string from the DB silhouettes payload resolved by the
   * parent (FeedSurface) via buildFamilyPathResolver. When provided,
   * overrides the abstract FAMILY_PATHS lookup in <FamilySilhouette>.
   * When absent, falls back to the abstract palette path (graceful degradation).
   */
  pathD?: string | null;
}

/**
 * Flat feed list row. Replaces the emoji/glyph approach of the v3 mock with
 * a `<FamilySilhouette layout="thumb">` in the leading slot. The silhouette
 * is always present: null familyCode renders the neutral grey generic-bird
 * path (see docs/design/01-spec/components.md §<FamilySilhouette>).
 *
 * DOM structure:
 *   <li .feed-row-item>
 *     <button .feed-row [.feed-row-notable]>
 *       <FamilySilhouette layout="thumb" />   ← leading silhouette thumb
 *       <span .feed-row-name>comName</span>
 *       [<span .feed-row-count>×N</span>]     ← omitted when howMany === 1
 *       [<span .feed-row-count-unknown>—</span>]  ← when howMany === null
 *       [<span .feed-row-loc>locName</span>]
 *       <span .feed-row-time>relative time</span>
 *     </button>
 *   </li>
 *
 * ARIA contract (preserved from ObservationFeedRow, issue #117):
 *   Single aria-label on the button combines all five slots in fixed order:
 *   notable flag → comName → count → locName → relative time.
 *   All child spans are aria-hidden. The button receives focus; Enter/Space
 *   activate natively. The <li> keeps the list structure intact per WCAG
 *   (aria-required-children on <ol> expects listitem, not button directly).
 *
 * Notable on flat rows: class modifier `.feed-row-notable` only.
 *   No separate "!" glyph badge (that lives on <FeedCard> for the elevated
 *   card treatment). Color alone is not the signal — the class adds a left
 *   border accent per the accent-discipline rules (colour + structural
 *   discriminator). The ARIA label prefix "Notable sighting" is preserved.
 *
 * Memoised for the same reason as ObservationFeedRow: a 300+ row feed must
 * not re-render every row on filter toggle or tab focus. Requires
 * identity-stable onSelectSpecies (useCallback in parent).
 */
function FeedRowImpl(props: FeedRowProps) {
  const { observation, now, onSelectSpecies, color, pathD } = props;

  function activate() {
    onSelectSpecies(observation.speciesCode);
  }

  const countContent: { chip: string | null; dash: boolean } =
    observation.howMany === null
      ? { chip: null, dash: true }
      : observation.howMany > 1
      ? { chip: `×${observation.howMany}`, dash: false }
      : { chip: null, dash: false };

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
        <FamilySilhouette
          family={observation.familyCode}
          layout="thumb"
          {...(color !== undefined ? { color } : {})}
          {...(pathD != null ? { pathD } : {})}
        />
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

export const FeedRow = memo(FeedRowImpl);

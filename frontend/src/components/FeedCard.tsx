import type { NotableObservation } from '@bird-watch/shared-types';
import { formatRelativeTime } from '../utils/format-time.js';
import { FamilySilhouette } from './ds/FamilySilhouette.js';

export interface FeedCardProps {
  /**
   * Narrowed to NotableObservation — callers must guard with `o.isNotable`
   * before passing. FeedSurface already does this in the topNotable branch.
   * The type system enforces the notable contract at compile time rather than
   * relying on structural trust at runtime.
   */
  observation: NotableObservation;
  now: Date;
  onSelectSpecies: (speciesCode: string) => void;
  /**
   * Concrete hex color from the DB silhouettes payload. When provided, overrides
   * the palette channel fill in <FamilySilhouette>. Absent = palette/grey fallback.
   */
  color?: string;
  /**
   * Raw SVG path string from the DB silhouettes payload. When provided, overrides
   * the abstract FAMILY_PATHS lookup in <FamilySilhouette>.
   * Absent = abstract palette path fallback.
   */
  pathD?: string | null;
}

/**
 * Elevated card treatment for the top-notable observation in the feed.
 *
 * Used by FeedSurface for the single most-recent notable observation. The
 * card renders at higher visual weight than <FeedRow>:
 *   - <FamilySilhouette layout="inline"> (larger than "thumb")
 *   - Species name as a heading element
 *   - NOTABLE meta-label using .feed-card-meta → --color-accent-notable-fg
 *   - Location + time on a second line
 *
 * Accent discipline: the NOTABLE label MUST reference .feed-card-meta which
 * maps to --color-accent-notable-fg. Never use --color-decision-point here.
 * The stylelint guard in package.json enforces this at CI time:
 *   grep -rE 'var\(--color-decision-point\).*notable' frontend/src/
 *
 * ARIA contract: single button wraps the entire card for keyboard nav.
 * The button's aria-label mirrors the FeedRow five-slot contract so SR
 * experience is consistent across card and row treatments:
 *   "Notable sighting, {comName}, [{N} birds,] [at {locName},] {relative time}"
 * The internal heading + meta text are aria-hidden (subsumed by aria-label).
 *
 * DOM:
 *   <li .feed-card-item>
 *     <button .feed-card [aria-label]>
 *       <FamilySilhouette layout="inline" />
 *       <div .feed-card-body>
 *         <span .feed-card-meta>NOTABLE</span>
 *         [<span .feed-card-count>×N</span>]
 *         <h2 .feed-card-name aria-hidden>comName</h2>
 *         <p .feed-card-detail aria-hidden>locName · relative time</p>
 *       </div>
 *     </button>
 *   </li>
 */
export function FeedCard(props: FeedCardProps) {
  const { observation, now, onSelectSpecies, color, pathD } = props;

  const countSlot =
    observation.howMany === null
      ? 'count unknown'
      : observation.howMany > 1
      ? `${observation.howMany} birds`
      : null;

  const ariaLabel = [
    'Notable sighting',
    observation.comName,
    countSlot,
    observation.locName ? `at ${observation.locName}` : null,
    formatRelativeTime(observation.obsDt, now),
  ]
    .filter((s): s is string => s !== null)
    .join(', ');

  const countChip =
    observation.howMany !== null && observation.howMany > 1
      ? `×${observation.howMany}`
      : null;

  return (
    <li className="feed-card-item">
      <button
        type="button"
        className="feed-card"
        aria-label={ariaLabel}
        onClick={() => onSelectSpecies(observation.speciesCode)}
      >
        <FamilySilhouette
          family={observation.familyCode}
          layout="inline"
          {...(color !== undefined ? { color } : {})}
          {...(pathD != null ? { pathD } : {})}
        />
        <div className="feed-card-body">
          <span className="feed-card-meta" aria-hidden="true">NOTABLE</span>
          {countChip !== null && (
            <span className="feed-card-count" aria-hidden="true">{countChip}</span>
          )}
          {/* h2 is NOT aria-hidden — screen readers can navigate by heading
              level. The button's aria-label is the comprehensive accessible
              name; the heading is a redundant but valid structural landmark. */}
          <h2 className="feed-card-name">{observation.comName}</h2>
          <p className="feed-card-detail" aria-hidden="true">
            {observation.locName && <span>{observation.locName}</span>}
            <span>{formatRelativeTime(observation.obsDt, now)}</span>
          </p>
        </div>
      </button>
    </li>
  );
}

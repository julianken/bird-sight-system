import { memo } from 'react';
import type { Hotspot } from '@bird-watch/shared-types';
import { formatCoords } from '../utils/format-coords.js';
import { formatRelativeTime } from '../utils/format-time.js';

export interface HotspotRowProps {
  hotspot: Hotspot;
  now: Date;
}

/**
 * Threshold (in days) past which a hotspot's latestObsDt is considered
 * stale and the row is visually de-emphasized. Exported so HotspotRow.test
 * can reference the same constant rather than hard-coding the magic number
 * on both sides.
 *
 * Per spec: null latestObsDt OR age > 30 days → stale. Boundary is strict
 * (>, not >=) — a hotspot observed exactly 30 days ago is still fresh.
 */
export const STALE_THRESHOLD_DAYS = 30;

const DAY_MS = 24 * 60 * 60_000;

/**
 * A single row in the ?view=hotspots surface.
 *
 * DOM column order (see HotspotListSurface + styles.css):
 *   locName → numSpeciesAlltime chip → coords → relative time of latestObsDt
 *
 * Accessibility contract (matches ObservationFeedRow post-PR-#135 fix):
 *   - The row itself (`<li>`) carries ONE comprehensive aria-label
 *     combining every announceable slot. Order:
 *       locName, `${N} species`, at ${coords}, last seen ${time}
 *   - Every child `<span>` carries `aria-hidden="true"` so screen readers
 *     don't read each signal twice. ARIA accname computation silences
 *     child labels on a labelled parent anyway, but being explicit makes
 *     the contract legible.
 *   - Clicking a row is a NO-OP in release 1 (see HotspotListSurface).
 *     Because there is no click target, the row is a static `<li>` with
 *     no nested button — unlike FeedRow which wraps a `<button>` for
 *     species-panel activation.
 *
 * Stale handling:
 *   - `latestObsDt === null` → row reads "no recent activity" both in the
 *     visible time slot and in the accessible name. Stale class applied.
 *   - `latestObsDt` older than STALE_THRESHOLD_DAYS → row still shows the
 *     formatted relative time (e.g. "Apr 1"); only the stale CSS class is
 *     added for de-emphasis. The stale signal IS the information.
 *
 * Memoised because HotspotListSurface may render hundreds of rows and
 * re-render on every sort-toggle click — rows whose `hotspot` reference
 * didn't change should bail out.
 */
function HotspotRowImpl(props: HotspotRowProps) {
  const { hotspot, now } = props;

  const ageMs =
    hotspot.latestObsDt === null
      ? Infinity
      : now.getTime() - new Date(hotspot.latestObsDt).getTime();
  const stale =
    hotspot.latestObsDt === null || ageMs > STALE_THRESHOLD_DAYS * DAY_MS;

  const coords = formatCoords(hotspot.lat, hotspot.lng);
  const timeLabel =
    hotspot.latestObsDt === null
      ? 'no recent activity'
      : formatRelativeTime(hotspot.latestObsDt, now);
  const countLabel =
    hotspot.numSpeciesAlltime === null
      ? '— species'
      : `${hotspot.numSpeciesAlltime} species`;

  // Build ONE comprehensive accessible name on the <li>. Children are
  // aria-hidden. Same contract #116 PR #135 pinned for FeedRow.
  const ariaLabel = [
    hotspot.locName,
    countLabel,
    `at ${coords}`,
    `last seen ${timeLabel}`,
  ].join(', ');

  const className = `hotspot-row${stale ? ' hotspot-row-stale' : ''}`;

  return (
    <li className={className} aria-label={ariaLabel}>
      <span className="hotspot-row-name" aria-hidden="true">
        {hotspot.locName}
      </span>
      <span className="hotspot-row-count" aria-hidden="true">
        {countLabel}
      </span>
      <span className="hotspot-row-coords" aria-hidden="true">
        {coords}
      </span>
      <span className="hotspot-row-time" aria-hidden="true">
        {timeLabel}
      </span>
    </li>
  );
}

export const HotspotRow = memo(HotspotRowImpl);

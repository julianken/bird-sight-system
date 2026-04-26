import type { Observation } from '@bird-watch/shared-types';

export interface ObservationPopoverProps {
  observation: Observation | null;
  onClose: () => void;
  /**
   * Issue #246: switch to the species-detail surface for the observation's
   * species. Wired in App.tsx to `set({ view: 'detail', detail: code })`
   * via `useUrlState` — NOT a `<a href>` because:
   *   1. App.tsx mounts surfaces mutually-exclusive (no #species-detail
   *      anchor exists during view=map), so a hash-link wouldn't have a
   *      target to scroll to.
   *   2. A real navigation would reload the page; the URL-state setter
   *      keeps the SPA in-place. Mirrors the skip-link pattern from #247.
   *
   * Optional so existing callers (older tests, demo harness) still
   * type-check; the link is hidden when omitted (no clickable surface
   * without a destination).
   */
  onSelectSpecies?: (speciesCode: string) => void;
}

/**
 * Inline popover shown when an unclustered observation point is clicked on
 * the map. Displays the species common name, location, timestamp, optional
 * count, a notable badge when applicable, and a "See species details" link
 * that routes to the SpeciesDetail surface for the observation's species.
 */
export function ObservationPopover({
  observation,
  onClose,
  onSelectSpecies,
}: ObservationPopoverProps) {
  if (!observation) return null;

  const dateStr = new Date(observation.obsDt).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <div
      className="observation-popover"
      role="dialog"
      aria-label={`Details for ${observation.comName}`}
    >
      <div className="observation-popover-header">
        <span className="observation-popover-name">
          {observation.comName}
        </span>
        {observation.isNotable && (
          <span className="observation-popover-badge" aria-label="Notable">
            !
          </span>
        )}
        <button
          type="button"
          className="observation-popover-close"
          onClick={onClose}
          aria-label="Close"
        >
          &times;
        </button>
      </div>
      {observation.locName && (
        <div className="observation-popover-location">
          {observation.locName}
        </div>
      )}
      <div className="observation-popover-time">{dateStr}</div>
      {observation.howMany != null && (
        <div className="observation-popover-count">
          Count: {observation.howMany}
        </div>
      )}
      {onSelectSpecies && (
        <button
          type="button"
          className="observation-popover-detail-link"
          onClick={() => onSelectSpecies(observation.speciesCode)}
        >
          See species details &rarr;
        </button>
      )}
    </div>
  );
}

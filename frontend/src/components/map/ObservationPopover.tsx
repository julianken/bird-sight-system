import type { Observation } from '@bird-watch/shared-types';

export interface ObservationPopoverProps {
  observation: Observation | null;
  onClose: () => void;
}

/**
 * Inline popover shown when an unclustered observation point is clicked on
 * the map. Displays the species common name, location, timestamp, and a
 * notable badge when applicable.
 *
 * No navigation links — that belongs to #151 (species detail wiring).
 */
export function ObservationPopover({ observation, onClose }: ObservationPopoverProps) {
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
    </div>
  );
}

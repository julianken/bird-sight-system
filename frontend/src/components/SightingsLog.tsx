import type { ApiClient } from '../api/client.js';
import type { Since } from '../state/url-state.js';
import type { SightingsContext } from './sightings-context.js';
import { useSightingsRows } from '../data/use-sightings-rows.js';

/**
 * Client-side visible-row cap for the zoom>=6 leaf path (epic #1299 Decisions
 * §5). A busy single-species cluster could otherwise materialize an arbitrarily
 * long list in the desktop Rail. The cap is a plain `slice` (no virtualization,
 * no count animation — #953); the same banner the F3 zoom<6 server-truncation
 * path renders carries the overflow signal.
 */
const MAX_VISIBLE_ROWS = 50;

export interface SightingsLogProps {
  apiClient: ApiClient;
  speciesCode: string;
  context: SightingsContext | null;
  since?: Since;
}

/**
 * Per-sighting log shown inside the species-detail surface (epic #1299, F2
 * #1301). After a marker click selects a species, it lists that species'
 * individual sightings under the clicked marker — one static row each:
 * time · exact location · count (only when >1) · notable "!". Rows are
 * display-only and NEVER animated (the counts are camera-coupled — #953).
 *
 * Row formatting mirrors `ObservationPopover` for time + location, but the
 * count column is a DELIBERATE divergence: the popover shows count whenever
 * `howMany != null` (it can show "Count: 1"); the log shows the count column
 * ONLY when `howMany > 1`.
 *
 * This is a SECTION of the existing Transient detail surface — it claims no new
 * floating corner (four-corner anchor contract, CLAUDE.md / spec §3).
 */
export function SightingsLog({ apiClient, speciesCode, context, since }: SightingsLogProps) {
  const { rows, total, truncated, loading, error, supported } = useSightingsRows(
    apiClient,
    speciesCode,
    context,
    since,
  );
  // No context / cell-with-no-species / zoom<6 cluster-list → nothing to show.
  if (!supported) return null;
  // F3 (#1302) cell path: while the per-cell fetch is in flight, show a minimal
  // STATIC loading line — no spinner and no count animation (#953: the counts
  // are camera-coupled and must never animate). The leaf path is synchronous so
  // `loading` is never true there.
  if (loading) {
    return (
      <section className="detail-fg-sightings" aria-label="Sightings under this marker">
        <h2 className="detail-fg-sightings-eyebrow">Sightings here</h2>
        <p className="detail-fg-sightings-loading">Loading sightings…</p>
      </section>
    );
  }
  // On error, render nothing — the species-detail panel already has the species;
  // a failed per-cell fetch is non-essential supplementary recency, not a
  // panel-blocking failure. A resolved fetch with 0 rows ALSO renders nothing
  // (omit the section rather than show an empty shell).
  if (error || rows.length === 0) return null;

  const visibleRows = rows.slice(0, MAX_VISIBLE_ROWS);
  const overflow = rows.length > MAX_VISIBLE_ROWS;

  return (
    <section className="detail-fg-sightings" aria-label="Sightings under this marker">
      <h2 className="detail-fg-sightings-eyebrow">Sightings here</h2>
      <ul className="detail-fg-sightings-list">
        {visibleRows.map((r) => (
          <li className="detail-fg-sighting-row" key={r.subId}>
            <span className="detail-fg-sighting-time">
              {new Date(r.obsDt).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </span>
            {r.locName && <span className="detail-fg-sighting-location">{r.locName}</span>}
            {r.howMany != null && r.howMany > 1 && (
              <span className="detail-fg-sighting-count">{`×${r.howMany}`}</span>
            )}
            {r.isNotable && (
              <span className="detail-fg-sighting-notable" aria-label="Notable">
                !
              </span>
            )}
          </li>
        ))}
      </ul>
      {(truncated || overflow) && (
        <p className="detail-fg-sightings-truncation">
          Showing latest {visibleRows.length} of {total}
        </p>
      )}
    </section>
  );
}

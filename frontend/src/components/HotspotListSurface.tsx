import { useMemo, useState } from 'react';
import type { Hotspot } from '@bird-watch/shared-types';
import { HotspotRow } from './HotspotRow.js';

export interface HotspotListSurfaceProps {
  loading: boolean;
  hotspots: Hotspot[];
  now: Date;
}

/**
 * Sort mode for the hotspot list.
 *
 * - `latest` — latestObsDt DESC, NULL last. Default and most-used mode.
 * - `richness-desc` — numSpeciesAlltime DESC, NULL last.
 * - `richness-asc` — numSpeciesAlltime ASC, NULL last.
 *
 * NULL-last convention holds across all three modes: a hotspot with a
 * null sort key is always pushed to the bottom so "quality" rows never
 * sink. This mirrors SQL `ORDER BY ... DESC NULLS LAST`.
 */
type SortMode = 'latest' | 'richness-desc' | 'richness-asc';

const SORT_CYCLE: readonly SortMode[] = ['latest', 'richness-desc', 'richness-asc'];

// Visible labels for each sort mode. Uses an em-dash separator so the
// toggle communicates both axis (latest vs richness) and direction (↓ ↑)
// in a single short string.
const SORT_LABELS: Record<SortMode, string> = {
  latest: 'Sort: Latest',
  'richness-desc': 'Sort: Most species',
  'richness-asc': 'Sort: Fewest species',
};

/**
 * Compare two possibly-null dates. Returns a negative/zero/positive number
 * so callers can slot this into `Array.sort`. Nulls always rank LAST
 * regardless of the comparison direction.
 */
function compareLatestDesc(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  // Lexicographic ISO-8601 compare is equivalent to chronological compare
  // because eBird timestamps are all in the same TZ format. Descending:
  // newer (larger string) first.
  if (a > b) return -1;
  if (a < b) return 1;
  return 0;
}

/**
 * Compare two possibly-null numbers with a caller-chosen direction. Nulls
 * always rank LAST — the `dir` flag applies only to non-null values.
 */
function compareNumber(
  a: number | null,
  b: number | null,
  dir: 'asc' | 'desc',
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return dir === 'desc' ? b - a : a - b;
}

/**
 * The `?view=hotspots` surface: an ordered list of hotspot rows with a
 * local sort-mode toggle.
 *
 * Design choices (Plan 6 architecture §4):
 *   - Sort is LOCAL COMPONENT STATE, not URL-persisted. The Plan 6 rewrite
 *     intentionally keeps transient UI affordances out of the URL so
 *     back/forward navigation stays about the content selection (species
 *     / family / view), not the sort order.
 *   - The toggle is a three-way cycle (latest → richness-desc → richness-
 *     asc) rather than three separate tabs. Single control, one click per
 *     cycle — matches the minimal-chrome aesthetic of SurfaceNav.
 *
 * Empty state:
 *   - Parent hands us the already-fetched hotspots array. An empty array
 *     means zero hotspots (not an outage — errors surface as the full-
 *     screen `.error-screen` in App.tsx). Copy says "No hotspots to
 *     show." with no recovery hint.
 *
 * Row click: no-op in release 1. HotspotRow does not render a button;
 * the `<li>` is inert. Future releases may wire a species sub-panel.
 */
export function HotspotListSurface(props: HotspotListSurfaceProps) {
  const { loading, hotspots, now } = props;
  const [sort, setSort] = useState<SortMode>('latest');

  const sorted = useMemo(() => {
    // Copy before sorting — `Array.sort` mutates, and `hotspots` is a
    // prop reference the parent may be memoising. Mutating would leak.
    const out = hotspots.slice();
    if (sort === 'latest') {
      out.sort((a, b) => compareLatestDesc(a.latestObsDt, b.latestObsDt));
    } else if (sort === 'richness-desc') {
      out.sort((a, b) => compareNumber(a.numSpeciesAlltime, b.numSpeciesAlltime, 'desc'));
    } else {
      out.sort((a, b) => compareNumber(a.numSpeciesAlltime, b.numSpeciesAlltime, 'asc'));
    }
    return out;
  }, [hotspots, sort]);

  function advanceSort() {
    const idx = SORT_CYCLE.indexOf(sort);
    const next = SORT_CYCLE[(idx + 1) % SORT_CYCLE.length];
    if (next) setSort(next);
  }

  if (loading) {
    return (
      <div className="hotspot-list-empty" role="status" aria-live="polite">
        Loading hotspots…
      </div>
    );
  }

  if (hotspots.length === 0) {
    return (
      <div className="hotspot-list-empty" role="status">
        No hotspots to show.
      </div>
    );
  }

  return (
    <div className="hotspot-list-wrap">
      <div className="hotspot-list-toolbar">
        <button
          type="button"
          className="hotspot-list-sort"
          onClick={advanceSort}
          // aria-label spells out the control verb so screen readers
          // hear "Sort: Latest" as an actionable toggle rather than a
          // passive label. aria-pressed not used because this is a
          // three-way cycle, not a binary toggle.
          aria-label={SORT_LABELS[sort]}
        >
          {SORT_LABELS[sort]}
        </button>
      </div>
      <ol className="hotspot-list" aria-label="Hotspots">
        {sorted.map(h => (
          <HotspotRow key={h.locId} hotspot={h} now={now} />
        ))}
      </ol>
    </div>
  );
}

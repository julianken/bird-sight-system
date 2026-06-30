import { useMemo } from 'react';
import type { ApiClient } from '@/api/client.js';
import type { Since } from '@/state/url-state.js';
import type { SightingRow, SightingsContext } from '@/components/sightings-context.js';

export interface SightingsRowsState {
  rows: SightingRow[];
  /** M for the truncation banner — the FULL pre-cap count (the visible cap lives in the component). */
  total: number;
  truncated: boolean;
  loading: boolean;
  error: Error | null;
  /** `false` for a null / cell context — the cell fetch is wired in F3 (#1302). */
  supported: boolean;
}

const UNSUPPORTED: SightingsRowsState = {
  rows: [],
  total: 0,
  truncated: false,
  loading: false,
  error: null,
  supported: false,
};

/**
 * The Sightings-Log data hook (epic #1299, F2 #1301).
 *
 * F2 implements ONLY the `leaves` branch — the rows are already on the client
 * (cached cluster leaves at zoom>=6), so this filters by species + sorts
 * newest-first with no fetch. A `null` or `cell` context is `supported: false`
 * (the cell fetch lands in F3, which replaces the cell arm). `apiClient` and
 * `since` are unused this PR but stay in the signature so F3 adds the fetch
 * WITHOUT a signature change. The hook does NOT apply the visible-row cap —
 * `total` is the full pre-cap count; the cap lives in `<SightingsLog>` so it
 * bounds both the leaf path and the F3 cell path identically.
 */
export function useSightingsRows(
  apiClient: ApiClient,
  speciesCode: string,
  context: SightingsContext | null,
  since?: Since,
): SightingsRowsState {
  // F2: not yet consumed — F3 forwards both to the cell fetch.
  void apiClient;
  void since;
  return useMemo<SightingsRowsState>(() => {
    if (context && context.kind === 'leaves') {
      const rows = context.rows
        .filter((r) => r.speciesCode === speciesCode)
        .sort((a, b) => b.obsDt.localeCompare(a.obsDt));
      return { rows, total: rows.length, truncated: false, loading: false, error: null, supported: true };
    }
    return UNSUPPORTED;
  }, [context, speciesCode]);
}

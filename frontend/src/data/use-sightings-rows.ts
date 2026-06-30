import { useEffect, useMemo, useRef, useState } from 'react';
import type { ApiClient } from '@/api/client.js';
import type { Observation } from '@bird-watch/shared-types';
import type { Since } from '@/state/url-state.js';
import type { SightingRow, SightingsContext } from '@/components/sightings-context.js';

export interface SightingsRowsState {
  rows: SightingRow[];
  /** M for the truncation banner — the FULL pre-cap count (the visible cap lives in the component). */
  total: number;
  truncated: boolean;
  loading: boolean;
  error: Error | null;
  /** `false` for a null context (or a cell context with no species yet). */
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
 * Project a FULL `Observation` (the F3 zoom<6 cell path) down to the narrow
 * `SightingRow` the log renders.
 *
 * Distinct from F2's `leafToSightingRow` (which reads stamped maplibre-feature
 * `properties` defensively) and from `observationToSightingRow` in
 * `sightings-context.ts` (the single-Observation popover seam): the cell fetch
 * yields `Observation[]` straight off the wire (B1, `locId` present), so this
 * is a direct field pick — no widening, no defensive narrowing. Keeping it here
 * (not in `sightings-context.ts`) co-locates it with the only consumer (the
 * cell branch below) and keeps the hook's `rows` type uniform across both arms.
 */
function observationToSightingRow(o: Observation): SightingRow {
  return {
    subId: o.subId,
    speciesCode: o.speciesCode,
    obsDt: o.obsDt,
    locName: o.locName,
    howMany: o.howMany,
    isNotable: o.isNotable,
  };
}

/**
 * The Sightings-Log data hook (epic #1299; F2 #1301 leaf path, F3 #1302 cell
 * path).
 *
 *  - `leaves` (zoom>=6): rows are already on the client (cached cluster leaves /
 *    the clicked observation), so this filters by species + sorts newest-first
 *    with NO fetch — a pure `useMemo`.
 *  - `cell` (zoom<6 single bucket): the map renders the precomputed count-only
 *    grid, so the per-species rows for the clicked bucket are fetched on demand
 *    from `GET /api/observations/cell` (B1). The fetched `Observation[]` is
 *    projected to `SightingRow[]`; `total` is `meta.cellObservationCount` (the
 *    truncation-banner denominator M, NOT `rows.length`), and `truncated` is the
 *    server's row-brake flag.
 *  - `null` / `cell` with no species → `supported: false` (component renders
 *    nothing).
 *
 * The hook does NOT apply the visible-row cap — `total` is the full pre-cap
 * count; the cap lives in `<SightingsLog>` so it bounds the leaf and cell paths
 * identically.
 *
 * STALENESS: the cell fetch is NOT abortable (the client passes no AbortSignal).
 * A rapid species/cell/window change is guarded by a plain `cancelled` boolean
 * closed over by the effect cleanup (the same pattern as `use-species-detail.ts`
 * / `useBirdData`): a resolution that arrives after the inputs changed is
 * dropped before it can call `setState`, so a superseded fetch never paints
 * stale rows.
 */
export function useSightingsRows(
  apiClient: ApiClient,
  speciesCode: string,
  context: SightingsContext | null,
  since?: Since,
): SightingsRowsState {
  // Leaf / unsupported result — synchronous, recomputed only when the inputs
  // that feed it change. A `cell` context routes through the fetch effect below
  // (this memo returns null for it so the effect-driven state wins).
  const syncState = useMemo<SightingsRowsState | null>(() => {
    if (context && context.kind === 'leaves') {
      const rows = context.rows
        .filter((r) => r.speciesCode === speciesCode)
        .sort((a, b) => b.obsDt.localeCompare(a.obsDt));
      return { rows, total: rows.length, truncated: false, loading: false, error: null, supported: true };
    }
    if (context === null) return UNSUPPORTED;
    // A cell context with no selected species yet can never resolve to rows —
    // short-circuit to unsupported so the effect issues no doomed fetch.
    if (context.kind === 'cell' && speciesCode === '') return UNSUPPORTED;
    return null; // cell with a real species — handled by the fetch effect.
  }, [context, speciesCode]);

  const isCellFetch = syncState === null;

  // The cell branch is keyed on the exact PRIMITIVES a single fetch depends on
  // (not the `context` object) so a referentially-new-but-value-equal context
  // never re-fetches, while a real change to any field cancels the prior fetch
  // and re-runs.
  const cell = context?.kind === 'cell' ? context : null;
  const lngBucket = cell?.lngBucket;
  const latBucket = cell?.latBucket;
  const gridMultiplier = cell?.gridMultiplier;
  const scopeKey = cell?.scopeKey;

  const CELL_LOADING: SightingsRowsState = { ...UNSUPPORTED, supported: true, loading: true };

  const [cellState, setCellState] = useState<SightingsRowsState>(CELL_LOADING);

  // STALE-PAINT FIX (R8, F3 second pass). `cellState` is useState, so when the
  // cell fetch's identity changes (the most load-bearing case: a SAME-bucket
  // species SWITCH), the FIRST render under the new inputs would otherwise hand
  // back the PRIOR fetch's resolved rows for one commit — `return syncState ??
  // cellState` returns them because `syncState` is still null (the context kind
  // is unchanged) and the loading-reset only happens later, in the effect. That
  // is a one-frame flash of the wrong species' rows. We reset to loading
  // SYNCHRONOUSLY during render (the React "adjust state on prop change" pattern,
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders)
  // the instant the fetch key changes: `setCellState` reconciles the stored
  // state for subsequent renders, and `effectiveCellState` makes THIS render
  // return the loading state too — so no commit ever paints stale rows. The
  // effect below still owns the actual fetch + the cancelled-flag guard against a
  // late resolution; this only kills the synchronous leak. The key spans every
  // primitive the fetch depends on (incl. `since`); the leaf / unsupported arms
  // collapse to a stable `''` so they never trigger a reset.
  const fetchKey = isCellFetch
    ? `${scopeKey}|${gridMultiplier}|${lngBucket}|${latBucket}|${speciesCode}|${since ?? ''}`
    : '';
  const prevFetchKeyRef = useRef(fetchKey);
  let effectiveCellState = cellState;
  if (prevFetchKeyRef.current !== fetchKey) {
    prevFetchKeyRef.current = fetchKey;
    if (isCellFetch) {
      effectiveCellState = CELL_LOADING;
      setCellState(CELL_LOADING);
    }
  }

  useEffect(() => {
    if (
      !isCellFetch ||
      lngBucket === undefined ||
      latBucket === undefined ||
      gridMultiplier === undefined ||
      scopeKey === undefined
    ) {
      return;
    }
    let cancelled = false;
    setCellState({ ...UNSUPPORTED, supported: true, loading: true });

    // exactOptionalPropertyTypes: build the base arg, then assign `since` only
    // when defined — never spread a possibly-undefined value into the optional
    // key.
    const arg: Parameters<ApiClient['getCellObservations']>[0] = {
      scopeKey,
      gridMultiplier,
      lngBucket,
      latBucket,
      speciesCode,
    };
    if (since !== undefined) arg.since = since;

    apiClient
      .getCellObservations(arg)
      .then((res) => {
        if (cancelled) return;
        setCellState({
          rows: res.data.map(observationToSightingRow),
          total: res.meta.cellObservationCount,
          truncated: res.meta.truncated,
          loading: false,
          error: null,
          supported: true,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setCellState({ ...UNSUPPORTED, supported: true, loading: false, error: err as Error });
      });

    return () => {
      cancelled = true;
    };
  }, [apiClient, isCellFetch, speciesCode, since, lngBucket, latBucket, gridMultiplier, scopeKey]);

  return syncState ?? effectiveCellState;
}

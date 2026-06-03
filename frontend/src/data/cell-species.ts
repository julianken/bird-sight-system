import { useEffect, useState } from 'react';
import type { ApiClient } from '../api/client.js';
import type { ObservationFilters } from '@bird-watch/shared-types';

/**
 * Low-zoom cell species drill-in (#859).
 *
 * At map zoom < 6 the app renders in `'aggregated'` mode: the wire payload
 * carries coarse-grid FAMILY buckets only — no species code or common name
 * (`getObservationsAggregated`, `packages/db-client/src/observations.ts`).
 * `expandBucketsToSyntheticObservations` fabricates synthetic rows whose
 * `comName` is the family code and whose `speciesCode` is a non-resolvable
 * `agg-…` placeholder. A cell/cluster popover built off those rows therefore
 * showed a Latin family name and a dead link.
 *
 * This module does a minimum-data lazy per-cell fetch instead: when a low-zoom
 * popover opens, fetch the clicked cell's REAL observations by calling the same
 * `/api/observations` endpoint for the cell's small bbox with a SYNTHETIC
 * `zoom=6`. The synthetic zoom is load-bearing in two places at once:
 *   1. `services/read-api/src/app.ts:240` only diverts to the aggregated path
 *      when `zoom < 6`, so `zoom=6` reaches the per-observation branch (real
 *      rows with species code + common name).
 *   2. `assertBboxAreaCap` (`services/read-api/src/validate.ts`) rejects only
 *      `lngSpan > 45 || latSpan > 25`, and only when `zoom >= 6`. A single
 *      aggregation cell is `1/gridMultiplier` per axis (≤0.5°), far under the
 *      cap, so the cell-bbox request clears it cleanly.
 *
 * The grid payload is untouched (+0 KB); the cost is one on-demand fetch per
 * opened cell. The family legend stays fed by `families[]` off the envelope
 * independently of this path.
 */

/**
 * The coarse-grid multiplier for a given (integer-floored) map zoom. Mirrors
 * `services/read-api/src/app.ts:241` (`zoom <= 3 ? 2 : zoom === 4 ? 4 : 8`)
 * EXACTLY so the cell bbox the client computes matches the cell the server
 * aggregated. Each cell spans `1/multiplier` degrees per axis.
 */
export function gridMultiplierForZoom(gridZoom: number): number {
  return gridZoom <= 3 ? 2 : gridZoom === 4 ? 4 : 8;
}

/**
 * The bbox `[west, south, east, north]` of the aggregation cell centred on
 * `center` ([lng, lat]) at the grid zoom the buckets were fetched at. Half a
 * cell (`0.5 / multiplier`) is added on each side.
 */
export function cellBbox(
  center: readonly [number, number],
  gridZoom: number,
): [number, number, number, number] {
  const [lng, lat] = center;
  const half = 0.5 / gridMultiplierForZoom(gridZoom);
  return [lng - half, lat - half, lng + half, lat + half];
}

/** One real species row drilled out of a low-zoom cell. */
export interface CellSpecies {
  /** Real eBird code, or `null` for spuh/slash/hybrid taxa. */
  speciesCode: string | null;
  comName: string;
  count: number;
}

export interface CellSpeciesState {
  loading: boolean;
  error: Error | null;
  /** `null` until the first resolve (or while inactive); `[]` is a real empty cell. */
  species: CellSpecies[] | null;
}

export interface UseCellSpeciesArgs {
  /**
   * Whether the lazy fetch should run. The caller sets this true only in
   * aggregated (low-zoom) mode when the popover is open. False keeps the hook
   * inert (close-zoom popovers already carry real rows).
   */
  active: boolean;
  /** Cell center `[lng, lat]` (the grid marker anchor). */
  center: readonly [number, number];
  /** The integer map zoom the grid buckets were fetched at (drives the cell size). */
  gridZoom: number;
  /** Active `since` filter, threaded so the cell fetch matches the current view. */
  since?: ObservationFilters['since'];
  /** Active state scope, threaded so the cell fetch stays within scope. */
  stateCode?: string;
  /**
   * Narrow the cell fetch to a single family. The per-family `<CellPopover>`
   * passes its tile's family so it lists only that family's real species
   * (matching its heading); the flat cluster list omits it to drill the whole
   * cell. Serialized as `?family=` on the wire.
   */
  familyCode?: string;
}

const INACTIVE: CellSpeciesState = { loading: false, error: null, species: null };

/**
 * Dedupe a per-observation list into species rows. Keyed by `speciesCode` when
 * present, else by `comName` (so spuh/slash/hybrid rows with a null code still
 * collapse). First non-null code wins. Sorted by count desc, then comName asc
 * for a stable order.
 */
export function dedupeBySpecies(
  data: ReadonlyArray<{ speciesCode: string | null; comName: string }>,
): CellSpecies[] {
  const byKey = new Map<string, CellSpecies>();
  for (const o of data) {
    const key = o.speciesCode ?? `name:${o.comName}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
      if (existing.speciesCode === null && o.speciesCode !== null) {
        existing.speciesCode = o.speciesCode;
      }
    } else {
      byKey.set(key, { speciesCode: o.speciesCode, comName: o.comName, count: 1 });
    }
  }
  return Array.from(byKey.values()).sort(
    (a, b) => b.count - a.count || a.comName.localeCompare(b.comName),
  );
}

/**
 * Lazy per-cell species fetch (#859). When `active`, fetches the cell bbox at
 * synthetic `zoom=6` (real per-observation rows) and dedupes into species rows.
 * Inert otherwise. Mirrors `useSpeciesDetail`'s cancelled-flag discipline so a
 * fast re-open doesn't leave a stale resolution racing the current render.
 */
export function useCellSpecies(
  client: ApiClient,
  args: UseCellSpeciesArgs,
): CellSpeciesState {
  const { active, center, gridZoom, since, stateCode, familyCode } = args;
  const [state, setState] = useState<CellSpeciesState>(INACTIVE);

  const bbox = cellBbox(center, gridZoom);
  // Serialize the bbox for a stable dep (array identity churns each render).
  const bboxKey = bbox.join(',');

  useEffect(() => {
    if (!active) {
      setState(INACTIVE);
      return;
    }
    let cancelled = false;
    setState({ loading: true, error: null, species: null });
    const filters: ObservationFilters = {
      bbox,
      zoom: 6,
      ...(since ? { since } : {}),
      ...(stateCode ? { stateCode } : {}),
      ...(familyCode ? { familyCode } : {}),
    };
    client.getObservations(filters)
      .then(envelope => {
        if (cancelled) return;
        // Defensive: zoom=6 always reaches the per-observation branch, but if a
        // future routing change returned aggregated, treat it as empty rather
        // than rendering family-only synthetic rows again.
        const rows = envelope.mode === 'observations' ? envelope.data : [];
        setState({ loading: false, error: null, species: dedupeBySpecies(rows) });
      })
      .catch(err => {
        if (!cancelled) setState({ loading: false, error: err as Error, species: null });
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, active, bboxKey, gridZoom, since, stateCode, familyCode]);

  return state;
}

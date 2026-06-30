import type { Observation } from '@bird-watch/shared-types';

/**
 * The exact fields the SightingsLog renders (epic #1299, F2 #1301). Narrower
 * than `Observation` on purpose: maplibre cluster leaves never carry `locId`
 * (the wire never stamps it — see `observation-layers.ts`), so a full
 * `Observation` cannot be reconstructed from the zoom>=6 leaf path. Both seams
 * (the single-Observation popover seam and the cluster-leaf seam) therefore
 * agree on this same six-field projection.
 */
export interface SightingRow {
  subId: string;
  speciesCode: string;
  obsDt: string; // ISO
  locName: string | null;
  howMany: number | null;
  isNotable: boolean;
}

/**
 * What gets threaded from a marker click into the species-detail surface so the
 * log knows WHICH sightings to show.
 *
 *  - `leaves`  — zoom>=6: the rows are already on the client (cached cluster
 *    leaves / the clicked observation), no fetch.
 *  - `cell`    — zoom<6 single-bucket: identifies a `round(coord*m)/m` cell that
 *    F3 (#1302) fetches per-sighting rows for. INERT in F2 — `useSightingsRows`
 *    returns `supported: false` for it (the component renders nothing).
 */
export type SightingsContext =
  | { kind: 'leaves'; rows: SightingRow[] }
  | {
      kind: 'cell';
      lngBucket: number;
      latBucket: number;
      gridMultiplier: number;
      scopeKey: string;
    };

/** Map a full Observation (the single-Observation popover seam) to the narrow row. */
export function observationToSightingRow(o: Observation): SightingRow {
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
 * Map a `getClusterLeaves` feature's stamped properties (+ geometry) to a
 * SightingRow. Reads exactly the six fields `observation-layers.ts` stamps onto
 * every feature; it does NOT read `locId` (never on the wire) nor trust the
 * leaf's `silhouetteId` (a sprite-remapped fallback id, not the species' own).
 * Defensive narrowing keeps it total against a cold/partial leaf — a spuh leaf
 * with a `null` speciesCode maps to `''`, which can never match a real species
 * code, so it is silently excluded from any per-species log.
 */
export function leafToSightingRow(feature: {
  geometry: { coordinates: [number, number] };
  properties: Record<string, unknown>;
}): SightingRow {
  const p = feature.properties;
  return {
    subId: typeof p.subId === 'string' ? p.subId : '',
    speciesCode: typeof p.speciesCode === 'string' ? p.speciesCode : '',
    obsDt: typeof p.obsDt === 'string' ? p.obsDt : '',
    locName: typeof p.locName === 'string' ? p.locName : null,
    howMany: typeof p.howMany === 'number' ? p.howMany : null,
    isNotable: p.isNotable === true,
  };
}

/**
 * zoom -> grid_multiplier. This is the SAME mapping as the read-api's closed
 * switch (`services/read-api/src/app.ts`: `zoom <= 3 ? 2 : zoom === 4 ? 4 : 8`)
 * and is the SINGLE frontend copy of it — there is deliberately no second
 * frontend instance to drift against (the aggregated /api/observations request
 * sends only `zoom`; the server derives `m`). The `{kind:'cell'}` seam reads
 * THIS helper so its cell center and `gridMultiplier` agree with the server's
 * bucketing by construction.
 *
 * INPUT CONTRACT: must be the FLOORED integer zoom (`Math.floor(map.getZoom())`)
 * — the same integer the aggregated request sent. A raw float misclassifies the
 * switch (4.7 -> 8 instead of 4) and yields a half/double-sized cell.
 */
export function gridMultiplierForZoom(zoom: number): number {
  return zoom <= 3 ? 2 : zoom === 4 ? 4 : 8;
}

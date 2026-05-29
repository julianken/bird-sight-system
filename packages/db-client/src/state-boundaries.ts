import type { Pool } from './pool.js';
import type { StateSummary } from '@bird-watch/shared-types';

/**
 * Resolve the CONUS state a geographic point falls in (`'US-XX'`), or `null`
 * when the point is outside every CONUS state (Alaska/Hawaii/territories,
 * ocean, or beyond the simplified polygons).
 *
 * Uses `ST_Intersects` — NOT `ST_Contains` — per locked decision #1 of the
 * state-scope plan. `ST_Intersects` is inclusive at the polygon boundary, so a
 * point sitting exactly on a simplified shared border resolves into a state
 * rather than vanishing from both. When a point lands in more than one state
 * (only possible right on a shared edge), `ORDER BY state_code ASC LIMIT 1`
 * makes the result deterministic.
 */
export async function resolveStateForPoint(
  pool: Pool,
  lng: number,
  lat: number,
): Promise<string | null> {
  const { rows } = await pool.query<{ state_code: string }>(
    `SELECT state_code FROM state_boundaries
     WHERE ST_Intersects(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
     ORDER BY state_code ASC LIMIT 1`,
    [lng, lat],
  );
  return rows[0]?.state_code ?? null;
}

/**
 * List all 49 CONUS states (48 contiguous + DC) as `StateSummary` rows,
 * name-sorted, each with its precomputed bounding-box tuple `[west, south,
 * east, north]` (matching `ObservationFilters.bbox` order).
 *
 * Deliberately does NOT select `geom`: the polygon geometry must never leave
 * the server (locked decision #7). This is the single source of truth behind
 * `GET /api/states` for the frontend selector + camera framing. The bbox is a
 * pure column read of the precomputed min/max columns — no query-time
 * `ST_Envelope`.
 */
export async function listStatesWithBbox(pool: Pool): Promise<StateSummary[]> {
  const { rows } = await pool.query<{
    state_code: string;
    name: string;
    min_lng: number;
    min_lat: number;
    max_lng: number;
    max_lat: number;
  }>(
    `SELECT state_code, name, min_lng, min_lat, max_lng, max_lat
     FROM state_boundaries
     ORDER BY name ASC`,
  );
  return rows.map(r => ({
    stateCode: r.state_code,
    name: r.name,
    bbox: [r.min_lng, r.min_lat, r.max_lng, r.max_lat],
  }));
}

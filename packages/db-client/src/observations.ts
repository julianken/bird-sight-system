import type { Pool } from './pool.js';
import type { Observation, ObservationFilters } from '@bird-watch/shared-types';

export interface ObservationInput {
  subId: string;
  speciesCode: string;
  comName: string;
  lat: number;
  lng: number;
  obsDt: string;
  locId: string;
  locName: string | null;
  howMany: number | null;
  isNotable: boolean;
}

export async function upsertObservations(
  pool: Pool,
  inputs: ObservationInput[]
): Promise<number> {
  if (inputs.length === 0) return 0;

  const values: unknown[] = [];
  const placeholders: string[] = [];

  inputs.forEach((o, i) => {
    const off = i * 9;
    placeholders.push(
      `($${off + 1}, $${off + 2}, $${off + 3}, $${off + 4}, $${off + 5}, ` +
      `$${off + 6}, $${off + 7}, $${off + 8}, $${off + 9})`
    );
    values.push(
      o.subId, o.speciesCode, o.lat, o.lng, o.obsDt,
      o.locId, o.locName, o.howMany, o.isNotable
    );
  });

  const insertSql = `
    INSERT INTO observations
      (sub_id, species_code, lat, lng, obs_dt, loc_id, loc_name, how_many, is_notable)
    VALUES ${placeholders.join(',')}
    ON CONFLICT (sub_id, species_code) DO UPDATE SET
      lat        = EXCLUDED.lat,
      lng        = EXCLUDED.lng,
      obs_dt     = EXCLUDED.obs_dt,
      loc_id     = EXCLUDED.loc_id,
      loc_name   = EXCLUDED.loc_name,
      how_many   = EXCLUDED.how_many,
      is_notable = observations.is_notable OR EXCLUDED.is_notable,
      ingested_at = now()
  `;

  // Build a (sub_id, species_code) VALUES set that scopes the stamp UPDATE to
  // just the rows in this batch. Without this scoping the WHERE clause goes
  // O(table) — every batch re-scans every NULL-stamp residue row in
  // observations, which is what made the daily backfill loop time out (#505).
  // runReconcileStamping() remains the once-per-run sweeper for NULL residue.
  const stampValues: unknown[] = [];
  const stampPlaceholders: string[] = [];
  inputs.forEach((o, i) => {
    const off = i * 2;
    stampPlaceholders.push(`($${off + 1}, $${off + 2})`);
    stampValues.push(o.subId, o.speciesCode);
  });

  const stampSql = `
    UPDATE observations o
    SET
      silhouette_id = (
        SELECT fs.id
        FROM species_meta sm
        JOIN family_silhouettes fs ON fs.family_code = sm.family_code
        WHERE sm.species_code = o.species_code
        LIMIT 1
      )
    FROM (VALUES ${stampPlaceholders.join(',')}) AS batch(sub_id, species_code)
    WHERE o.sub_id = batch.sub_id
      AND o.species_code = batch.species_code
      AND o.silhouette_id IS NULL
  `;

  await pool.query(insertSql, values);
  await pool.query(stampSql, stampValues);
  return inputs.length;
}

/**
 * Re-runs the silhouette stamping UPDATE across ALL observations whose
 * silhouette_id is still NULL. Idempotent.
 *
 * upsertObservations stamps only the rows in its own batch (the UPDATE is
 * scoped to the batch's (sub_id, species_code) pairs). Anything that was NULL
 * at the time of its batch — e.g. a silhouette JOIN that missed because
 * species_meta was empty at the time, as on prod pre-#83 — stays NULL until
 * this function sweeps it. Run once at the end of a taxonomy or backfill run.
 *
 * Note: region_id is no longer stamped here as of #532 (PR-1 of 4). The
 * per-state ecoregion concept is being removed from the data layer; the
 * column itself is dropped in PR-3.
 *
 * Returns the number of rows updated.
 */
export async function runReconcileStamping(pool: Pool): Promise<number> {
  const { rowCount } = await pool.query(`
    UPDATE observations o
    SET
      silhouette_id = COALESCE(o.silhouette_id, (
        SELECT fs.id
        FROM species_meta sm
        JOIN family_silhouettes fs ON fs.family_code = sm.family_code
        WHERE sm.species_code = o.species_code
        LIMIT 1
      ))
    WHERE o.silhouette_id IS NULL
  `);
  return rowCount ?? 0;
}

export async function getObservations(
  pool: Pool,
  f: ObservationFilters
): Promise<Observation[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (f.since) {
    const days = parseInt(f.since.replace('d', ''), 10);
    conditions.push(`obs_dt >= now() - ($${params.length + 1}::int * interval '1 day')`);
    params.push(days);
  }
  if (f.notable === true) {
    conditions.push('is_notable = true');
  }
  if (f.speciesCode) {
    conditions.push(`o.species_code = $${params.length + 1}`);
    params.push(f.speciesCode);
  }
  if (f.familyCode) {
    conditions.push(
      `o.species_code IN (SELECT species_code FROM species_meta WHERE family_code = $${params.length + 1})`
    );
    params.push(f.familyCode);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT
      o.sub_id, o.species_code, sm.com_name, sm.family_code,
      o.lat, o.lng, o.obs_dt, o.loc_id, o.loc_name, o.how_many,
      o.is_notable, o.region_id, o.silhouette_id
    FROM observations o
    LEFT JOIN species_meta sm ON sm.species_code = o.species_code
    ${where}
    ORDER BY o.obs_dt DESC
  `;

  const { rows } = await pool.query<{
    sub_id: string;
    species_code: string;
    com_name: string | null;
    family_code: string | null;
    lat: number;
    lng: number;
    obs_dt: Date;
    loc_id: string;
    loc_name: string | null;
    how_many: number | null;
    is_notable: boolean;
    region_id: string | null;
    silhouette_id: string | null;
  }>(sql, params);

  // NOTE: family_code is passed through as-is, WITHOUT a `?? ''` fallback.
  // The NULL is meaningful signal to the frontend (skip in deriveFamilies,
  // fall back to silhouette-only rendering). The upstream fix is the
  // ingestor seeding species_meta, not the DB parser papering over the gap.
  return rows.map(r => ({
    subId: r.sub_id,
    speciesCode: r.species_code,
    comName: r.com_name ?? r.species_code,
    lat: r.lat,
    lng: r.lng,
    obsDt: r.obs_dt.toISOString(),
    locId: r.loc_id,
    locName: r.loc_name,
    howMany: r.how_many,
    isNotable: r.is_notable,
    regionId: r.region_id,
    silhouetteId: r.silhouette_id,
    familyCode: r.family_code,
  }));
}

/**
 * Returns the ISO string of the most recently ingested observation
 * (MAX(ingested_at)), or null when the observations table is empty.
 *
 * Used by the Read API to populate meta.freshestObservationAt in the
 * ObservationsResponse envelope (#456 W3-A).
 *
 * Note: ingested_at (when the row was written to our DB) is used rather than
 * obs_dt (when the birder made the observation) because it accurately reflects
 * how fresh the data in our system is — even if an observation was made days
 * ago, we want to know when we last received it from eBird.
 */
export async function getFreshestObservationAt(pool: Pool): Promise<string | null> {
  const { rows } = await pool.query<{ max_ingested_at: Date | null }>(
    'SELECT MAX(ingested_at) AS max_ingested_at FROM observations'
  );
  const ts = rows[0]?.max_ingested_at ?? null;
  return ts ? ts.toISOString() : null;
}

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

  const stampSql = `
    UPDATE observations o
    SET
      region_id = (
        SELECT r.id FROM regions r
        WHERE ST_Contains(r.geom, o.geom)
        ORDER BY ST_Area(r.geom) ASC
        LIMIT 1
      ),
      silhouette_id = (
        SELECT fs.id
        FROM species_meta sm
        JOIN family_silhouettes fs ON fs.family_code = sm.family_code
        WHERE sm.species_code = o.species_code
        LIMIT 1
      )
    WHERE o.region_id IS NULL OR o.silhouette_id IS NULL
  `;

  await pool.query(insertSql, values);
  await pool.query(stampSql);
  return inputs.length;
}

/**
 * Re-runs the region/silhouette stamping UPDATE across ALL observations whose
 * region_id or silhouette_id is still NULL. Idempotent.
 *
 * upsertObservations only stamps rows it just touched (via its WHERE filter,
 * which in practice catches the current batch). When species_meta is empty
 * at ingest time (as on prod pre-#83), the silhouette JOIN finds no row and
 * silhouette_id stays NULL — even after the batch is stamped. Running this
 * after a taxonomy job is loaded backfills every orphaned row.
 *
 * Returns the number of rows updated.
 */
export async function runReconcileStamping(pool: Pool): Promise<number> {
  const { rowCount } = await pool.query(`
    UPDATE observations o
    SET
      region_id = COALESCE(o.region_id, (
        SELECT r.id FROM regions r
        WHERE ST_Contains(r.geom, o.geom)
        ORDER BY ST_Area(r.geom) ASC
        LIMIT 1
      )),
      silhouette_id = COALESCE(o.silhouette_id, (
        SELECT fs.id
        FROM species_meta sm
        JOIN family_silhouettes fs ON fs.family_code = sm.family_code
        WHERE sm.species_code = o.species_code
        LIMIT 1
      ))
    WHERE o.region_id IS NULL OR o.silhouette_id IS NULL
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
      o.sub_id, o.species_code, sm.com_name,
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
  }));
}

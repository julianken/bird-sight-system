import type { Pool } from './pool.js';
import type { Hotspot } from '@bird-watch/shared-types';

export interface HotspotInput {
  locId: string;
  locName: string;
  lat: number;
  lng: number;
  numSpeciesAlltime: number | null;
  latestObsDt: string | null;
}

export async function getHotspots(pool: Pool): Promise<Hotspot[]> {
  const { rows } = await pool.query<{
    loc_id: string;
    loc_name: string;
    lat: number;
    lng: number;
    num_species_alltime: number | null;
    latest_obs_dt: Date | null;
  }>(
    `SELECT loc_id, loc_name, lat, lng, num_species_alltime, latest_obs_dt
     FROM hotspots`
  );
  return rows.map(r => ({
    locId: r.loc_id,
    locName: r.loc_name,
    lat: r.lat,
    lng: r.lng,
    numSpeciesAlltime: r.num_species_alltime,
    latestObsDt: r.latest_obs_dt ? r.latest_obs_dt.toISOString() : null,
  }));
}

export async function upsertHotspots(pool: Pool, inputs: HotspotInput[]): Promise<number> {
  if (inputs.length === 0) return 0;

  const values: unknown[] = [];
  const placeholders: string[] = [];

  inputs.forEach((h, i) => {
    const o = i * 6;
    placeholders.push(`($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6})`);
    values.push(h.locId, h.locName, h.lat, h.lng, h.numSpeciesAlltime, h.latestObsDt);
  });

  const insertSql = `
    INSERT INTO hotspots (loc_id, loc_name, lat, lng, num_species_alltime, latest_obs_dt)
    VALUES ${placeholders.join(',')}
    ON CONFLICT (loc_id) DO UPDATE SET
      loc_name            = EXCLUDED.loc_name,
      lat                 = EXCLUDED.lat,
      lng                 = EXCLUDED.lng,
      num_species_alltime = EXCLUDED.num_species_alltime,
      latest_obs_dt       = EXCLUDED.latest_obs_dt
  `;

  const updateSql = `
    UPDATE hotspots h
    SET region_id = (
      SELECT r.id FROM regions r
      WHERE ST_Contains(r.geom, h.geom)
      ORDER BY ST_Area(r.geom) ASC
      LIMIT 1
    )
    WHERE region_id IS NULL OR region_id <> (
      SELECT r.id FROM regions r
      WHERE ST_Contains(r.geom, h.geom)
      ORDER BY ST_Area(r.geom) ASC
      LIMIT 1
    )
  `;

  await pool.query(insertSql, values);
  await pool.query(updateSql);
  return inputs.length;
}

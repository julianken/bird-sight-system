import type { Pool } from '@bird-watch/db-client';

export interface ArchivableRow {
  sub_id: string;
  species_code: string;
  obs_dt: Date;
  lng: number;
  lat: number;
  obs_count: number | null;
  is_notable: boolean;
  loc_id: string;
  loc_name: string | null;
  common_name: string | null;
  sci_name: string | null;
  family_code: string | null;
  family_name: string | null;
  ingested_at: Date;
}

export interface SelectArchivableOptions {
  pool: Pool;
  /** UTC date in ISO YYYY-MM-DD form. Selects rows where obs_dt is on this UTC day. */
  utcDate: string;
}

/**
 * Selects the observations rows whose `obs_dt` falls on the given UTC day,
 * LEFT JOINed to `species_meta` for the denormalized common_name / sci_name /
 * family_code / family_name. LEFT JOIN (not INNER) so that an observation
 * for an unmapped species code still archives — with NULL species metadata —
 * rather than being silently dropped.
 *
 * The renamed columns (`how_many` → `obs_count`, `com_name` → `common_name`)
 * are aliased here so the Parquet writer sees ML-friendly names without
 * needing a second mapping layer.
 */
export async function selectArchivable(
  o: SelectArchivableOptions
): Promise<ArchivableRow[]> {
  const { rows } = await o.pool.query<ArchivableRow>(
    `SELECT
       obs.sub_id,
       obs.species_code,
       obs.obs_dt,
       obs.lng,
       obs.lat,
       obs.how_many   AS obs_count,
       obs.is_notable,
       obs.loc_id,
       obs.loc_name,
       sm.com_name    AS common_name,
       sm.sci_name,
       sm.family_code,
       sm.family_name,
       obs.ingested_at
     FROM observations obs
     LEFT JOIN species_meta sm USING (species_code)
     WHERE obs.obs_dt >= ($1::date)::timestamptz
       AND obs.obs_dt <  (($1::date) + INTERVAL '1 day')::timestamptz
     ORDER BY obs.obs_dt`,
    [o.utcDate]
  );
  return rows;
}

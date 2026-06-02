import type { Pool } from './pool.js';
import type {
  Observation, ObservationFilters, AggregatedBucket,
} from '@bird-watch/shared-types';

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

// UNNEST-based bulk upsert (#843). The previous build emitted one `$N`
// placeholder per FIELD (9 cols × N rows for the INSERT, 2 × N for the stamp
// UPDATE). The Postgres wire protocol encodes a Bind message's parameter count
// as a uint16 (max 65,535) and node-postgres does NOT guard it — past that the
// count silently overflows mod 65536 and the bind desyncs ("bind message has N
// parameter formats but 0 parameters"). The #840 per-state `recent` fan-out
// aggregates tens of thousands of rows into ONE upsert call (~13.3k in the
// failing prod run), so 7,281 rows (65,535÷9) was a CORRUPTION THRESHOLD, not a
// safe ceiling. UNNEST passes ONE array param per COLUMN — 9 params for the
// INSERT, 2 for the stamp — regardless of row count, so the ceiling is
// structurally unreachable. Both statements run inside a single transaction on
// one client so a mid-upsert failure rolls back cleanly (a half-written
// national map is worse than a clean retry next cycle).
export async function upsertObservations(
  pool: Pool,
  inputs: ObservationInput[]
): Promise<number> {
  if (inputs.length === 0) return 0;

  // One column-major array per field. Casts match the observations schema:
  // sub_id/species_code/loc_id/loc_name TEXT, lat/lng DOUBLE PRECISION (float8),
  // obs_dt TIMESTAMPTZ, how_many INTEGER, is_notable BOOLEAN. loc_name and
  // how_many are nullable — null elements pass through fine.
  const subIds: string[] = [];
  const speciesCodes: string[] = [];
  const lats: number[] = [];
  const lngs: number[] = [];
  const obsDts: string[] = [];
  const locIds: string[] = [];
  const locNames: (string | null)[] = [];
  const howManys: (number | null)[] = [];
  const isNotables: boolean[] = [];

  for (const o of inputs) {
    subIds.push(o.subId);
    speciesCodes.push(o.speciesCode);
    lats.push(o.lat);
    lngs.push(o.lng);
    obsDts.push(o.obsDt);
    locIds.push(o.locId);
    locNames.push(o.locName);
    howManys.push(o.howMany);
    isNotables.push(o.isNotable);
  }

  const insertSql = `
    INSERT INTO observations
      (sub_id, species_code, lat, lng, obs_dt, loc_id, loc_name, how_many, is_notable)
    SELECT * FROM unnest(
      $1::text[], $2::text[], $3::float8[], $4::float8[], $5::timestamptz[],
      $6::text[], $7::text[], $8::int[], $9::bool[]
    )
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

  // Scope the stamp UPDATE to just this batch's (sub_id, species_code) pairs.
  // Without this scoping the WHERE clause goes O(table) — every batch re-scans
  // every NULL-stamp residue row in observations, which is what made the daily
  // backfill loop time out (#505). UNNEST keeps it O(batch) at 2 array params.
  // runReconcileStamping() remains the once-per-run sweeper for NULL residue.
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
    FROM unnest($1::text[], $2::text[]) AS batch(sub_id, species_code)
    WHERE o.sub_id = batch.sub_id
      AND o.species_code = batch.species_code
      AND o.silhouette_id IS NULL
  `;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // #845 — exempt THIS transaction from the session statement_timeout.
    // pool.ts defaults every connection to a 15s statement_timeout (#822, to
    // protect the read-api from runaway queries). The #840 per-state fan-out
    // funnels the whole nation (~13.3k rows) into one upsert call whose INSERT +
    // stamp UPDATE exceeds 15s on db-g1-small, so Postgres cancels it (SQLSTATE
    // 57014), the txn rolls back, and zero rows commit. `SET LOCAL` is
    // transaction-scoped: it applies ONLY to the two statements below and
    // auto-reverts on COMMIT/ROLLBACK, so every other ingestor query
    // (startIngestRun, findMissingSpeciesMeta, finishIngestRun) and the
    // separate read-api pool keep their 15s guard. This is deliberately
    // narrower than disabling the timeout pool-wide; the Cloud Run job's 900s
    // timeout remains the outer kill switch.
    await client.query('SET LOCAL statement_timeout = 0');
    await client.query(insertSql, [
      subIds, speciesCodes, lats, lngs, obsDts,
      locIds, locNames, howManys, isNotables,
    ]);
    await client.query(stampSql, [subIds, speciesCodes]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

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
): Promise<{ data: Observation[]; truncated: boolean }> {
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
  if (f.bbox) {
    // PostGIS spatial filter (#619). The `&&` operator uses the obs_geom_idx
    // GIST index for fast bbox-overlap; ST_Intersects is then layered on top
    // to remove false-positives at the envelope boundary (the `&&` shortcut
    // is a bounding-box test, not a true geometric intersect, so on its own
    // it can include features that touch the envelope MBR but not its
    // interior). For axis-aligned POINTs the two predicates collapse to the
    // same set, but the planner still uses the GIST index via `&&` — keep
    // both to stay correct if/when non-point geometries land.
    const i1 = params.length + 1;
    const i2 = params.length + 2;
    const i3 = params.length + 3;
    const i4 = params.length + 4;
    conditions.push(
      `geom && ST_MakeEnvelope($${i1}, $${i2}, $${i3}, $${i4}, 4326)`
    );
    conditions.push(
      `ST_Intersects(geom, ST_MakeEnvelope($${i1}, $${i2}, $${i3}, $${i4}, 4326))`
    );
    params.push(f.bbox[0], f.bbox[1], f.bbox[2], f.bbox[3]);
  }
  if (f.stateCode) {
    // #733 — hard server-side state clip (`?state=US-XX`). Two predicates back
    // one param (mirrors the bbox i1..i4 single-push pattern). The `&&`
    // envelope-overlap uses the obs_geom_idx GIST index to prune to the
    // state's bounding box; ST_Intersects then does the exact polygon test.
    // ST_Intersects (NOT ST_Contains) is the inclusive idiom: a point on a
    // simplified shared border resolves into a state rather than vanishing.
    // ARG ORDER: polygon FIRST — `ST_Intersects(polygon, point)`. This is the
    // REVERSE of the bbox block above (`ST_Intersects(geom, envelope)`); the
    // order is intentional and is not a bug to "correct". Appending here AND-s
    // the clip with since/notable/species/family/bbox automatically.
    const si = params.length + 1;
    conditions.push(`o.geom && (SELECT geom FROM state_boundaries WHERE state_code = $${si})`);
    conditions.push(`ST_Intersects((SELECT geom FROM state_boundaries WHERE state_code = $${si}), o.geom)`);
    params.push(f.stateCode);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // #733 (#667 Addendum §3) — per-observation row brake, now SHIPPED. Every
  // per-observation query is capped: a species-filtered query at 5000 (no real
  // species has >5K obs in 14d nationally — the cap is an emergency brake for
  // `?species=<code>` deep links that fetch before MapCanvas mounts, with no
  // bbox/zoom in flight), every other per-observation query at 10000. We
  // always `LIMIT cap + 1` and probe whether the extra row came back: if it
  // did, the result is truncated and we slice back to `cap`. The caller
  // surfaces this as `meta.truncated` so the frontend can show a partial-data
  // banner. The aggregated path (getObservationsAggregated) never truncates.
  const cap = f.speciesCode ? 5000 : 10000;

  const sql = `
    SELECT
      o.sub_id, o.species_code, sm.com_name, sm.family_code,
      o.lat, o.lng, o.obs_dt, o.loc_id, o.loc_name, o.how_many,
      o.is_notable, o.silhouette_id
    FROM observations o
    LEFT JOIN species_meta sm ON sm.species_code = o.species_code
    ${where}
    ORDER BY o.obs_dt DESC
    LIMIT ${cap + 1}
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
    silhouette_id: string | null;
  }>(sql, params);

  // `cap + 1` came back ⇒ there is at least one more row than the cap allows,
  // so the body is a partial set. Slice back to the cap and flag truncation.
  const truncated = rows.length > cap;
  const capped = truncated ? rows.slice(0, cap) : rows;

  // NOTE: family_code is passed through as-is, WITHOUT a `?? ''` fallback.
  // The NULL is meaningful signal to the frontend (skip in deriveFamilies,
  // fall back to silhouette-only rendering). The upstream fix is the
  // ingestor seeding species_meta, not the DB parser papering over the gap.
  const data = capped.map(r => ({
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
    silhouetteId: r.silhouette_id,
    familyCode: r.family_code,
  }));

  return { data, truncated };
}

/**
 * Coarse-grid aggregation for low-zoom views (#627). Buckets observations
 * onto a `round(coord * gridMultiplier) / gridMultiplier` lat/lng grid and
 * returns count/species-count/families per cell. Used when the read-api
 * sees `zoom < 6` to keep CONUS-view payload below the Phase 2 <2 MB gate.
 *
 * `gridMultiplier` controls bucket size — higher = finer grid:
 *   2  → 0.5°   (~55 km @ AZ latitude) — zoom 3
 *   4  → 0.25°  (~28 km)               — zoom 4
 *   8  → 0.125° (~14 km)               — zoom 5
 *
 * Filters mirror getObservations (since / notable / species / family / bbox).
 */
export async function getObservationsAggregated(
  pool: Pool,
  f: ObservationFilters,
  gridMultiplier: number,
): Promise<AggregatedBucket[]> {
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
  if (f.bbox) {
    const i1 = params.length + 1;
    const i2 = params.length + 2;
    const i3 = params.length + 3;
    const i4 = params.length + 4;
    conditions.push(
      `geom && ST_MakeEnvelope($${i1}, $${i2}, $${i3}, $${i4}, 4326)`
    );
    conditions.push(
      `ST_Intersects(geom, ST_MakeEnvelope($${i1}, $${i2}, $${i3}, $${i4}, 4326))`
    );
    params.push(f.bbox[0], f.bbox[1], f.bbox[2], f.bbox[3]);
  }
  if (f.stateCode) {
    // #733 — identical state clip to getObservations (the aggregated path
    // must clip too, so a low-zoom state view never aggregates out-of-state
    // observations). ARG ORDER: polygon FIRST — `ST_Intersects(polygon, point)`,
    // the reverse of the bbox block above; intentional, not a bug. One param
    // backs both `$si` references.
    const si = params.length + 1;
    conditions.push(`o.geom && (SELECT geom FROM state_boundaries WHERE state_code = $${si})`);
    conditions.push(`ST_Intersects((SELECT geom FROM state_boundaries WHERE state_code = $${si}), o.geom)`);
    params.push(f.stateCode);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const gIdx = params.length + 1;
  params.push(gridMultiplier);

  // The grid multiplier is parameterised, not interpolated, so callers can't
  // inject SQL via gridMultiplier. The read-api validates zoom → multiplier
  // through a closed switch (2/4/8) so even an upstream tamper attempt lands
  // on a numeric value.
  const sql = `
    SELECT
      round(ST_X(geom) * $${gIdx}) / $${gIdx} AS lng_bucket,
      round(ST_Y(geom) * $${gIdx}) / $${gIdx} AS lat_bucket,
      count(*)::int AS observation_count,
      count(DISTINCT o.species_code)::int AS species_count,
      array_remove(array_agg(DISTINCT sm.family_code), NULL) AS families
    FROM observations o
    LEFT JOIN species_meta sm ON sm.species_code = o.species_code
    ${where}
    GROUP BY 1, 2
  `;

  const { rows } = await pool.query<{
    lng_bucket: number;
    lat_bucket: number;
    observation_count: number;
    species_count: number;
    families: string[] | null;
  }>(sql, params);

  return rows.map(r => ({
    lng: Number(r.lng_bucket),
    lat: Number(r.lat_bucket),
    count: r.observation_count,
    speciesCount: r.species_count,
    families: r.families ?? [],
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

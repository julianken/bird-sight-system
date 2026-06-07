import type { Pool } from './pool.js';
import type {
  Observation, ObservationFilters, AggregatedBucket, AggregatedFamily,
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
 * Top-N species carried per family in each aggregated bucket (#859). The cap
 * keeps the national grid payload bounded: species are thin per family (most
 * families have 1–4 species in a cell), so 8 shows almost every family in full
 * and only mega-families (warblers, sparrows, ducks) truncate — with an honest
 * "+N more" drawn from the EXACT `speciesCount`, not this capped list. Measured
 * national gzip at top-8 sits in the ~130–160KB range (acceptable ceiling
 * 180KB); raising the cap re-inflates the payload roughly linearly in the
 * mega-family tail. Tunable: bump here and re-measure with the gzip probe
 * before changing it.
 */
export const TOP_SPECIES_PER_FAMILY = 8;

/**
 * Coarse-grid aggregation for low-zoom views (#627, #859). Buckets observations
 * onto a `round(coord * gridMultiplier) / gridMultiplier` lat/lng grid and
 * returns, per cell, the total count/species-count plus the species nested
 * UNDER each family (compute-on-write). Used when the read-api sees `zoom < 6`
 * to keep CONUS-view payload below the Phase 2 <2 MB gate while still letting
 * the frontend render real species names directly (no synthetic rows, no lazy
 * per-click fetch — the bug class #859 deletes).
 *
 * `gridMultiplier` controls bucket size — higher = finer grid:
 *   2  → 0.5°   (~55 km @ AZ latitude) — zoom 3
 *   4  → 0.25°  (~28 km)               — zoom 4
 *   8  → 0.125° (~14 km)               — zoom 5
 *
 * Filters mirror getObservations (since / notable / species / family / bbox /
 * stateCode + the #733 state polygon clip), applied identically.
 *
 * NULL-family handling (#859, matching the prior `array_remove(..., NULL)`
 * intent): a species absent from `species_meta` has an unknown family. Its
 * observations STILL count toward the bucket `count` / `speciesCount` totals
 * (true totals over ALL rows), but the species is EXCLUDED from `families[]`
 * because there is no family to nest it under — the per-family CTE filters
 * `sm.family_code IS NOT NULL`, while the bucket totals are computed over the
 * unfiltered base set.
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
  const capIdx = params.length + 1;
  params.push(TOP_SPECIES_PER_FAMILY);

  // The grid multiplier and top-N cap are parameterised, not interpolated, so
  // callers can't inject SQL through them. The read-api validates zoom →
  // multiplier through a closed switch (2/4/8) so even an upstream tamper
  // attempt lands on a numeric value; the cap is a module const.
  //
  // Pipeline (#859, compute-on-write nesting):
  //   base       — filtered observations, bucketed, with family_code joined.
  //                Carries NULL family rows (species absent from species_meta).
  //   per_species— count(*) per (bucket, family, species), family NOT NULL only.
  //   ranked     — ROW_NUMBER() per (bucket, family) ordered by species count
  //                desc, species_code asc → deterministic top-N selection.
  //   per_family — per (bucket, family): exact family count + distinct species
  //                count, plus the top-N species (rn <= cap) as an ordered JSON
  //                array. family count/speciesCount are over ALL of that
  //                family's rows in the cell, NOT just the capped list.
  //   families   — per bucket: families rolled up into one JSON array ordered
  //                by family count desc, family code asc.
  //   bucket_totals — per bucket: count(*) + count(DISTINCT species_code) over
  //                `base` (unfiltered — so NULL-family rows still count toward
  //                the totals), keyed ONLY on (lng_bucket, lat_bucket).
  // The final SELECT LEFT JOINs the families rollup (which excludes NULL-family
  // rows) onto bucket_totals. A bucket whose only observations are NULL-family
  // yields families = '[]'.
  //
  // PERF (#862 — national-scale 503 RCA). The original #859 final SELECT
  // computed the bucket totals by aggregating ALL of `base` while grouping by
  // (lng_bucket, lat_bucket, f.families). Because `f.families` is a large jsonb
  // blob, the planner pulled it into the GROUP BY sort key and DUPLICATED it
  // across every one of the ~467k national `base` rows, forcing a multi-GB
  // external-merge sort (measured 3.6 GB spill, ~147s — far past the 15s
  // statement_timeout, so the national low-zoom request 503'd). Splitting the
  // totals into `bucket_totals` (grouped on the two cheap float keys only, no
  // jsonb in the sort key) and joining the prebuilt per-bucket jsonb afterward
  // removes the giant sort entirely: national runtime drops from ~147s to
  // ~2.3s at prod scale. The result is byte-identical — `f.families` was
  // always functionally determined by the bucket key, so grouping by it never
  // changed which rows came back, only the cost.
  const sql = `
    WITH base AS (
      SELECT
        round(ST_X(o.geom) * $${gIdx}) / $${gIdx} AS lng_bucket,
        round(ST_Y(o.geom) * $${gIdx}) / $${gIdx} AS lat_bucket,
        o.species_code,
        sm.family_code,
        -- #924 PR4: thread both COALESCE source columns to family level. The
        -- family display name is functionally determined by family_code, so
        -- it survives the GROUP BY via min() in per_family. fs.common_name is
        -- the curated short house style (first arm, matches the frontend's
        -- silhouette.commonName); sm.family_name is the eBird long-name drift
        -- fallback (second arm). family_silhouettes.family_code is UNIQUE, so
        -- this LEFT JOIN cannot multiply rows.
        sm.family_name,
        fs.common_name AS family_common_name
      FROM observations o
      LEFT JOIN species_meta sm ON sm.species_code = o.species_code
      LEFT JOIN family_silhouettes fs ON fs.family_code = sm.family_code
      ${where}
    ),
    per_species AS (
      SELECT
        lng_bucket, lat_bucket, family_code, species_code,
        min(family_common_name) AS family_common_name,
        min(family_name) AS family_name,
        count(*)::int AS species_count
      FROM base
      WHERE family_code IS NOT NULL
      GROUP BY lng_bucket, lat_bucket, family_code, species_code
    ),
    ranked AS (
      SELECT
        lng_bucket, lat_bucket, family_code, species_code, species_count,
        family_common_name, family_name,
        ROW_NUMBER() OVER (
          PARTITION BY lng_bucket, lat_bucket, family_code
          ORDER BY species_count DESC, species_code ASC
        ) AS rn
      FROM per_species
    ),
    per_family AS (
      SELECT
        lng_bucket, lat_bucket, family_code,
        min(family_common_name) AS family_common_name,
        min(family_name) AS family_name,
        sum(species_count)::int AS family_count,
        count(*)::int AS family_species_count,
        jsonb_agg(
          jsonb_build_object('code', species_code, 'count', species_count)
          ORDER BY species_count DESC, species_code ASC
        ) FILTER (WHERE rn <= $${capIdx}) AS top_species
      FROM ranked
      GROUP BY lng_bucket, lat_bucket, family_code
    ),
    families AS (
      SELECT
        lng_bucket, lat_bucket,
        jsonb_agg(
          jsonb_build_object(
            'code', family_code,
            'count', family_count,
            'speciesCount', family_species_count,
            'species', top_species,
            'name', COALESCE(family_common_name, family_name)
          )
          ORDER BY family_count DESC, family_code ASC
        ) AS families
      FROM per_family
      GROUP BY lng_bucket, lat_bucket
    ),
    bucket_totals AS (
      SELECT
        lng_bucket,
        lat_bucket,
        count(*)::int AS observation_count,
        count(DISTINCT species_code)::int AS species_count
      FROM base
      GROUP BY lng_bucket, lat_bucket
    )
    SELECT
      t.lng_bucket,
      t.lat_bucket,
      t.observation_count,
      t.species_count,
      COALESCE(f.families, '[]'::jsonb) AS families
    FROM bucket_totals t
    LEFT JOIN families f
      ON f.lng_bucket = t.lng_bucket AND f.lat_bucket = t.lat_bucket
  `;

  const { rows } = await pool.query<{
    lng_bucket: number;
    lat_bucket: number;
    observation_count: number;
    species_count: number;
    families: AggregatedFamily[] | null;
  }>(sql, params);

  return rows.map(r => ({
    lng: Number(r.lng_bucket),
    lat: Number(r.lat_bucket),
    count: r.observation_count,
    speciesCount: r.species_count,
    // jsonb deserialises to a JS array already; `?? []` guards the COALESCE
    // result and the theoretical all-NULL-family bucket.
    families: r.families ?? [],
  }));
}

// ── #878 — PRECOMPUTED PER-SCOPE AGGREGATION GRID ───────────────────────────
//
// getObservationsAggregated aggregates EVERY in-scope observation at request
// time. For high-volume states (CA/TX) the cost is the HashAggregate/WindowAgg/
// Sort over the in-scope row set, not row-finding — ~12-15s cold, one bad scan
// from the 15s statement_timeout. The fix precomputes the aggregated grid per
// scope at ingest time (refreshGridAgg, ingestor-side) and serves the DEFAULT
// low-zoom view as a cheap PK lookup (getAggregatedGridFromCache) on the
// observation_grid_agg table (migration 1700000051000). Filtered / non-default
// requests keep the exact live CTE path (getObservationsAggregated) unchanged.

/**
 * The national scope key in `observation_grid_agg.scope_key` (the unclipped,
 * whole-US grid). State scopes use their `US-XX` code as the key.
 */
export const NATIONAL_SCOPE_KEY = 'US';

/**
 * The standard grid multipliers the read-api's closed zoom→grid switch emits
 * (`services/read-api/src/app.ts`: zoom <= 3 → 2, zoom === 4 → 4, else → 8).
 * Only these tiers are precomputed; any other multiplier (an upstream tamper,
 * a future tier) falls through to the live CTE. Kept here, beside the populate
 * + lookup that consume it, so the precompute set and the read-path predicate
 * never drift from one list.
 */
export const STANDARD_GRID_MULTIPLIERS: readonly number[] = [2, 4, 8];

/**
 * Resolves the `scope_key` for a precompute lookup from the request filters:
 * a `US-XX` state code when one is scoped, the national key otherwise. This is
 * a pure function of the SCOPE — never of the bbox. A scoped state view ALWAYS
 * sends the deterministic snapped state-envelope bbox (frontend client.ts), so
 * "a bbox is present" must NOT route to the fallback or it defeats the whole
 * fix; the server already clips to the state polygon, so the envelope bbox is a
 * function of the scope, not a row-reducing filter.
 */
export function resolveScopeKey(f: ObservationFilters): string {
  return f.stateCode ?? NATIONAL_SCOPE_KEY;
}

/**
 * POSITIVE read-path predicate (#878). Use the precompute lookup ONLY when the
 * request is the default unfiltered low-zoom view:
 *   - a resolvable scope (a state code OR national — always true here, but kept
 *     explicit so the intent reads in one place),
 *   - the default `since` window (14d, or unset which defaults to 14d),
 *   - NO `notable` / `speciesCode` / `familyCode` filter,
 *   - a standard grid multiplier (2/4/8).
 * The bbox is deliberately IGNORED — a scoped state view always carries the
 * snapped state-envelope bbox, which is co-extensive with the state's polygon
 * clip and adds no row-reducing work. Everything else (any filter, non-default
 * `since`, a non-standard multiplier) falls through to the live CTE.
 */
export function isPrecomputeEligible(
  f: ObservationFilters,
  gridMultiplier: number,
): boolean {
  // Default `since` = 14d (unset defaults to 14d at the populate level too).
  const sinceIsDefault = f.since === undefined || f.since === '14d';
  const hasNoFilters =
    f.notable !== true && f.speciesCode === undefined && f.familyCode === undefined;
  const standardMultiplier = STANDARD_GRID_MULTIPLIERS.includes(gridMultiplier);
  return sinceIsDefault && hasNoFilters && standardMultiplier;
}

/**
 * Cheap PK lookup into `observation_grid_agg` for the default low-zoom view.
 * Returns the precomputed buckets in the SAME shape getObservationsAggregated
 * returns (so the read-api branch is a drop-in). The rows are byte-identical to
 * what the live CTE would produce for `{ since: '14d', stateCode? }` at this
 * multiplier (guaranteed by refreshGridAgg sharing the live pipeline).
 *
 * A scope/multiplier with no precomputed rows yields []. The caller decides
 * whether an empty grid means "genuinely empty scope" or "not yet populated";
 * in practice refreshGridAgg runs every ingest cycle so a live scope is never
 * absent for long, and the read-path only takes this branch when eligible.
 */
export async function getAggregatedGridFromCache(
  pool: Pool,
  scopeKey: string,
  gridMultiplier: number,
): Promise<AggregatedBucket[]> {
  const { rows } = await pool.query<{
    lng_bucket: number;
    lat_bucket: number;
    observation_count: number;
    species_count: number;
    families: AggregatedFamily[] | null;
  }>(
    `SELECT lng_bucket, lat_bucket, observation_count, species_count, families
       FROM observation_grid_agg
      WHERE scope_key = $1 AND grid_multiplier = $2`,
    [scopeKey, gridMultiplier],
  );
  return rows.map(r => ({
    lng: Number(r.lng_bucket),
    lat: Number(r.lat_bucket),
    count: r.observation_count,
    speciesCount: r.species_count,
    families: r.families ?? [],
  }));
}

/**
 * Recomputes the ENTIRE `observation_grid_agg` table — all scopes (national +
 * every CONUS state) × all standard grid multipliers (2/4/8) — and atomically
 * swaps it in (#878). Runs ingestor-side after each /recent ingest+reconcile
 * AND after the 14-day prune (never on the request path), so a state's grid
 * always reflects the current observations table (no stale cells across an
 * ingest delta or a prune — the table is fully rebuilt each call).
 *
 * State-assignment decision: each observation is assigned to its state with ONE
 * GIST-backed `ST_Intersects` join against `state_boundaries` (the `&&`
 * bounding-box prefilter uses obs_geom_idx), NOT 49 separate per-state polygon
 * passes and NOT a denormalized `state_code` column on `observations`. A single
 * spatial join over the pruned 14d table is far cheaper than 49 repeated scans
 * AND avoids a schema change + per-ingest backfill of a state_code column (which
 * would also have to be kept correct on every upsert). The national grid needs
 * no join at all. The whole rebuild is one set-based statement per CTE chain, so
 * the populate cost is a single 14d-window aggregation pass (the same volume the
 * live national query already does in ~2.3s at prod scale) — comfortably inside
 * the ingestor's 900s job budget and off the request path entirely.
 *
 * Byte-identity: this shares the EXACT pipeline shape getObservationsAggregated
 * uses (base → per_species → ranked → per_family → families + bucket_totals),
 * extended with a `scope_key` grouping key. For `scope_key = 'US'` the base is
 * all 14d rows (= the live national query). For `scope_key = 'US-XX'` the base
 * is the rows whose geom ST_Intersects that state polygon (= the live state
 * query's clip). So a precomputed cell equals what the live CTE returns for the
 * matching `{ since: '14d', stateCode? }` request, cell-for-cell.
 *
 * The grid multipliers and top-N cap are bound parameters / a CROSS JOIN over a
 * fixed VALUES list — never interpolated — so the populate carries no injection
 * surface. The rebuild runs in one transaction (TRUNCATE + INSERT) so a reader
 * never sees a half-populated table.
 */
export async function refreshGridAgg(pool: Pool): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // #878 — exempt THIS transaction from the session statement_timeout.
    // pool.ts defaults every connection to a 15s statement_timeout (#822, to
    // protect the read-api from runaway queries). The populate below is one
    // heavy batch statement (the 14d `recent` CTE × the 2/4/8 multipliers ×
    // the national + 50-state `ST_Intersects` spatial join) that legitimately
    // exceeds 15s at prod scale, so Postgres cancels it (SQLSTATE 57014), the
    // txn rolls back, and zero grid rows commit — leaving every state scope on
    // the 12–15s live-query fallback (the bug observed in the 04:02 ingest
    // cycle, logged as bird_grid_agg_refresh_failed). `SET LOCAL` is
    // transaction-scoped: it applies ONLY to the statements below and
    // auto-reverts on COMMIT/ROLLBACK, so the read-api pool and every other
    // query keep their 15s guard. Mirrors the #845 precedent above; the Cloud
    // Run job's timeout remains the outer kill switch for the populate.
    await client.query('SET LOCAL statement_timeout = 0');
    // Clear inside the transaction so a reader never sees a half-populated grid
    // (the INSERT below repopulates before COMMIT). DELETE not TRUNCATE: TRUNCATE
    // takes an ACCESS EXCLUSIVE lock that would block concurrent read-path
    // lookups for the rebuild's duration; a DELETE + INSERT under MVCC lets
    // lookups keep serving the previous snapshot until COMMIT.
    await client.query('DELETE FROM observation_grid_agg');
    // The full per-scope/per-multiplier aggregation. `scoped` tags every 14d
    // observation with each scope it belongs to: 'US' (national, no clip) UNION
    // ALL its containing state ('US-XX', via the GIST ST_Intersects join).
    // `mult(m)` CROSS JOINs the standard multipliers so one statement covers all
    // tiers. The rest mirrors getObservationsAggregated exactly, with scope_key
    // + grid_multiplier threaded through every GROUP BY / PARTITION BY.
    const result = await client.query<{ n: string }>(
      `
      WITH recent AS (
        -- #924 PR4: carry both COALESCE source columns from the read side so
        -- the precompute path projects family.name byte-identically to the live
        -- getObservationsAggregated CTE (the #878 byte-identity guard enforces
        -- this). The NEW join is only family_silhouettes (UNIQUE family_code →
        -- single row per family); species_meta was already LEFT-JOINed here.
        SELECT o.geom, o.species_code, sm.family_code, sm.family_name,
               fs.common_name AS family_common_name
        FROM observations o
        LEFT JOIN species_meta sm ON sm.species_code = o.species_code
        LEFT JOIN family_silhouettes fs ON fs.family_code = sm.family_code
        WHERE o.obs_dt >= now() - (14 * interval '1 day')
      ),
      mult(grid_multiplier) AS (
        VALUES (2::int), (4::int), (8::int)
      ),
      scoped AS (
        -- National scope: every recent row, no clip.
        SELECT $1::text AS scope_key, r.geom, r.species_code, r.family_code,
               r.family_name, r.family_common_name
        FROM recent r
        UNION ALL
        -- State scope: each recent row tagged with the state polygon it falls
        -- in. ST_Intersects (NOT ST_Contains) matches the live state clip
        -- inclusive border idiom; the && prefilter uses obs_geom_idx.
        SELECT sb.state_code AS scope_key, r.geom, r.species_code, r.family_code,
               r.family_name, r.family_common_name
        FROM recent r
        JOIN state_boundaries sb
          ON r.geom && sb.geom AND ST_Intersects(sb.geom, r.geom)
      ),
      base AS (
        SELECT
          s.scope_key,
          m.grid_multiplier,
          round(ST_X(s.geom) * m.grid_multiplier) / m.grid_multiplier AS lng_bucket,
          round(ST_Y(s.geom) * m.grid_multiplier) / m.grid_multiplier AS lat_bucket,
          s.species_code,
          s.family_code,
          s.family_name,
          s.family_common_name
        FROM scoped s
        CROSS JOIN mult m
      ),
      per_species AS (
        SELECT
          scope_key, grid_multiplier, lng_bucket, lat_bucket, family_code, species_code,
          min(family_common_name) AS family_common_name,
          min(family_name) AS family_name,
          count(*)::int AS species_count
        FROM base
        WHERE family_code IS NOT NULL
        GROUP BY scope_key, grid_multiplier, lng_bucket, lat_bucket, family_code, species_code
      ),
      ranked AS (
        SELECT
          scope_key, grid_multiplier, lng_bucket, lat_bucket, family_code, species_code, species_count,
          family_common_name, family_name,
          ROW_NUMBER() OVER (
            PARTITION BY scope_key, grid_multiplier, lng_bucket, lat_bucket, family_code
            ORDER BY species_count DESC, species_code ASC
          ) AS rn
        FROM per_species
      ),
      per_family AS (
        SELECT
          scope_key, grid_multiplier, lng_bucket, lat_bucket, family_code,
          min(family_common_name) AS family_common_name,
          min(family_name) AS family_name,
          sum(species_count)::int AS family_count,
          count(*)::int AS family_species_count,
          jsonb_agg(
            jsonb_build_object('code', species_code, 'count', species_count)
            ORDER BY species_count DESC, species_code ASC
          ) FILTER (WHERE rn <= $2) AS top_species
        FROM ranked
        GROUP BY scope_key, grid_multiplier, lng_bucket, lat_bucket, family_code
      ),
      families AS (
        SELECT
          scope_key, grid_multiplier, lng_bucket, lat_bucket,
          jsonb_agg(
            jsonb_build_object(
              'code', family_code,
              'count', family_count,
              'speciesCount', family_species_count,
              'species', top_species,
              'name', COALESCE(family_common_name, family_name)
            )
            ORDER BY family_count DESC, family_code ASC
          ) AS families
        FROM per_family
        GROUP BY scope_key, grid_multiplier, lng_bucket, lat_bucket
      ),
      bucket_totals AS (
        SELECT
          scope_key, grid_multiplier, lng_bucket, lat_bucket,
          count(*)::int AS observation_count,
          count(DISTINCT species_code)::int AS species_count
        FROM base
        GROUP BY scope_key, grid_multiplier, lng_bucket, lat_bucket
      ),
      grid AS (
        SELECT
          t.scope_key, t.grid_multiplier, t.lng_bucket, t.lat_bucket,
          t.observation_count, t.species_count,
          COALESCE(f.families, '[]'::jsonb) AS families
        FROM bucket_totals t
        LEFT JOIN families f
          ON  f.scope_key = t.scope_key
          AND f.grid_multiplier = t.grid_multiplier
          AND f.lng_bucket = t.lng_bucket
          AND f.lat_bucket = t.lat_bucket
      ),
      ins AS (
        INSERT INTO observation_grid_agg
          (scope_key, grid_multiplier, lng_bucket, lat_bucket,
           observation_count, species_count, families)
        SELECT scope_key, grid_multiplier, lng_bucket, lat_bucket,
               observation_count, species_count, families
        FROM grid
        RETURNING 1
      )
      SELECT count(*)::text AS n FROM ins
      `,
      [NATIONAL_SCOPE_KEY, TOP_SPECIES_PER_FAMILY],
    );
    await client.query('COMMIT');
    return Number(result.rows[0]?.n ?? 0);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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

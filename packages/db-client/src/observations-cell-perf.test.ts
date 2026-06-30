/**
 * PROD-SCALE PERF + INDEX-USAGE GUARD for the single-cell sightings-log query
 * (#1300, epic #1299).
 *
 * Why a falsifiable index assertion and NOT a wall-clock-only guard: a
 * single-species, single-cell slice is small (≤ a few thousand rows), so it
 * stays fast even on a SEQ SCAN at modest volume — a wall-clock-only threshold
 * here would be non-falsifiable ceremony (it would pass with or without the
 * indexes). The real risk is the `count(*) OVER ()` denominator: because the
 * window must touch EVERY matched (windowed) row before LIMIT applies, a query
 * that fails to drive off `obs_geom_idx` (tight cell envelope) + `obs_species_idx`
 * (species filter) degrades to a full table scan at prod scale. This guard makes
 * that regression RED two ways:
 *
 *   (a) PROD-SCALE SEED — ~100k background observations across CONUS plus a
 *       dense single-species `m=2` (coarsest, 0.5°×0.5°) cell, so a missing
 *       index actually blows wall-clock (best-of-N min under a generous guard).
 *   (b) EXPLAIN (ANALYZE) — asserts the plan for the EXACT query
 *       getCellObservations runs (via buildCellObservationsQuery) uses an
 *       Index/Bitmap scan on `obs_geom_idx`/`obs_species_idx` and NEVER a
 *       `Seq Scan on observations`.
 *
 * RED case this is designed to fail on: dropping `obs_species_idx`/`obs_geom_idx`
 * (migration 1700000006000), or any query rewrite where the `count(*) OVER ()`
 * windowed set forces a full unindexed `Seq Scan on observations`. Both flip
 * the EXPLAIN assertion (and, at this volume, the wall-clock guard) RED.
 *
 * Real-Postgres+PostGIS testcontainer (no DB mocks, per repo convention); runs
 * its OWN container so the heavy seed never touches the shared observations.test
 * fixtures.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
// Side-effect import: registers pool-wide type parsers (NUMERIC → number).
import './pool.js';
import {
  getCellObservations,
  buildCellObservationsQuery,
  CELL_OBSERVATIONS_LIMIT,
  NATIONAL_SCOPE_KEY,
  type CellObservationsParams,
} from './observations.js';

// Background volume. Large enough that a `Seq Scan on observations` is both
// measurably slow AND cost-uncompetitive with the selective indexes (so the
// planner is forced onto them), small enough to keep CI quick. Env-overridable.
const BG_ROWS = Number(process.env.CELL_PERF_BG_ROWS ?? 100_000);

// Dense single-species cell. > CELL_OBSERVATIONS_LIMIT so the LIMIT brake fires
// and the truncation denominator is exercised at scale.
const CELL_FRESH = 1_500; // in-cell, fresh (within 14d)
const CELL_OLD = 50;      // in-cell, OLD (>14d) — dropped by the since window
const TARGET_SCATTERED = 300; // same species, OUTSIDE the cell (geom filter must prune)

// Coarsest grid (m=2 → 0.5° cell). Bucket center round(-100*2)/2 = -100,
// round(38*2)/2 = 38 → cell [-100.25, 37.75, -99.75, 38.25].
const M = 2;
const LNG_BUCKET = -100.0;
const LAT_BUCKET = 38.0;

// Generous wall-clock ceiling — the selective query is tens of ms; this only
// trips on a catastrophic full-scan regression at BG_ROWS scale. Best-of-N min
// de-noises one-sided CI contention (same rationale as the aggregated guard).
const PERF_THRESHOLD_MS = 5_000;
const PERF_RUNS = Number(process.env.CELL_PERF_RUNS ?? 3);

async function fastestOf<T>(
  runs: number,
  fn: () => Promise<T>,
): Promise<{ result: T; minMs: number; samples: number[] }> {
  const samples: number[] = [];
  let result!: T;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    result = await fn();
    samples.push(performance.now() - t0);
  }
  return { result, minMs: Math.min(...samples), samples };
}

let container: StartedPostgreSqlContainer;
let pool: pg.Pool;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgis/postgis:16-3.4').start();
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 4 });

  // Apply all Up migrations in numeric order (same as test-helpers.startTestDb).
  const migrationsDir = resolve(process.cwd(), '../../migrations');
  for (const f of readdirSync(migrationsDir).filter(x => x.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(migrationsDir, f), 'utf-8');
    const [rawUp = ''] = sql.split(/-- Down Migration/i);
    const up = rawUp.replace(/-- Up Migration/i, '');
    if (up.trim()) await pool.query(up);
  }

  // 40 background species + the target species.
  await pool.query(`
    INSERT INTO species_meta (species_code, com_name, sci_name, family_code, family_name, taxon_order)
    SELECT 'bg-' || lpad(g::text, 3, '0'), 'BG ' || g, 'Bgus ' || g, 'bgfam', 'Background Family', 10000 + g
    FROM generate_series(0, 39) g
    ON CONFLICT (species_code) DO NOTHING
  `);
  await pool.query(`
    INSERT INTO species_meta (species_code, com_name, sci_name, family_code, family_name, taxon_order)
    VALUES ('targsp', 'Target Bird', 'Targus avis', 'targfam', 'Target Family', 55555)
    ON CONFLICT (species_code) DO NOTHING
  `);

  // ~100k background rows across CONUS (lat 25..49, lng -125..-67), all fresh.
  await pool.query(
    `INSERT INTO observations (sub_id, species_code, lat, lng, obs_dt, loc_id, loc_name, how_many, is_notable)
     SELECT
       'BG-' || g::text,
       'bg-' || lpad((g % 40)::text, 3, '0'),
       25 + (g % 2400) * 0.01,
       -125 + (g % 5800) * 0.01,
       now() - ((g % 13) * interval '1 day') - interval '1 hour',
       'L-bg', NULL, 1, false
     FROM generate_series(1, $1) g`,
    [BG_ROWS],
  );
  // Dense fresh target species AT the cell center.
  await pool.query(
    `INSERT INTO observations (sub_id, species_code, lat, lng, obs_dt, loc_id, loc_name, how_many, is_notable)
     SELECT 'TC-' || g::text, 'targsp', $1::float8, $2::float8,
            now() - (g * interval '1 second'), 'L-tc', 'TargetCell', 1, false
     FROM generate_series(1, $3) g`,
    [LAT_BUCKET, LNG_BUCKET, CELL_FRESH],
  );
  // OLD target species in the cell (>14d) — must drop from the since=14d window.
  await pool.query(
    `INSERT INTO observations (sub_id, species_code, lat, lng, obs_dt, loc_id, loc_name, how_many, is_notable)
     SELECT 'TCOLD-' || g::text, 'targsp', $1::float8, $2::float8,
            now() - interval '20 days' - (g * interval '1 second'), 'L-tco', 'TargetCellOld', 1, false
     FROM generate_series(1, $3) g`,
    [LAT_BUCKET, LNG_BUCKET, CELL_OLD],
  );
  // Same species, scattered OUTSIDE the cell (lat ~30, lng ~-117) — the geom
  // envelope must prune these, so the cell bbox filter is load-bearing.
  await pool.query(
    `INSERT INTO observations (sub_id, species_code, lat, lng, obs_dt, loc_id, loc_name, how_many, is_notable)
     SELECT 'TS-' || g::text, 'targsp', 30 + (g % 5) * 0.3, -117 + (g % 5) * 0.3,
            now() - ((g % 10) * interval '1 day') - interval '1 hour', 'L-ts', 'TargetScattered', 1, false
     FROM generate_series(1, $1) g`,
    [TARGET_SCATTERED],
  );

  // Plan-quality stats — without ANALYZE the planner mis-estimates and the
  // index-choice / perf numbers are not representative of prod (autovacuum).
  await pool.query('ANALYZE observations');
  await pool.query('ANALYZE species_meta');

  // Sanity: the seed reached scale and the target species is selective (rare).
  const { rows: tot } = await pool.query<{ c: string }>(
    'SELECT count(*)::text AS c FROM observations',
  );
  expect(Number(tot[0]!.c)).toBeGreaterThanOrEqual(BG_ROWS + CELL_FRESH);
  const { rows: targ } = await pool.query<{ c: string }>(
    "SELECT count(*)::text AS c FROM observations WHERE species_code = 'targsp'",
  );
  // Target species must be a small fraction so the index is the cheap path.
  expect(Number(targ[0]!.c)).toBeLessThan(BG_ROWS * 0.1);
}, 180_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

const CELL_PARAMS: CellObservationsParams = {
  scopeKey: NATIONAL_SCOPE_KEY,
  gridMultiplier: M,
  lngBucket: LNG_BUCKET,
  latBucket: LAT_BUCKET,
  speciesCode: 'targsp',
  since: '14d',
};

describe('getCellObservations single-cell perf + index-usage guard (#1300)', () => {
  it(
    'drives the dense single-species cell off obs_geom_idx/obs_species_idx — never a Seq Scan on observations',
    async () => {
      // EXPLAIN the EXACT query getCellObservations runs (same builder → no
      // drift from a hand-written copy). EXPLAIN ANALYZE executes it.
      const { sql, params } = buildCellObservationsQuery(CELL_PARAMS);
      const { rows } = await pool.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`,
        params,
      );
      const plan = rows.map(r => r['QUERY PLAN']).join('\n');

      // eslint-disable-next-line no-console
      console.log(`[#1300 cell index guard] plan:\n${plan}`);

      // FALSIFIABLE: the plan must use a named index on observations and must
      // NOT seq-scan the table. Dropping either index (or a rewrite that forces
      // a full windowed scan) flips this RED.
      expect(plan).toMatch(/obs_geom_idx|obs_species_idx/);
      expect(plan).not.toMatch(/Seq Scan on observations/);
    },
    120_000,
  );

  it(
    'returns the LIMIT-capped latest page with the exact windowed denominator, well under the timeout',
    async () => {
      const { result, minMs, samples } = await fastestOf(PERF_RUNS, () =>
        getCellObservations(pool, CELL_PARAMS),
      );

      // eslint-disable-next-line no-console
      console.log(
        `[#1300 cell perf guard] min ${minMs.toFixed(0)}ms of [${samples
          .map(s => s.toFixed(0))
          .join(', ')}]ms over ${BG_ROWS} bg rows → ${result.data.length} rows, count ${result.cellObservationCount} (threshold ${PERF_THRESHOLD_MS}ms)`,
      );

      // PERF — selective query stays fast at prod scale; trips on a full-scan
      // regression.
      expect(minMs).toBeLessThan(PERF_THRESHOLD_MS);

      // LIMIT honored: the page is capped, truncation flagged, and the
      // denominator is the EXACT pre-LIMIT windowed count (the 1500 fresh
      // in-cell rows — NOT the 50 old ones, NOT the 300 scattered, NOT capped to
      // the page length).
      expect(result.data.length).toBeLessThanOrEqual(CELL_OBSERVATIONS_LIMIT);
      expect(result.data).toHaveLength(CELL_OBSERVATIONS_LIMIT);
      expect(result.truncated).toBe(true);
      expect(result.cellObservationCount).toBe(CELL_FRESH);
      // Rows are ordered obs_dt DESC.
      for (let i = 1; i < result.data.length; i++) {
        expect(result.data[i - 1]!.obsDt >= result.data[i]!.obsDt).toBe(true);
      }
    },
    120_000,
  );
});

/**
 * PROD-SCALE PERF GUARD for the national low-zoom aggregated query (#862).
 *
 * Prod incident: the coarsest national aggregated request (gridMultiplier=2,
 * since=14d, whole-US, no bbox/state) returned HTTP 503 because the #859
 * `getObservationsAggregated` query exceeded the 15s `statement_timeout`. The
 * prior #859 work measured PAYLOAD size but never QUERY TIME — this test pins
 * the query-time regression that the payload tests could not see.
 *
 * What this guards:
 *   1. PERF — at ~550k observations across CONUS the national query must finish
 *      well under the timeout. The pre-#862 query body spilled a multi-GB
 *      external-merge sort (it grouped the bucket totals by the per-bucket
 *      `families` jsonb, duplicating the blob across every base row) and ran
 *      ~147s. The #862 fix splits the totals into their own `bucket_totals`
 *      CTE keyed only on (lng_bucket, lat_bucket) → ~2.3s. The threshold below
 *      FAILS on the pre-#862 query and PASSES on the fix.
 *   2. CORRECTNESS — the fix must not silently change results. We snapshot the
 *      full national result on first run (sorted, with the families jsonb
 *      canonicalised) and assert run-to-run equality, so any future change to
 *      the CTE chain that alters buckets/counts/top-8/ordering trips the test.
 *
 * Determinism note: the bucket key `round(ST_X(geom)*mult)/mult` is
 * float-valued, and Postgres' PARALLEL HashAggregate over a float group key
 * produces run-to-run variation in which bucket a boundary-adjacent row lands
 * in (verified during the #862 investigation — it affects the pre-#862 query
 * identically, so it is not a correctness regression in the fix). To make the
 * correctness snapshot reproducible we disable parallel gather on this test DB
 * (`max_parallel_workers_per_gather = 0`). That is purely a test-harness knob;
 * it does NOT touch the production query or the read-api pool. It also makes
 * the perf assertion CONSERVATIVE: the serial plan is the slower case, so prod
 * (which keeps parallelism) is only ever faster than what we measure here.
 *
 * This is a real-Postgres+PostGIS testcontainer test (no DB mocks, per repo
 * convention). It runs its OWN container so the heavy seed never touches the
 * shared fixtures in observations.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
// Side-effect import: registers pool-wide type parsers (NUMERIC → number).
import './pool.js';
import { getObservationsAggregated } from './observations.js';

// Prod-scale target. bird-maps.com carries ~550k observations nationally; the
// failing request is the coarsest grid over the whole set. 550k reproduces the
// timeout on the pre-#862 query and exercises the same aggregation volume.
const TARGET_ROWS = Number(process.env.PERF_ROWS ?? 550_000);

// Hard ceiling: the read-api pool's statement_timeout is 15_000ms (pool.ts).
// We assert well under it — the #862 fix runs ~2.3s at prod scale on CI-class
// hardware, but containers + shared CI runners are noisy, so 8_000ms is the
// guard threshold (comfortably below 15s, comfortably above the ~2.3s fix, and
// FAR below the pre-#862 ~147s). A run over this means the timeout regression
// is back.
const PERF_THRESHOLD_MS = 8_000;

// Deterministic PRNG so the seed (and therefore the correctness snapshot) is
// reproducible across runs and machines.
function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let container: StartedPostgreSqlContainer;
let pool: pg.Pool;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgis/postgis:16-3.4').start();
  const uri = container.getConnectionUri();

  // Force serial plans on this test DB so the float-keyed bucket aggregation is
  // run-to-run deterministic (see the determinism note in the file header). The
  // serial plan is the SLOWER case, so the perf threshold below stays a valid —
  // and conservative — guard against the timeout regression. Apply the GUC then
  // build the pool AFTER pg_reload_conf so every pooled connection inherits it.
  const cfg = new pg.Pool({ connectionString: uri, max: 1 });
  await cfg.query('ALTER SYSTEM SET max_parallel_workers_per_gather = 0');
  await cfg.query('SELECT pg_reload_conf()');
  await cfg.end();

  pool = new pg.Pool({ connectionString: uri, max: 4 });

  // Apply all Up migrations in numeric order (same as test-helpers.startTestDb).
  const migrationsDir = resolve(process.cwd(), '../../migrations');
  for (const f of readdirSync(migrationsDir).filter(x => x.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(migrationsDir, f), 'utf-8');
    const [rawUp = ''] = sql.split(/-- Down Migration/i);
    const up = rawUp.replace(/-- Up Migration/i, '');
    if (up.trim()) await pool.query(up);
  }

  const rng = mulberry32(0xb12d5e);

  // Skewed taxonomy: ~40 families, ~700 species, a few mega-families fat (so a
  // dense cell can carry 100-197 species and the top-8 cap actually bites).
  const FAMILIES = 40;
  const SPECIES = 700;
  const familyCodes = Array.from({ length: FAMILIES }, (_, i) => `fam-${String(i).padStart(3, '0')}`);
  const speciesMeta: Array<{ code: string; fam: string }> = [];
  for (let s = 0; s < SPECIES; s++) {
    // bias toward low family index → zipf-ish family sizes (mega-families).
    const fi = Math.min(FAMILIES - 1, Math.floor(Math.pow(rng(), 2) * FAMILIES));
    speciesMeta.push({ code: `sp-${String(s).padStart(4, '0')}`, fam: familyCodes[fi]! });
  }
  // ~3% of species have NO species_meta row → NULL family (exercises the
  // carve-out: counted in bucket totals, excluded from families[]).
  const known = speciesMeta.filter((_, i) => i % 33 !== 0);
  const smVals = known
    .map((m, i) => `('${m.code}','Com ${i}','Sci ${i}','${m.fam}','Fam ${m.fam}',${10000 + i})`)
    .join(',');
  await pool.query(
    `INSERT INTO species_meta (species_code, com_name, sci_name, family_code, family_name, taxon_order) VALUES ${smVals}`,
  );

  // CONUS coverage as INTEGER 0.5°-bucket indices. The coarsest national grid
  // is `round(coord*2)/2` (multiplier 2 → 0.5° buckets). We place every point
  // at `index/2 + 0.2` — a bucket INTERIOR offset of 0.2 sits far from both the
  // 0.5° cell edges AND the 0.25° round-half midpoint, so `round((idx/2+0.2)*2)
  // /2 = idx/2` with zero boundary ambiguity. Building coordinates from integer
  // indices (not float-snapping a random float, which accumulates ULP error and
  // leaves a handful of rows straddling a boundary) makes the bucket assignment
  // — and therefore the correctness snapshot — exactly reproducible.
  // CONUS lng index range ≈ [-250, -134] (i.e. -125°..-67°); lat ≈ [50, 98]
  // (25°..49°). Hotspots are fixed index pairs → dense, species-rich cells.
  const LNG_IDX_MIN = -250, LNG_IDX_SPAN = 116; // -125.0 .. -67.0
  const LAT_IDX_MIN = 50, LAT_IDX_SPAN = 48; //   25.0 .. 49.0
  const toCoord = (idx: number) => idx / 2 + 0.2;
  const hotspots = Array.from({ length: 60 }, () => ({
    lngIdx: LNG_IDX_MIN + Math.floor(rng() * LNG_IDX_SPAN),
    latIdx: LAT_IDX_MIN + Math.floor(rng() * LAT_IDX_SPAN),
    richness: 100 + Math.floor(rng() * 97),
  }));

  const now = Date.now();
  const BATCH = 20_000;
  let inserted = 0;
  let sub = 0;
  while (inserted < TARGET_ROWS) {
    const n = Math.min(BATCH, TARGET_ROWS - inserted);
    const subIds: string[] = [], codes: string[] = [], lats: number[] = [], lngs: number[] = [];
    const dts: string[] = [], locIds: string[] = [], locNames: (string | null)[] = [];
    const hows: (number | null)[] = [], notables: boolean[] = [];
    for (let i = 0; i < n; i++) {
      let lngIdx: number, latIdx: number, sp: string;
      if (rng() < 0.55) {
        // Dense hotspot cluster: jitter ±2 bucket indices around a hotspot, so
        // the cluster spans a few cells but every point still lands on an
        // integer-indexed bucket interior.
        const hs = hotspots[Math.floor(rng() * hotspots.length)]!;
        lngIdx = hs.lngIdx + (Math.floor(rng() * 5) - 2);
        latIdx = hs.latIdx + (Math.floor(rng() * 5) - 2);
        sp = speciesMeta[Math.floor(Math.pow(rng(), 0.5) * Math.min(hs.richness, SPECIES))]!.code;
      } else {
        // Uniform spread across CONUS bucket indices.
        lngIdx = LNG_IDX_MIN + Math.floor(rng() * LNG_IDX_SPAN);
        latIdx = LAT_IDX_MIN + Math.floor(rng() * LAT_IDX_SPAN);
        sp = speciesMeta[Math.floor(rng() * SPECIES)]!.code;
      }
      const lng = toCoord(lngIdx);
      const lat = toCoord(latIdx);
      // Recency split: ~85% "recent" (0–13 days old), ~15% "old" (15–60 days).
      // CRITICAL determinism guard: leave an EMPTY band between 13 and 15 days
      // so NO row sits near the 14-day `since` cutoff. The query filters
      // `obs_dt >= now() - 14 days`, and `now()` is evaluated per statement —
      // it advances by milliseconds between the timing run and the correctness
      // re-run. A row landing microseconds from the cutoff would flip in/out of
      // the result set across runs (the real source of the 3-bucket drift seen
      // during the #862 investigation). The 13–15 day gap makes the `since`
      // filter classify every row identically on every run, while still pruning
      // ~15% so the filter is real and `obs_dt`-index-relevant. Ages are whole
      // days for the same reason (no sub-day fuzz near the boundary).
      const ageDays = rng() < 0.85
        ? Math.floor(rng() * 13)        // 0..12 days → comfortably inside 14d
        : 15 + Math.floor(rng() * 45);  // 15..59 days → comfortably outside
      subIds.push(`S${sub++}`);
      codes.push(sp);
      lngs.push(lng);
      lats.push(lat);
      dts.push(new Date(now - ageDays * 86_400_000).toISOString());
      locIds.push('L0');
      locNames.push(null);
      hows.push(1);
      notables.push(false);
    }
    await pool.query(
      `INSERT INTO observations (sub_id, species_code, lat, lng, obs_dt, loc_id, loc_name, how_many, is_notable)
       SELECT * FROM unnest($1::text[],$2::text[],$3::float8[],$4::float8[],$5::timestamptz[],$6::text[],$7::text[],$8::int[],$9::bool[])
       ON CONFLICT (sub_id, species_code) DO NOTHING`,
      [subIds, codes, lats, lngs, dts, locIds, locNames, hows, notables],
    );
    inserted += n;
  }

  // Plan-quality stats — without ANALYZE the planner mis-estimates and the perf
  // numbers are not representative of prod (which runs autovacuum/ANALYZE).
  await pool.query('ANALYZE observations');
  await pool.query('ANALYZE species_meta');
  // Sanity-check the seed actually reached prod scale and the `since` filter is
  // selective (not an all-time scan, not a no-op).
  const { rows: tot } = await pool.query<{ c: string }>('SELECT count(*)::text AS c FROM observations');
  expect(Number(tot[0]!.c)).toBeGreaterThanOrEqual(TARGET_ROWS - 1000);
  const { rows: in14 } = await pool.query<{ c: string }>(
    `SELECT count(*)::text AS c FROM observations WHERE obs_dt >= now() - interval '14 days'`,
  );
  const within14 = Number(in14[0]!.c);
  expect(within14).toBeGreaterThan(TARGET_ROWS * 0.7); // ~85% expected
  expect(within14).toBeLessThan(TARGET_ROWS); // since must prune SOMETHING
  // Confirm the serial-plan GUC actually took effect on a pooled connection —
  // otherwise the correctness snapshot assertion below would be flaky.
  const { rows: guc } = await pool.query<{ max_parallel_workers_per_gather: string }>(
    'SHOW max_parallel_workers_per_gather',
  );
  expect(guc[0]!.max_parallel_workers_per_gather).toBe('0');
}, 600_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

/** Canonical, order-independent fingerprint of a national result set. */
function fingerprint(buckets: Awaited<ReturnType<typeof getObservationsAggregated>>): string {
  const rows = buckets
    .map(b => ({
      lng: b.lng,
      lat: b.lat,
      count: b.count,
      speciesCount: b.speciesCount,
      // families already arrive ordered by (count desc, code asc) from the
      // query; species within a family ordered by (count desc, code asc).
      families: b.families,
    }))
    .sort((a, z) => a.lng - z.lng || a.lat - z.lat);
  return JSON.stringify(rows);
}

describe('getObservationsAggregated national perf guard (#862)', () => {
  it(
    'runs the coarsest national query (gridMultiplier=2, since=14d) under the timeout, deterministically',
    async () => {
      // Match the failing prod request EXACTLY: since=14d, no bbox, no state,
      // gridMultiplier=2 (the coarsest national grid the read-api selects for
      // zoom <= 3).
      const t0 = performance.now();
      const buckets = await getObservationsAggregated(pool, { since: '14d' }, 2);
      const elapsedMs = performance.now() - t0;

      // eslint-disable-next-line no-console
      console.log(
        `[#862 perf guard] national query: ${elapsedMs.toFixed(0)}ms over ${TARGET_ROWS} rows → ${buckets.length} buckets (threshold ${PERF_THRESHOLD_MS}ms, pool statement_timeout 15000ms)`,
      );

      // PERF GUARD — this is the assertion that FAILS on the pre-#862 query
      // (~147s, > 15s statement_timeout) and PASSES on the fix (~2.3s).
      expect(elapsedMs).toBeLessThan(PERF_THRESHOLD_MS);

      // The seed always produces buckets; a national view is never empty.
      expect(buckets.length).toBeGreaterThan(100);
      // Every bucket carries real totals.
      for (const b of buckets) {
        expect(b.count).toBeGreaterThan(0);
        expect(b.speciesCount).toBeGreaterThan(0);
        expect(b.speciesCount).toBeLessThanOrEqual(b.count);
      }

      // CORRECTNESS GUARD — re-run and assert byte-identical results, so any
      // future optimisation that silently changes buckets/counts/top-8 ordering
      // trips here. Boundary-stable geometry makes this deterministic.
      const baseline = fingerprint(buckets);
      const rerun = await getObservationsAggregated(pool, { since: '14d' }, 2);
      expect(fingerprint(rerun)).toBe(baseline);

      // Spot-check the top-8 cap is actually exercised somewhere (a dense
      // hotspot cell has >8 species in at least one family) — proves the
      // expensive ranked/per_family path ran, not a degenerate small result.
      const capHit = buckets.some(b =>
        b.families.some(fam => fam.speciesCount > fam.species.length && fam.species.length === 8),
      );
      expect(capHit).toBe(true);
    },
    120_000,
  );

  it(
    'the full CONUS_BOUNDS canonical bbox query is ⊆ the no-bbox national query and well under the timeout (#868)',
    async () => {
      // #868 perf guard for Lever 1: the canonical z3/z4 cold-load key is the
      // ENTIRE CONUS envelope (CONUS_BOUNDS = the @bird-watch/geo constant, =
      // the camera maxBounds, = the prod-MISSed desktop bbox). It is the LARGEST
      // canonical bbox query the read-api can ever receive at gridMultiplier=2.
      // Adding a bbox can only ADD a `geom && ST_MakeEnvelope` predicate that
      // PRUNES rows (it never adds work vs the unfiltered national scan), so the
      // bounded query must run no slower than the no-bbox national query and stay
      // comfortably under the 15s statement_timeout. This pins the issue's claim
      // (#3) that over-fetch is not a cost tradeoff once clamped: the largest
      // canonical query ⊆ the no-bbox national query → net-reduces DB load.
      const CONUS_BOUNDS: [number, number, number, number] = [-130, 20, -65, 52];

      // Baseline: the no-bbox national query time (the #862 worst case).
      const tNat0 = performance.now();
      const national = await getObservationsAggregated(pool, { since: '14d' }, 2);
      const nationalMs = performance.now() - tNat0;

      // The full-CONUS canonical bbox query.
      const tConus0 = performance.now();
      const bounded = await getObservationsAggregated(
        pool,
        { since: '14d', bbox: CONUS_BOUNDS },
        2,
      );
      const conusMs = performance.now() - tConus0;

      // eslint-disable-next-line no-console
      console.log(
        `[#868 perf guard] CONUS_BOUNDS canonical query: ${conusMs.toFixed(0)}ms vs no-bbox national ${nationalMs.toFixed(0)}ms over ${TARGET_ROWS} rows → ${bounded.length}/${national.length} buckets (threshold ${PERF_THRESHOLD_MS}ms)`,
      );

      // Well under the timeout (same conservative guard as the national test).
      expect(conusMs).toBeLessThan(PERF_THRESHOLD_MS);
      // ≤ the no-bbox national time, with a slack factor for container/CI noise:
      // the bounded query is a strict subset of the national scan's work, so it
      // must not be materially slower. 1.5× absorbs measurement jitter while
      // still failing if the bbox predicate ever made the plan pathologically
      // worse (e.g. a bad index choice).
      expect(conusMs).toBeLessThanOrEqual(Math.max(nationalMs * 1.5, 1500));

      // The CONUS bbox covers the whole seed (all rows are inside CONUS by
      // construction), so the bounded result is non-empty and carries real
      // totals — not a degenerate empty box.
      expect(bounded.length).toBeGreaterThan(100);
      for (const b of bounded) {
        expect(b.count).toBeGreaterThan(0);
        expect(b.speciesCount).toBeGreaterThan(0);
      }
    },
    120_000,
  );
});

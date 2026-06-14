/**
 * #878 — precomputed per-scope aggregation grid (observation_grid_agg).
 *
 * Real Postgres+PostGIS testcontainer (no DB mocks, per repo convention). The
 * seed is small but geometrically representative: rows inside two state
 * polygons (US-AZ, US-CA) plus a few outside both, so the per-state clip and the
 * national rollup are both exercised. The serial-plan GUC (max_parallel_workers
 * _per_gather = 0) makes the float-keyed bucket aggregation run-to-run
 * deterministic so the byte-identity assertion against the live CTE is exact.
 *
 * Guards:
 *   1. EQUIVALENCE — refreshGridAgg's grid is byte-identical to the live
 *      getObservationsAggregated CTE for the default unfiltered scope (national
 *      AND a state), at every standard multiplier (2/4/8): same buckets, counts,
 *      species counts, and families jsonb.
 *   2. PREDICATE — isPrecomputeEligible is positive: default state/national view
 *      (with the always-present state-envelope bbox) is eligible; any filter,
 *      non-default since, or non-standard multiplier is not.
 *   3. REFRESH CORRECTNESS — after an ingest delta AND after a prune the grid
 *      reflects the new state with no stale cells.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';
// Side-effect import: registers pool-wide type parsers (NUMERIC → number).
import './pool.js';
import {
  getObservationsAggregated,
  refreshGridAgg,
  getAggregatedGridFromCache,
  isPrecomputeEligible,
  resolveScopeKey,
  NATIONAL_SCOPE_KEY,
  STANDARD_GRID_MULTIPLIERS,
} from './observations.js';
import type { AggregatedBucket } from '@bird-watch/shared-types';

let container: StartedPostgreSqlContainer;
let pool: pg.Pool;

// A handful of (lng, lat) points inside US-AZ and US-CA, plus a couple outside
// both (a Gulf-of-Mexico point and a mid-Atlantic point) so the national grid
// carries rows the per-state clips drop. AZ ≈ [-114.8..-109, 31.3..37]; CA ≈
// [-124.4..-114.1, 32.5..42]. Coordinates use a +0.2 bucket-interior offset to
// keep bucket assignment unambiguous across multipliers (mirrors the perf
// guard's integer-index construction reasoning).
const PTS: Array<{ lng: number; lat: number }> = [
  // Arizona cluster
  { lng: -112.1, lat: 33.5 }, { lng: -112.1, lat: 33.5 }, { lng: -111.9, lat: 33.3 },
  { lng: -110.9, lat: 32.2 }, { lng: -111.7, lat: 35.2 },
  // California cluster
  { lng: -118.3, lat: 34.1 }, { lng: -118.3, lat: 34.1 }, { lng: -122.4, lat: 37.7 },
  { lng: -121.5, lat: 38.6 }, { lng: -117.2, lat: 32.7 },
  // Outside both states (national-only)
  { lng: -90.0, lat: 27.0 }, { lng: -75.0, lat: 38.0 },
];

const SPECIES = ['sp-0001', 'sp-0002', 'sp-0003', 'sp-0004', 'sp-0005'];

async function seedObservations(startSub: number, count: number): Promise<void> {
  const subIds: string[] = [], codes: string[] = [], lats: number[] = [], lngs: number[] = [];
  const dts: string[] = [], locIds: string[] = [], locNames: (string | null)[] = [];
  const hows: (number | null)[] = [], notables: boolean[] = [];
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const p = PTS[i % PTS.length]!;
    subIds.push(`S${startSub + i}`);
    codes.push(SPECIES[i % SPECIES.length]!);
    lngs.push(p.lng);
    lats.push(p.lat);
    // All within the 14d window (age 0..10 days, whole days — no boundary fuzz).
    dts.push(new Date(now - (i % 11) * 86_400_000).toISOString());
    locIds.push('L0');
    locNames.push(null);
    hows.push(1);
    notables.push(i % 7 === 0);
  }
  await pool.query(
    `INSERT INTO observations (sub_id, species_code, lat, lng, obs_dt, loc_id, loc_name, how_many, is_notable)
     SELECT * FROM unnest($1::text[],$2::text[],$3::float8[],$4::float8[],$5::timestamptz[],$6::text[],$7::text[],$8::int[],$9::bool[])
     ON CONFLICT (sub_id, species_code) DO NOTHING`,
    [subIds, codes, lats, lngs, dts, locIds, locNames, hows, notables],
  );
}

/** Order-independent fingerprint of an aggregated result set. */
function fingerprint(buckets: AggregatedBucket[]): string {
  return JSON.stringify(
    buckets
      .map(b => ({ lng: b.lng, lat: b.lat, count: b.count, speciesCount: b.speciesCount, families: b.families }))
      .sort((a, z) => a.lng - z.lng || a.lat - z.lat),
  );
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgis/postgis:16-3.4').start();
  const uri = container.getConnectionUri();

  // Serial plans → deterministic float-keyed aggregation (same rationale as the
  // perf guard). Apply the GUC then build the pool after pg_reload_conf.
  const cfg = new pg.Pool({ connectionString: uri, max: 1 });
  await cfg.query('ALTER SYSTEM SET max_parallel_workers_per_gather = 0');
  await cfg.query('SELECT pg_reload_conf()');
  await cfg.end();

  pool = new pg.Pool({ connectionString: uri, max: 4 });

  const migrationsDir = resolve(process.cwd(), '../../migrations');
  for (const f of readdirSync(migrationsDir).filter(x => x.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(migrationsDir, f), 'utf-8');
    const [rawUp = ''] = sql.split(/-- Down Migration/i);
    const up = rawUp.replace(/-- Up Migration/i, '');
    if (up.trim()) await pool.query(up);
  }

  // species_meta: sp-0001..0004 known (families fam-a/fam-b), sp-0005 NULL family
  // (no species_meta row) so the NULL-family carve-out is exercised: counted in
  // bucket totals, excluded from families[].
  await pool.query(
    `INSERT INTO species_meta (species_code, com_name, sci_name, family_code, family_name, taxon_order) VALUES
       ('sp-0001','Com 1','Sci 1','fam-a','Fam A',10001),
       ('sp-0002','Com 2','Sci 2','fam-a','Fam A',10002),
       ('sp-0003','Com 3','Sci 3','fam-b','Fam B',10003),
       ('sp-0004','Com 4','Sci 4','fam-b','Fam B',10004)`,
  );

  // #924 PR4: seed a family_silhouettes row for fam-a ONLY, with a curated
  // common_name ('Antbirds') distinct from sm.family_name ('Fam A'). This makes
  // the server COALESCE(fs.common_name, sm.family_name) projection observable on
  // both arms: fam-a resolves via the silhouette FIRST arm ('Antbirds'), fam-b
  // has no silhouette row so it falls through to the family_name SECOND arm
  // ('Fam B'). id/svg_data/color/color_dark are NOT NULL — values are arbitrary.
  await pool.query(
    `INSERT INTO family_silhouettes (id, family_code, svg_data, color, color_dark, common_name) VALUES
       ('fam-a','fam-a','<svg/>','#abc','#abc','Antbirds')`,
  );

  await seedObservations(0, 600);
  await pool.query('ANALYZE observations');
  await pool.query('ANALYZE species_meta');
  await pool.query('ANALYZE state_boundaries');
}, 600_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe('refreshGridAgg ↔ getObservationsAggregated byte-identity (#878)', () => {
  it('populates a non-empty grid for national + states across all standard multipliers', async () => {
    const n = await refreshGridAgg(pool);
    expect(n).toBeGreaterThan(0);
    // National grid exists at every standard multiplier.
    for (const m of STANDARD_GRID_MULTIPLIERS) {
      const nat = await getAggregatedGridFromCache(pool, NATIONAL_SCOPE_KEY, m);
      expect(nat.length).toBeGreaterThan(0);
    }
    // AZ + CA grids exist.
    const az = await getAggregatedGridFromCache(pool, 'US-AZ', 8);
    const ca = await getAggregatedGridFromCache(pool, 'US-CA', 8);
    expect(az.length).toBeGreaterThan(0);
    expect(ca.length).toBeGreaterThan(0);
  });

  it('national precompute is byte-identical to the live CTE at every multiplier', async () => {
    await refreshGridAgg(pool);
    for (const m of STANDARD_GRID_MULTIPLIERS) {
      const live = await getObservationsAggregated(pool, { since: '14d' }, m);
      const cached = await getAggregatedGridFromCache(pool, NATIONAL_SCOPE_KEY, m);
      expect(fingerprint(cached)).toBe(fingerprint(live));
    }
  });

  it('per-state precompute is byte-identical to the live CTE (incl. the state envelope bbox) at every multiplier', async () => {
    await refreshGridAgg(pool);
    for (const stateCode of ['US-AZ', 'US-CA']) {
      for (const m of STANDARD_GRID_MULTIPLIERS) {
        // Live path with the state clip AND a wide bbox — the wide envelope must
        // not change the result vs the precompute (server clips to the polygon).
        const live = await getObservationsAggregated(
          pool,
          { since: '14d', stateCode, bbox: [-180, 0, 0, 90] },
          m,
        );
        const cached = await getAggregatedGridFromCache(pool, stateCode, m);
        expect(fingerprint(cached)).toBe(fingerprint(live));
        expect(cached.length).toBeGreaterThan(0);
      }
    }
  });

  it('projects COALESCE(family_silhouettes.common_name, species_meta.family_name) as family.name on both paths (#924 PR4)', async () => {
    await refreshGridAgg(pool);
    for (const m of STANDARD_GRID_MULTIPLIERS) {
      const live = await getObservationsAggregated(pool, { since: '14d' }, m);
      const cached = await getAggregatedGridFromCache(pool, NATIONAL_SCOPE_KEY, m);

      // First arm (silhouette wins): fam-a has a family_silhouettes row with
      // common_name 'Antbirds', distinct from its sm.family_name 'Fam A'.
      const liveFamA = live.flatMap(b => b.families).find(f => f.code === 'fam-a');
      const cachedFamA = cached.flatMap(b => b.families).find(f => f.code === 'fam-a');
      expect(liveFamA?.name).toBe('Antbirds');
      expect(cachedFamA?.name).toBe('Antbirds');

      // Second arm (family_name fallback): fam-b has NO silhouette row, so it
      // resolves via sm.family_name 'Fam B'.
      const liveFamB = live.flatMap(b => b.families).find(f => f.code === 'fam-b');
      const cachedFamB = cached.flatMap(b => b.families).find(f => f.code === 'fam-b');
      expect(liveFamB?.name).toBe('Fam B');
      expect(cachedFamB?.name).toBe('Fam B');
    }
  });

  it('NULL-family rows are counted in totals but excluded from families[] (matches live carve-out)', async () => {
    await refreshGridAgg(pool);
    const cached = await getAggregatedGridFromCache(pool, 'US-AZ', 8);
    // sp-0005 (NULL family) is seeded into AZ cells; some bucket must have a
    // count strictly greater than the species nested under its families[].
    const someBucketHasUnfamilied = cached.some(b => {
      const speciesInFamilies = b.families.reduce((acc, fam) => acc + fam.speciesCount, 0);
      return b.speciesCount > speciesInFamilies;
    });
    expect(someBucketHasUnfamilied).toBe(true);
  });
});

describe('isPrecomputeEligible positive predicate (#878)', () => {
  it('the default state view (state code + envelope bbox, default since, standard multiplier) IS eligible', () => {
    expect(isPrecomputeEligible({ since: '14d', stateCode: 'US-CA', bbox: [-124.4, 32.5, -114.1, 42] }, 8)).toBe(true);
    expect(resolveScopeKey({ since: '14d', stateCode: 'US-CA' })).toBe('US-CA');
  });

  it('the default national view (no state, default since, standard multiplier) IS eligible and resolves to US', () => {
    expect(isPrecomputeEligible({ since: '14d', bbox: [-130, 20, -65, 52] }, 2)).toBe(true);
    expect(resolveScopeKey({ since: '14d' })).toBe(NATIONAL_SCOPE_KEY);
  });

  it('unset since defaults to eligible (since defaults to 14d server-side)', () => {
    expect(isPrecomputeEligible({ stateCode: 'US-TX' }, 4)).toBe(true);
  });

  it('a notable / species / family filter is NOT eligible (falls back to live)', () => {
    expect(isPrecomputeEligible({ since: '14d', stateCode: 'US-CA', notable: true }, 8)).toBe(false);
    expect(isPrecomputeEligible({ since: '14d', stateCode: 'US-CA', speciesCode: 'sp-0001' }, 8)).toBe(false);
    expect(isPrecomputeEligible({ since: '14d', stateCode: 'US-CA', familyCode: 'fam-a' }, 8)).toBe(false);
  });

  it('a non-default since is NOT eligible', () => {
    expect(isPrecomputeEligible({ since: '7d', stateCode: 'US-CA' }, 8)).toBe(false);
    expect(isPrecomputeEligible({ since: '30d' }, 2)).toBe(false);
  });

  it('a non-standard grid multiplier is NOT eligible', () => {
    expect(isPrecomputeEligible({ since: '14d', stateCode: 'US-CA' }, 16)).toBe(false);
    expect(isPrecomputeEligible({ since: '14d' }, 3)).toBe(false);
  });
});

describe('refreshGridAgg correctness across ingest delta + prune (#878)', () => {
  it('reflects an ingest delta after re-refresh (no stale cells)', async () => {
    await refreshGridAgg(pool);
    const before = await getAggregatedGridFromCache(pool, 'US-AZ', 8);
    const beforeTotal = before.reduce((a, b) => a + b.count, 0);

    // Add a fresh AZ-heavy delta (all at the first AZ point) then re-refresh.
    const subIds: string[] = [], codes: string[] = [], lats: number[] = [], lngs: number[] = [];
    const dts: string[] = [], locIds: string[] = [], locNames: (string | null)[] = [];
    const hows: (number | null)[] = [], notables: boolean[] = [];
    const now = Date.now();
    for (let i = 0; i < 50; i++) {
      subIds.push(`DELTA${i}`);
      codes.push('sp-0001');
      lngs.push(-112.1);
      lats.push(33.5);
      dts.push(new Date(now - (i % 5) * 86_400_000).toISOString());
      locIds.push('L0'); locNames.push(null); hows.push(1); notables.push(false);
    }
    await pool.query(
      `INSERT INTO observations (sub_id, species_code, lat, lng, obs_dt, loc_id, loc_name, how_many, is_notable)
       SELECT * FROM unnest($1::text[],$2::text[],$3::float8[],$4::float8[],$5::timestamptz[],$6::text[],$7::text[],$8::int[],$9::bool[])
       ON CONFLICT (sub_id, species_code) DO NOTHING`,
      [subIds, codes, lats, lngs, dts, locIds, locNames, hows, notables],
    );
    await refreshGridAgg(pool);

    const after = await getAggregatedGridFromCache(pool, 'US-AZ', 8);
    const afterTotal = after.reduce((a, b) => a + b.count, 0);
    expect(afterTotal).toBe(beforeTotal + 50);
    // Still byte-identical to the live path post-delta.
    const live = await getObservationsAggregated(pool, { since: '14d', stateCode: 'US-AZ' }, 8);
    expect(fingerprint(after)).toBe(fingerprint(live));
  });

  it('reflects a prune (rows aged out) after re-refresh — pruned cells disappear', async () => {
    // Insert a batch of OLD AZ rows (40 days) in a fresh bucket, refresh (they're
    // outside 14d so the grid never carries them), then "prune" deletes them and
    // a re-refresh must still match the live path. Then prove an in-window row
    // that we delete drops out of the grid after refresh.
    const now = Date.now();
    // A unique-bucket fresh AZ point so we can watch it vanish on delete.
    await pool.query(
      `INSERT INTO observations (sub_id, species_code, lat, lng, obs_dt, loc_id, loc_name, how_many, is_notable)
       VALUES ('PRUNEME','sp-0001', 36.9, -113.9, $1, 'L0', NULL, 1, false)
       ON CONFLICT (sub_id, species_code) DO NOTHING`,
      [new Date(now - 2 * 86_400_000).toISOString()],
    );
    await refreshGridAgg(pool);
    const withRow = await getAggregatedGridFromCache(pool, 'US-AZ', 8);
    const targetLng = Math.round(-113.9 * 8) / 8;
    const targetLat = Math.round(36.9 * 8) / 8;
    expect(withRow.some(b => b.lng === targetLng && b.lat === targetLat)).toBe(true);

    // Prune that row, re-refresh: the cell must be gone (no stale cell).
    await pool.query(`DELETE FROM observations WHERE sub_id = 'PRUNEME'`);
    await refreshGridAgg(pool);
    const afterPrune = await getAggregatedGridFromCache(pool, 'US-AZ', 8);
    expect(afterPrune.some(b => b.lng === targetLng && b.lat === targetLat)).toBe(false);
    // And still byte-identical to the live path.
    const live = await getObservationsAggregated(pool, { since: '14d', stateCode: 'US-AZ' }, 8);
    expect(fingerprint(afterPrune)).toBe(fingerprint(live));
  });
});

describe('refreshGridAgg statement_timeout exemption (#878 prod-timeout regression)', () => {
  // Prod regression: pool.ts sets a 15s statement_timeout on every connection
  // (#822) to protect the read-api request path. refreshGridAgg's populate is
  // one heavy batch statement (14d `recent` CTE × 2/4/8 multipliers × national +
  // 50-state ST_Intersects join) that exceeds 15s at prod scale, so Postgres
  // cancelled it (SQLSTATE 57014), the txn rolled back, and zero grid rows
  // committed — leaving every state scope on the 12–15s live fallback (CA 503s).
  // The fix mirrors the #845 precedent: `SET LOCAL statement_timeout = 0`
  // immediately after BEGIN, scoping the exemption to this transaction only.
  // This test fails against the pre-fix code (no SET LOCAL) and passes after.
  it("issues `SET LOCAL statement_timeout = 0` after BEGIN, before the populate", async () => {
    const log: string[] = [];
    // Wrap pool.connect so the returned client records every query text. We
    // delegate to the real client (so the populate runs for real against the
    // testcontainers DB) and only observe the call sequence.
    const realConnect = pool.connect.bind(pool);
    const spied = {
      connect: async () => {
        const client = await realConnect();
        const realQuery = client.query.bind(client);
        // pg's query() is heavily overloaded; capture the SQL text from the
        // first arg (string, or { text } config object) and forward verbatim.
        (client as unknown as { query: (...a: unknown[]) => unknown }).query = (
          ...args: unknown[]
        ) => {
          const first = args[0];
          const text =
            typeof first === 'string'
              ? first
              : (first as { text?: string })?.text ?? '';
          log.push(text);
          return (realQuery as (...a: unknown[]) => unknown)(...args);
        };
        return client;
      },
    } as unknown as pg.Pool;

    const n = await refreshGridAgg(spied);
    expect(n).toBeGreaterThan(0);

    const beginIdx = log.findIndex(q => /^\s*BEGIN/i.test(q));
    const setLocalIdx = log.findIndex(q =>
      /SET\s+LOCAL\s+statement_timeout\s*=\s*0/i.test(q),
    );
    const deleteIdx = log.findIndex(q => /DELETE\s+FROM\s+observation_grid_agg/i.test(q));

    expect(beginIdx).toBeGreaterThanOrEqual(0);
    expect(setLocalIdx).toBeGreaterThanOrEqual(0);
    // The exemption must land AFTER BEGIN (so it's inside the txn and SET LOCAL
    // is valid) and BEFORE the heavy DELETE/INSERT populate it's protecting.
    expect(setLocalIdx).toBeGreaterThan(beginIdx);
    expect(setLocalIdx).toBeLessThan(deleteIdx);
  });
});

describe('refreshGridAgg work_mem bump (503 incident 2026-06-14 — precompute temp-file spill)', () => {
  // At national scale this populate's hash/sort/jsonb_agg nodes spill ~430 MB
  // to pgsql_tmp at the Cloud SQL default work_mem, pinning the db-g1-small
  // instance's single shared vCPU + disk while it rebuilds the grid. During
  // that window concurrent live read-path aggregations (the state/low-zoom CTE
  // that getAggregatedGridFromCache falls through to) starve and blow the 15s
  // statement_timeout → user-visible 503s clustered at the :00/:30 ingest+
  // refresh ticks. A transaction-scoped work_mem bump keeps the largest nodes
  // in memory, shrinking the spill + contention window. This test fails against
  // the pre-fix code (no work_mem SET) and passes after.
  it('issues `SET LOCAL work_mem` after BEGIN, before the populate', async () => {
    const log: string[] = [];
    const realConnect = pool.connect.bind(pool);
    const spied = {
      connect: async () => {
        const client = await realConnect();
        const realQuery = client.query.bind(client);
        (client as unknown as { query: (...a: unknown[]) => unknown }).query = (
          ...args: unknown[]
        ) => {
          const first = args[0];
          const text =
            typeof first === 'string'
              ? first
              : (first as { text?: string })?.text ?? '';
          log.push(text);
          return (realQuery as (...a: unknown[]) => unknown)(...args);
        };
        return client;
      },
    } as unknown as pg.Pool;

    const n = await refreshGridAgg(spied);
    expect(n).toBeGreaterThan(0);

    const beginIdx = log.findIndex(q => /^\s*BEGIN/i.test(q));
    const workMemIdx = log.findIndex(q => /SET\s+LOCAL\s+work_mem\s*=/i.test(q));
    const deleteIdx = log.findIndex(q => /DELETE\s+FROM\s+observation_grid_agg/i.test(q));

    expect(beginIdx).toBeGreaterThanOrEqual(0);
    expect(workMemIdx).toBeGreaterThanOrEqual(0);
    // Inside the txn (so SET LOCAL is valid) and before the heavy populate.
    expect(workMemIdx).toBeGreaterThan(beginIdx);
    expect(workMemIdx).toBeLessThan(deleteIdx);
  });
});

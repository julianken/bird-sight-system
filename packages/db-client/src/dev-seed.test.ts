/**
 * Standardized local dev-data seed — integration test.
 *
 * Real Postgres+PostGIS testcontainer (no DB mocks, per repo convention): apply
 * every migration, run the seed, and assert the invariants that make the seeded
 * data render on the local map:
 *   1. observations is non-empty (≈400 rows).
 *   2. observation_grid_agg is non-empty — the default low-zoom map/lede/legend
 *      read the precompute table, so the seed MUST refresh it.
 *   3. every observation's species_code exists in species_meta (#484 invariant),
 *      and every seeded family_code is a real family_silhouettes row (legend join).
 *   4. all obs_dt land inside the 14-day recency window the stack filters on.
 *   5. the seed is deterministic + idempotent: a second run yields the same
 *      observation rows (no duplication, same fingerprint).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';
// Side-effect import: registers pool-wide type parsers (NUMERIC → number).
import './pool.js';
import { seedDevData } from './dev-seed.js';

let container: StartedPostgreSqlContainer;
let pool: pg.Pool;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgis/postgis:16-3.4').start();
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 4 });

  const migrationsDir = resolve(process.cwd(), '../../migrations');
  for (const f of readdirSync(migrationsDir).filter(x => x.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(migrationsDir, f), 'utf-8');
    const [rawUp = ''] = sql.split(/-- Down Migration/i);
    const up = rawUp.replace(/-- Up Migration/i, '');
    if (up.trim()) await pool.query(up);
  }
}, 600_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe('seedDevData — local dev seed', () => {
  it('populates observations, the precompute grid, and reports coverage', async () => {
    const result = await seedDevData(pool);

    expect(result.observationsUpserted).toBeGreaterThanOrEqual(400);
    expect(result.gridRows).toBeGreaterThan(0);
    expect(result.families).toBeGreaterThanOrEqual(20);
    expect(result.states).toBeGreaterThanOrEqual(15);

    const { rows: [obs] } = await pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM observations',
    );
    expect(Number(obs?.n)).toBeGreaterThanOrEqual(400);

    const { rows: [grid] } = await pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM observation_grid_agg',
    );
    expect(Number(grid?.n)).toBeGreaterThan(0);
  });

  it('has no orphan species_code — every observation resolves to species_meta', async () => {
    await seedDevData(pool);
    const { rows: [orphan] } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM observations o
        WHERE NOT EXISTS (
          SELECT 1 FROM species_meta sm WHERE sm.species_code = o.species_code
        )`,
    );
    expect(Number(orphan?.n)).toBe(0);
  });

  it('every seeded family_code is a real family_silhouettes row (legend join holds)', async () => {
    await seedDevData(pool);
    // For every species_meta row backing a seeded observation, its family_code
    // must exist in family_silhouettes — otherwise the legend + silhouette
    // stamping would break for that family.
    const { rows: [missing] } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM (
           SELECT DISTINCT sm.family_code
             FROM species_meta sm
             JOIN observations o ON o.species_code = sm.species_code
         ) used
        WHERE NOT EXISTS (
          SELECT 1 FROM family_silhouettes fs WHERE fs.family_code = used.family_code
        )`,
    );
    expect(Number(missing?.n)).toBe(0);

    // And every seeded observation got a silhouette stamped (the upsert stamp
    // joins species_meta → family_silhouettes), proving the chain resolves.
    const { rows: [unstamped] } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM observations WHERE silhouette_id IS NULL`,
    );
    expect(Number(unstamped?.n)).toBe(0);
  });

  it('all seeded observations fall inside the 14-day recency window', async () => {
    await seedDevData(pool);
    const { rows: [stale] } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM observations
        WHERE obs_dt < now() - interval '14 days' OR obs_dt > now()`,
    );
    expect(Number(stale?.n)).toBe(0);
  });

  it('is deterministic + idempotent — a second run does not duplicate or change rows', async () => {
    // Pin nowMs so obs_dt is identical across both runs (the only now()-derived
    // value); everything else is fixed-PRNG driven.
    const pinnedNow = Date.UTC(2026, 5, 9, 12, 0, 0);
    await seedDevData(pool, pinnedNow);
    const { rows: [first] } = await pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM observations',
    );
    const fingerprintQ = `SELECT md5(string_agg(
        sub_id||species_code||lat::text||lng::text||obs_dt::text||coalesce(how_many::text,'')||is_notable::text,
        '' ORDER BY sub_id, species_code)) AS h FROM observations`;
    const { rows: [fpA] } = await pool.query<{ h: string }>(fingerprintQ);

    await seedDevData(pool, pinnedNow);
    const { rows: [second] } = await pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM observations',
    );
    const { rows: [fpB] } = await pool.query<{ h: string }>(fingerprintQ);

    expect(second?.n).toBe(first?.n);
    expect(fpB?.h).toBe(fpA?.h);
  });
});

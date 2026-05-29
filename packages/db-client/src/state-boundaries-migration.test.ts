/**
 * Integration test for migration 1700000050000 — state_boundaries table (Task
 * A2, #728).
 *
 * Locks the canonical CONUS state-polygon substrate the rest of the state-scope
 * epic rides on: the data clip (`ST_Intersects` in observations.ts), the
 * ZIP→state point-in-polygon precompute, and the camera bounding envelope.
 *
 * Schema + seed invariants exercised here:
 *   - Exactly 49 rows (48 contiguous states + DC; no AK/HI/territories).
 *   - Every geom is a valid (`ST_IsValid`) MultiPolygon in SRID 4326.
 *   - The GIST index `state_boundaries_geom_idx` exists.
 *   - The precomputed bbox columns bracket the geometry's true envelope
 *     (min < max on both axes; bbox ≈ ST_Envelope) so listStatesWithBbox can
 *     read them directly instead of recomputing ST_Envelope at query time.
 *   - Down drops the table; re-applying Up restores all 49 rows cleanly.
 *
 * No DB mocks — runs against a real PostGIS testcontainer per the project-wide
 * rule (CLAUDE.md "No DB mocks in tests").
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';
// Side-effect import: registers pool-wide type parsers before any query.
import './pool.js';

let container: StartedPostgreSqlContainer;
let pool: pg.Pool;

const MIGRATION_FILE = '1700000050000_state_boundaries.sql';
const EXPECTED_COUNT = 49;

function parseMigration(filePath: string): { up: string; down: string } {
  const sql = readFileSync(filePath, 'utf-8');
  const [rawUpPart = '', rawDownPart = ''] = sql.split(/-- Down Migration/i);
  return {
    up: rawUpPart.replace(/-- Up Migration/i, '').trim(),
    down: rawDownPart.trim(),
  };
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgis/postgis:16-3.4').start();
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 4 });

  // Apply all Up migrations in numeric order. startTestDb does the same.
  const migrationsDir = resolve(process.cwd(), '../../migrations');
  const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const { up } = parseMigration(join(migrationsDir, f));
    if (up) {
      await pool.query(up);
    }
  }
}, 180_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe('migration 1700000050000_state_boundaries — Up', () => {
  it('seeds exactly 49 rows (48 contiguous states + DC)', async () => {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM state_boundaries`
    );
    expect(Number(rows[0]!.count)).toBe(EXPECTED_COUNT);
  });

  it('excludes AK/HI/territories and includes DC', async () => {
    const { rows } = await pool.query<{ state_code: string }>(
      `SELECT state_code FROM state_boundaries
        WHERE state_code IN ('US-AK','US-HI','US-PR','US-GU','US-VI','US-AS','US-MP')`
    );
    expect(rows).toHaveLength(0);

    const { rows: dc } = await pool.query<{ name: string }>(
      `SELECT name FROM state_boundaries WHERE state_code = 'US-DC'`
    );
    expect(dc).toHaveLength(1);
    expect(dc[0]!.name).toBe('District of Columbia');
  });

  it('every geometry is valid', async () => {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM state_boundaries WHERE NOT ST_IsValid(geom)`
    );
    expect(Number(rows[0]!.count)).toBe(0);
  });

  it('every geometry is a MULTIPOLYGON in SRID 4326', async () => {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM state_boundaries
        WHERE GeometryType(geom) <> 'MULTIPOLYGON' OR ST_SRID(geom) <> 4326`
    );
    expect(Number(rows[0]!.count)).toBe(0);
  });

  it('the GIST index on geom exists', async () => {
    const { rows } = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'state_boundaries'
          AND indexname = 'state_boundaries_geom_idx'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.indexdef).toMatch(/USING gist/i);
  });

  it('precomputed bbox columns are well-ordered (min < max on both axes)', async () => {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM state_boundaries
        WHERE NOT (min_lng < max_lng AND min_lat < max_lat)`
    );
    expect(Number(rows[0]!.count)).toBe(0);
  });

  it('precomputed bbox columns bracket the geometry envelope', async () => {
    // The seed rounds coordinates to 5 decimals; ST_Envelope on the stored
    // geom must therefore fall within (or on) the stored bbox, with a tiny
    // tolerance for rounding at the boundary.
    const eps = 1e-4;
    const { rows } = await pool.query<{
      state_code: string;
      min_lng: number;
      min_lat: number;
      max_lng: number;
      max_lat: number;
      env_min_lng: number;
      env_min_lat: number;
      env_max_lng: number;
      env_max_lat: number;
    }>(
      `SELECT state_code, min_lng, min_lat, max_lng, max_lat,
              ST_XMin(geom) AS env_min_lng, ST_YMin(geom) AS env_min_lat,
              ST_XMax(geom) AS env_max_lng, ST_YMax(geom) AS env_max_lat
         FROM state_boundaries`
    );
    expect(rows).toHaveLength(EXPECTED_COUNT);
    for (const r of rows) {
      expect(r.min_lng).toBeLessThanOrEqual(r.env_min_lng + eps);
      expect(r.min_lat).toBeLessThanOrEqual(r.env_min_lat + eps);
      expect(r.max_lng).toBeGreaterThanOrEqual(r.env_max_lng - eps);
      expect(r.max_lat).toBeGreaterThanOrEqual(r.env_max_lat - eps);
      // bbox should be a tight envelope, not a wildly inflated one.
      expect(Math.abs(r.min_lng - r.env_min_lng)).toBeLessThan(0.01);
      expect(Math.abs(r.max_lat - r.env_max_lat)).toBeLessThan(0.01);
    }
  });

  it('Arizona resolves a Tucson point and rejects a Pacific point (ST_Intersects sanity)', async () => {
    // Tucson (-110.97, 32.22) intersects AZ; a Pacific point intersects nothing.
    const { rows: az } = await pool.query<{ state_code: string }>(
      `SELECT state_code FROM state_boundaries
        WHERE ST_Intersects(geom, ST_SetSRID(ST_MakePoint(-110.97, 32.22), 4326))`
    );
    expect(az.map(r => r.state_code)).toContain('US-AZ');

    const { rows: ocean } = await pool.query<{ state_code: string }>(
      `SELECT state_code FROM state_boundaries
        WHERE ST_Intersects(geom, ST_SetSRID(ST_MakePoint(-160, 40), 4326))`
    );
    expect(ocean).toHaveLength(0);
  });
});

describe('migration 1700000050000_state_boundaries — Down/Up round-trip', () => {
  it('Down drops the table; re-applying Up restores all 49 rows', async () => {
    const migrationsDir = resolve(process.cwd(), '../../migrations');
    const { up, down } = parseMigration(join(migrationsDir, MIGRATION_FILE));

    await pool.query(down);
    const { rows: gone } = await pool.query<{ reg: string | null }>(
      `SELECT to_regclass('state_boundaries') AS reg`
    );
    expect(gone[0]!.reg).toBeNull();

    await pool.query(up);
    const { rows: back } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM state_boundaries`
    );
    expect(Number(back[0]!.count)).toBe(EXPECTED_COUNT);
  });
});

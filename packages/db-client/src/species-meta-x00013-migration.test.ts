/**
 * Integration test for migration 1700000038000 —
 * backfill species_meta row for eBird hybrid code `x00013`
 * ("Bullock's x Baltimore Oriole").
 *
 * Issue #527 (PR-1 of 3). The `recent` ingest cron has been exiting non-zero
 * every 30 min for ~40 hours because the #484 invariant
 * (services/ingestor/src/run-ingest.ts:54-63) correctly refuses to insert
 * observations for a species_code with no species_meta parent. This
 * migration ships the single missing row.
 *
 * Schema invariants exercised here:
 *   - The Up migration inserts exactly one row with the documented values.
 *   - `family_code = 'icteridae'` JOINs cleanly to `family_silhouettes`
 *     (the silhouette exists from migration 1700000033000), so the read-api
 *     `silhouette_id` resolution works for x00013 observations.
 *   - The Down migration removes only the x00013 row, leaving other
 *     species_meta rows (including those inserted by migration 1700000032000)
 *     intact.
 *
 * No DB mocks — runs against a real PostGIS testcontainer per the
 * project-wide rule (CLAUDE.md "No DB mocks in tests").
 *
 * Test pattern mirrors species-photos-migration.test.ts: a one-off container
 * with all migrations applied in beforeAll, no TRUNCATE in beforeEach (so the
 * seeded row survives for the assertions).
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

const MIGRATION_FILE = '1700000038000_backfill_species_meta_x00013.sql';

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

  // Apply all Up migrations in numeric order. Same logic as startTestDb.
  const migrationsDir = resolve(process.cwd(), '../../migrations');
  const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const { up } = parseMigration(join(migrationsDir, f));
    if (up) {
      await pool.query(up);
    }
  }
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe('migration 1700000038000_backfill_species_meta_x00013 — Up', () => {
  it('inserts the x00013 row with the documented values', async () => {
    const { rows } = await pool.query<{
      species_code: string;
      com_name: string;
      sci_name: string;
      family_code: string;
      family_name: string;
      taxon_order: number | null;
    }>(
      `SELECT species_code, com_name, sci_name, family_code, family_name, taxon_order
         FROM species_meta WHERE species_code = 'x00013'`
    );
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.com_name).toBe("Bullock's x Baltimore Oriole (hybrid)");
    expect(row.sci_name).toBe('Icterus bullockii x galbula');
    expect(row.family_code).toBe('icteridae');
    expect(row.family_name).toBe('Troupials and Allies');
    // pool.ts registers the NUMERIC → number parser, so taxon_order is a
    // number not a string (same contract as species.test.ts line 44).
    expect(typeof row.taxon_order).toBe('number');
    expect(row.taxon_order).toBe(33771);
  });

  it('JOINs cleanly to family_silhouettes via family_code', async () => {
    // The whole point of choosing family_code='icteridae' is that
    // migration 1700000033000 already seeded that row in family_silhouettes,
    // so the read-api silhouette resolution returns a real icon (not
    // _FALLBACK) for x00013 observations.
    const { rows } = await pool.query<{
      species_code: string;
      family_code: string;
      silhouette_id: string;
      color: string;
    }>(
      `SELECT sm.species_code, sm.family_code, fs.id AS silhouette_id, fs.color
         FROM species_meta sm
         JOIN family_silhouettes fs ON fs.family_code = sm.family_code
        WHERE sm.species_code = 'x00013'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.silhouette_id).toBe('icteridae');
    // #F4B400 is the icteridae color set by migration 1700000033000.
    expect(rows[0]?.color).toBe('#F4B400');
  });

  it('is idempotent — re-running Up does not duplicate the row', async () => {
    const migrationsDir = resolve(process.cwd(), '../../migrations');
    const { up } = parseMigration(join(migrationsDir, MIGRATION_FILE));
    // Re-apply Up; the ON CONFLICT (species_code) DO NOTHING clause should
    // make this a no-op rather than a unique-violation throw.
    await pool.query(up);
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM species_meta WHERE species_code = 'x00013'`
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });
});

describe('migration 1700000038000_backfill_species_meta_x00013 — Down', () => {
  it('removes only the x00013 row, leaving migration-32000 rows intact', async () => {
    // Snapshot one row that migration 1700000032000 inserted, so we can prove
    // Down(38000) doesn't fall back to a sci_name LIKE '% x %' delete.
    const before = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM species_meta WHERE species_code = 'ixlbun'`
    );
    expect(Number(before.rows[0]?.count)).toBe(1);

    const migrationsDir = resolve(process.cwd(), '../../migrations');
    const { down } = parseMigration(join(migrationsDir, MIGRATION_FILE));
    expect(down).toBeTruthy();
    await pool.query(down);

    const x00013 = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM species_meta WHERE species_code = 'x00013'`
    );
    expect(Number(x00013.rows[0]?.count)).toBe(0);

    const ixlbun = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM species_meta WHERE species_code = 'ixlbun'`
    );
    expect(Number(ixlbun.rows[0]?.count)).toBe(1);

    // Re-apply Up so the file's test order doesn't leave a partial state if
    // other test files in the same vitest run share the container (they
    // don't — each *-migration.test.ts spins its own — but defensive).
    const { up } = parseMigration(join(migrationsDir, MIGRATION_FILE));
    await pool.query(up);
  });
});

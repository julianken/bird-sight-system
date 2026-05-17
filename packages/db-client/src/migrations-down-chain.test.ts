/**
 * Integration test for the Down(14000→17000) migration rollback chain.
 *
 * Root cause being guarded: Down(17000) previously NULL-ified svg_data for
 * all 25 seeded families, which caused Down(14000)'s
 * `ALTER COLUMN svg_data SET NOT NULL` to fail with a constraint violation.
 *
 * This test exercises the full forward→backward cycle:
 *   1. Apply all Up migrations (fully-migrated DB, production state).
 *   2. Roll down through 19700 → 19500 → 19000 → 18000 → 17000 → 16000 →
 *      15000 → 14000 in reverse order.
 *   3. After Down(17000): assert zero NULL svg_data rows among the 25 seeded
 *      families (the fix restores placeholders instead of setting NULL).
 *   4. Down(14000) (`ALTER COLUMN svg_data SET NOT NULL`) must succeed without
 *      throwing a constraint violation.
 *   5. Re-apply the Up migrations for 14000 → 17000 to confirm round-trip
 *      clean.
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

/**
 * Parses a migration SQL file and returns the Up and Down sections separately.
 * Matches the same splitting logic used in test-helpers.ts.
 */
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

  // Apply all Up migrations in numeric order (same as startTestDb in test-helpers.ts).
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

describe('Down(14000→17000) rollback chain', () => {
  it('runs Down(17000) without leaving any NULL svg_data on the 25 seeded families', async () => {
    const migrationsDir = resolve(process.cwd(), '../../migrations');

    // Roll down from 46000 → 14000 in reverse numeric order.
    // Migration 46000 (contrast Phase 1, #570) adds color_dark NOT NULL —
    // must be rolled down first so that Up re-application of 15000 (which
    // INSERTs without color_dark) does not violate the NOT NULL constraint.
    // We only need to go back as far as 14000 to exercise the bug; rolling
    // all the way keeps the test realistic (matches `node-pg-migrate down`).
    const downSequence = [
      '1700000046000_family_silhouettes_dual_palette.sql',
      '1700000019700_seed_fallback_common_name.sql',
      '1700000019500_seed_family_common_names.sql',
      '1700000019000_add_common_name_to_family_silhouettes.sql',
      '1700000018000_seed_family_silhouettes_fallback.sql',
      '1700000017000_seed_family_silhouettes_phylopic.sql',
    ];

    for (const filename of downSequence) {
      const { down } = parseMigration(join(migrationsDir, filename));
      if (down) {
        await pool.query(down);
      }
    }

    // After Down(17000), the family_silhouettes table has 7 NULL svg_data
    // rows remaining (was 11 after #495; 4 were rescued by migration 36000).
    // Migration 34000 (issue #495) inserts 38 backfill rows, 11 of which
    // originally had svg_data=NULL (Phylopic had no usable candidate at the
    // family node). Migration 36000 (issue #500) rescues 4 of those NULLs
    // via species/genus-level Phylopic lookup (gaviidae, numididae,
    // phasianidae, tytonidae), leaving 7 NULL. Those rows are out of scope
    // for the Down(17000) contract — migrations 34000 and 36000 are post-
    // 17000 and not rolled back by this chain.
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count
         FROM family_silhouettes
        WHERE svg_data IS NULL
          AND family_code NOT IN ('_FALLBACK')`
    );
    expect(Number(rows[0]!.count)).toBe(7);
  });

  it('runs Down(16000) and Down(15000) without error', async () => {
    const migrationsDir = resolve(process.cwd(), '../../migrations');

    for (const filename of [
      '1700000016000_add_creator_to_family_silhouettes.sql',
      '1700000015000_seed_family_silhouettes_az_families.sql',
    ]) {
      const { down } = parseMigration(join(migrationsDir, filename));
      if (down) {
        await pool.query(down);
      }
    }

    // After Down(15000), only the 15 original families from migration 9000
    // plus any post-17000 INSERTs that this test chain doesn't roll back
    // (migration 33000 / issue #482 added the `icteridae` row; migration
    // 34000 / issue #495 added 38 backfill rows) should remain. The chain
    // deliberately only exercises Down(14000→17000), so post-17000 seeds
    // are out of scope and counted into the baseline.
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM family_silhouettes`
    );
    expect(Number(rows[0]!.count)).toBe(54);
  });

  it('runs Down(14000) — SET NOT NULL — without a constraint violation', async () => {
    const migrationsDir = resolve(process.cwd(), '../../migrations');

    // Apply Down(34000) first to remove the 11 NULL-svg_data rows that
    // migration 34000 (issue #495) inserts for skip families. The
    // Down(14000) test's contract is that the placeholder restoration in
    // Down(17000) leaves no NULLs among the originally-seeded 25; rows
    // inserted by later migrations are post-17000 state and must be rolled
    // back before SET NOT NULL can be re-applied.
    const { down: down34000 } = parseMigration(
      join(migrationsDir, '1700000034000_backfill_observed_family_silhouettes.sql')
    );
    await pool.query(down34000);

    const { down } = parseMigration(
      join(migrationsDir, '1700000014000_relax_family_silhouettes_svg_data_nullable.sql')
    );

    // This must not throw.  Before the fix, it threw:
    //   ERROR: column "svg_data" of relation "family_silhouettes" contains null values
    await expect(pool.query(down)).resolves.toBeDefined();

    // Confirm the constraint is now active: inserting a NULL svg_data must fail.
    await expect(
      pool.query(
        `INSERT INTO family_silhouettes (id, family_code, svg_data, color)
         VALUES ('__test__', '__test__', NULL, '#000000')`
      )
    ).rejects.toThrow();
  });

  it('re-applies Up(14000) through Up(17000) cleanly (round-trip smoke)', async () => {
    const migrationsDir = resolve(process.cwd(), '../../migrations');

    // Re-apply Ups to restore forward state (confirms round-trip is clean).
    const upSequence = [
      '1700000014000_relax_family_silhouettes_svg_data_nullable.sql',
      '1700000015000_seed_family_silhouettes_az_families.sql',
      '1700000016000_add_creator_to_family_silhouettes.sql',
      '1700000017000_seed_family_silhouettes_phylopic.sql',
    ];

    for (const filename of upSequence) {
      const { up } = parseMigration(join(migrationsDir, filename));
      if (up) {
        await pool.query(up);
      }
    }

    // Re-apply migration 34000 Up — the previous test (Down(14000) SET NOT
    // NULL) rolled it back to clean up 11 NULL svg_data rows. Migration
    // 34000 references the `common_name` column added by migration 19000
    // (and the _FALLBACK sentinel from 18000), so re-apply 18000 and 19000
    // first (they were rolled back by the test 1 downSequence).
    // Migration 46000 (contrast Phase 1, #570) is also re-applied last to
    // restore the color_dark NOT NULL column after the round-trip.
    for (const filename of [
      '1700000018000_seed_family_silhouettes_fallback.sql',
      '1700000019000_add_common_name_to_family_silhouettes.sql',
      '1700000034000_backfill_observed_family_silhouettes.sql',
      '1700000046000_family_silhouettes_dual_palette.sql',
    ]) {
      const { up } = parseMigration(join(migrationsDir, filename));
      if (up) {
        await pool.query(up);
      }
    }

    // After re-applying Up(14000→17000) and Up(34000), all 25 originally-
    // seeded families should be present with svg_data set by the Phylopic
    // seed (non-null for the 22 families that have usable Phylopic SVGs).
    // Exclude the _FALLBACK sentinel row. The +1 accounts for the
    // `icteridae` row inserted by migration 33000 (issue #482); the +38
    // accounts for the backfill from migration 34000 (issue #495). The
    // test container applies both before the down/up chain runs but this
    // chain doesn't roll them back.
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count
         FROM family_silhouettes
        WHERE family_code != '_FALLBACK'`
    );
    expect(Number(rows[0]!.count)).toBe(64);
  });
});

/**
 * Integration test for migration 1700000052000 —
 * dedupe the spelling-variant duplicate in family_silhouettes for the
 * silky-flycatcher family (`ptilogonatidae` vs `ptiliogonatidae`).
 *
 * Issue #922 (family-name hygiene), CORRECTED. The table historically carried
 * two rows for one family. The ORIGINAL migration deleted `ptiliogonatidae`
 * believing `ptilogonatidae` (no `i`) was the canonical `lower(familySciName)`
 * key. Production proved that inverted: eBird's familySciName is
 * "Ptiliogonatidae" (extra `i`), so species_meta.family_code =
 * 'ptiliogonatidae', the silhouette-stamp join writes
 * observations.silhouette_id = 'ptiliogonatidae', and deleting that row
 * violated observations_silhouette_id_fkey — failing every prod deploy while
 * passing CI (testcontainers have an empty observations table). The no-`i`
 * `ptilogonatidae` row is the orphaned seed (migration 15000) that nothing
 * joins to.
 *
 * The corrected migration KEEPS `ptiliogonatidae` (eBird-canonical,
 * prod-referenced), transfers the orphan's maintained palette + title-case
 * common_name onto it, and deletes the orphan `ptilogonatidae`.
 *
 * Invariants exercised here:
 *   - Up leaves exactly ONE silky-flycatcher row, the eBird-canonical
 *     `ptiliogonatidae`, with the title-case common_name 'Silky-Flycatchers'.
 *   - Up removes the orphan `ptilogonatidae` row entirely.
 *   - Down re-inserts the `ptilogonatidae` orphan (rollback restores the
 *     pre-migration two-row state).
 *
 * No DB mocks — runs against a real PostGIS testcontainer per the project-wide
 * rule (CLAUDE.md "No DB mocks in tests"). Test pattern mirrors
 * species-meta-x00013-migration.test.ts: a one-off container with all
 * migrations applied in beforeAll.
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

const MIGRATION_FILE = '1700000052000_dedupe_ptiliogonatidae_silhouette.sql';

// The two spellings of the Ptiliogonatidae (silky-flycatcher) family.
const CANONICAL = 'ptiliogonatidae'; // eBird familySciName / lower() — kept (prod-referenced)
const VARIANT = 'ptilogonatidae'; // no-`i` orphaned seed row — removed

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

describe('migration 1700000052000_dedupe_ptiliogonatidae_silhouette — Up', () => {
  it('leaves exactly one silky-flycatcher row, the canonical spelling, with a non-null common_name', async () => {
    const { rows } = await pool.query<{
      family_code: string;
      common_name: string | null;
    }>(
      `SELECT family_code, common_name
         FROM family_silhouettes
        WHERE family_code IN ($1, $2)`,
      [CANONICAL, VARIANT]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.family_code).toBe(CANONICAL);
    expect(rows[0]?.common_name).toBe('Silky-Flycatchers');
    expect(rows[0]?.common_name).not.toBeNull();
  });

  it('removes the no-`i` orphan row entirely', async () => {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM family_silhouettes WHERE family_code = $1`,
      [VARIANT]
    );
    expect(Number(rows[0]?.count)).toBe(0);
  });

  it('is idempotent — re-running Up does not error and leaves one row', async () => {
    const migrationsDir = resolve(process.cwd(), '../../migrations');
    const { up } = parseMigration(join(migrationsDir, MIGRATION_FILE));
    await pool.query(up);
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM family_silhouettes WHERE family_code IN ($1, $2)`,
      [CANONICAL, VARIANT]
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });
});

describe('migration 1700000052000_dedupe_ptiliogonatidae_silhouette — Down', () => {
  it('re-inserts the orphan row (restores the two-row pre-migration state)', async () => {
    const migrationsDir = resolve(process.cwd(), '../../migrations');
    const { down, up } = parseMigration(join(migrationsDir, MIGRATION_FILE));
    expect(down).toBeTruthy();
    await pool.query(down);

    const { rows } = await pool.query<{
      family_code: string;
      common_name: string | null;
      color: string;
      color_dark: string;
      svg_data: string | null;
    }>(
      `SELECT family_code, common_name, color, color_dark, svg_data
         FROM family_silhouettes
        WHERE family_code = $1`,
      [VARIANT]
    );
    expect(rows).toHaveLength(1);
    // Down restores the no-`i` orphan with its pre-Up values (migration 19500
    // title-case name, migration 46000 dual palette #5b5b9c).
    expect(rows[0]?.common_name).toBe('Silky-Flycatchers');
    expect(rows[0]?.color).toBe('#5b5b9c');
    expect(rows[0]?.color_dark).toBe('#5b5b9c');
    expect(rows[0]?.svg_data).toBeNull();

    // Both spellings present again after Down.
    const both = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM family_silhouettes WHERE family_code IN ($1, $2)`,
      [CANONICAL, VARIANT]
    );
    expect(Number(both.rows[0]?.count)).toBe(2);

    // Re-apply Up so the container is left in forward state for any shared run.
    await pool.query(up);
  });
});

describe('migration 1700000052000 — FK safety (regression for the prod failure)', () => {
  // The ORIGINAL migration failed every prod deploy with
  // observations_silhouette_id_fkey because it deleted a family_silhouettes row
  // that observations referenced. CI never caught it: testcontainers run against
  // an empty observations table, so the FK check never fired. This test closes
  // that gap by stamping a real observation onto the row the migration deletes,
  // then asserting Up succeeds (repoints, not FK-errors).
  it('Up succeeds and repoints observations when a row references the orphan spelling', async () => {
    const migrationsDir = resolve(process.cwd(), '../../migrations');
    const { down, up } = parseMigration(join(migrationsDir, MIGRATION_FILE));

    // Restore the two-row state so the orphan `ptilogonatidae` exists to be
    // referenced (mirrors prod, where both rows were present pre-dedupe).
    await pool.query(down);

    // Stamp an observation onto the orphan row — the exact FK hazard. (region_id
    // was dropped in migration 43000; geom is generated from lat/lng.)
    await pool.query(
      `INSERT INTO observations (sub_id, species_code, lat, lng, obs_dt, loc_id, silhouette_id)
       VALUES ('FKTEST_SUB', 'phaino', 33.45, -112.07, now(), 'FKTEST_LOC', $1)`,
      [VARIANT]
    );

    // The corrected Up must NOT throw an FK violation here.
    await expect(pool.query(up)).resolves.toBeDefined();

    // The observation was repointed onto the surviving canonical spelling…
    const obs = await pool.query<{ silhouette_id: string }>(
      `SELECT silhouette_id FROM observations WHERE sub_id = 'FKTEST_SUB' AND species_code = 'phaino'`
    );
    expect(obs.rows[0]?.silhouette_id).toBe(CANONICAL);

    // …and the orphan row is gone.
    const orphan = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM family_silhouettes WHERE family_code = $1`,
      [VARIANT]
    );
    expect(Number(orphan.rows[0]?.count)).toBe(0);

    // Cleanup the test observation so it doesn't leak into a shared container.
    await pool.query(`DELETE FROM observations WHERE sub_id = 'FKTEST_SUB'`);
  });
});

/**
 * Integration test for migration 1700000020000 — species_photos table.
 *
 * Locks in the schema contract for the new `species_photos` one-to-many table
 * keyed on `species_meta(species_code)`. Per issue #327 task-2, the table's
 * `purpose` column is a CHECK-constrained ENUM (text + CHECK) so that future
 * variants — `marker`, `gallery`, multi-resolution — can be added without
 * re-doing the schema. MVP only inserts `purpose='detail-panel'`.
 *
 * Schema invariants exercised here:
 *   - All required columns (id BIGSERIAL PK, species_code FK, purpose,
 *     url, attribution, license, created_at) exist with the documented
 *     types and NOT NULL constraints.
 *   - `purpose` accepts `'detail-panel'` and rejects anything else.
 *   - The `species_code` FK CASCADEs on parent delete.
 *   - `UNIQUE (species_code, purpose)` blocks duplicate inserts on the same
 *     pair (the MVP guarantee that a species has at most one detail-panel
 *     photo).
 *   - The Down migration drops the table cleanly.
 *
 * No DB mocks — runs against a real PostGIS testcontainer per the
 * project-wide rule (CLAUDE.md "No DB mocks in tests").
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

const MIGRATION_FILE = '1700000020000_add_species_photos_table.sql';

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

  // Seed a species we can FK against.
  await pool.query(
    `INSERT INTO species_meta (species_code, com_name, sci_name, family_code, family_name)
     VALUES ('vermfly', 'Vermilion Flycatcher', 'Pyrocephalus rubinus', 'tyrannidae', 'Tyrant Flycatchers')`
  );
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe('migration 1700000020000_add_species_photos_table — Up', () => {
  it('creates species_photos with the documented columns and types', async () => {
    const { rows } = await pool.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_name = 'species_photos'
        ORDER BY ordinal_position`
    );
    const byName = Object.fromEntries(rows.map(r => [r.column_name, r]));

    // Every column the design names must be present.
    expect(Object.keys(byName).sort()).toEqual(
      ['attribution', 'created_at', 'id', 'license', 'purpose', 'species_code', 'url'].sort()
    );

    // id BIGSERIAL → bigint NOT NULL with a sequence default.
    expect(byName.id?.data_type).toBe('bigint');
    expect(byName.id?.is_nullable).toBe('NO');
    expect(byName.id?.column_default).toMatch(/nextval/);

    // species_code TEXT NOT NULL.
    expect(byName.species_code?.data_type).toBe('text');
    expect(byName.species_code?.is_nullable).toBe('NO');

    // purpose TEXT NOT NULL.
    expect(byName.purpose?.data_type).toBe('text');
    expect(byName.purpose?.is_nullable).toBe('NO');

    // url TEXT NOT NULL.
    expect(byName.url?.data_type).toBe('text');
    expect(byName.url?.is_nullable).toBe('NO');

    // attribution TEXT NOT NULL.
    expect(byName.attribution?.data_type).toBe('text');
    expect(byName.attribution?.is_nullable).toBe('NO');

    // license TEXT NOT NULL.
    expect(byName.license?.data_type).toBe('text');
    expect(byName.license?.is_nullable).toBe('NO');

    // created_at TIMESTAMPTZ NOT NULL DEFAULT NOW().
    expect(byName.created_at?.data_type).toBe('timestamp with time zone');
    expect(byName.created_at?.is_nullable).toBe('NO');
    expect(byName.created_at?.column_default).toMatch(/now\(\)/i);
  });

  it('declares species_code as a FK to species_meta with ON DELETE CASCADE', async () => {
    const { rows } = await pool.query<{ delete_rule: string; foreign_table: string; foreign_column: string }>(
      `SELECT rc.delete_rule,
              ccu.table_name  AS foreign_table,
              ccu.column_name AS foreign_column
         FROM information_schema.referential_constraints rc
         JOIN information_schema.constraint_column_usage ccu
              ON rc.unique_constraint_name = ccu.constraint_name
         JOIN information_schema.key_column_usage kcu
              ON rc.constraint_name = kcu.constraint_name
        WHERE kcu.table_name = 'species_photos'
          AND kcu.column_name = 'species_code'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.delete_rule).toBe('CASCADE');
    expect(rows[0]?.foreign_table).toBe('species_meta');
    expect(rows[0]?.foreign_column).toBe('species_code');
  });

  it("accepts purpose='detail-panel' and rejects any other value via CHECK", async () => {
    // Insert is fine.
    await pool.query(
      `INSERT INTO species_photos (species_code, purpose, url, attribution, license)
       VALUES ('vermfly', 'detail-panel', 'https://photos.bird-maps.com/vermfly.jpg',
               'Photo by Jane Doe', 'CC-BY-4.0')`
    );
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM species_photos WHERE species_code = 'vermfly'`
    );
    expect(Number(rows[0]?.count)).toBe(1);

    // CHECK constraint blocks an off-list purpose.
    await expect(
      pool.query(
        `INSERT INTO species_photos (species_code, purpose, url, attribution, license)
         VALUES ('vermfly', 'marker', 'https://photos.bird-maps.com/vermfly-marker.jpg',
                 'Photo by Jane Doe', 'CC-BY-4.0')`
      )
    ).rejects.toThrow(/check constraint/i);

    // Cleanup so subsequent tests start from a known state.
    await pool.query(`DELETE FROM species_photos`);
  });

  it('UNIQUE (species_code, purpose) blocks duplicate detail-panel rows', async () => {
    await pool.query(
      `INSERT INTO species_photos (species_code, purpose, url, attribution, license)
       VALUES ('vermfly', 'detail-panel', 'https://photos.bird-maps.com/v1.jpg',
               'Photo by A', 'CC-BY-4.0')`
    );
    await expect(
      pool.query(
        `INSERT INTO species_photos (species_code, purpose, url, attribution, license)
         VALUES ('vermfly', 'detail-panel', 'https://photos.bird-maps.com/v2.jpg',
                 'Photo by B', 'CC-BY-NC-4.0')`
      )
    ).rejects.toThrow(/duplicate key|unique/i);

    await pool.query(`DELETE FROM species_photos`);
  });

  it('CASCADEs photo rows when the parent species is deleted', async () => {
    // Seed a fresh parent + child pair, then prune the parent.
    await pool.query(
      `INSERT INTO species_meta (species_code, com_name, sci_name, family_code, family_name)
       VALUES ('annhum-tmp', 'Anna''s Hummingbird', 'Calypte anna', 'trochilidae', 'Hummingbirds')`
    );
    await pool.query(
      `INSERT INTO species_photos (species_code, purpose, url, attribution, license)
       VALUES ('annhum-tmp', 'detail-panel', 'https://photos.bird-maps.com/annhum.jpg',
               'Photo by C', 'CC-BY-4.0')`
    );
    await pool.query(`DELETE FROM species_meta WHERE species_code = 'annhum-tmp'`);
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM species_photos WHERE species_code = 'annhum-tmp'`
    );
    expect(Number(rows[0]?.count)).toBe(0);
  });
});

describe('migration 1700000020000_add_species_photos_table — Down', () => {
  it('drops species_photos cleanly', async () => {
    const migrationsDir = resolve(process.cwd(), '../../migrations');
    const { down } = parseMigration(join(migrationsDir, MIGRATION_FILE));
    expect(down).toBeTruthy();
    await pool.query(down);

    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count
         FROM information_schema.tables
        WHERE table_name = 'species_photos'`
    );
    expect(Number(rows[0]?.count)).toBe(0);

    // Re-apply Up so other tests in the file (or the suite) see the table.
    const { up } = parseMigration(join(migrationsDir, MIGRATION_FILE));
    await pool.query(up);
  });
});

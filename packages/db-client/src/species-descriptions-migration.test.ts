/**
 * Integration test for migration 1700000030000 — species_descriptions table
 * + species_meta.inat_taxon_id column.
 *
 * Locks in the schema contract for the new descriptions cache. Mirrors the
 * shape of species-photos-migration.test.ts; columns / FK / CHECK / UNIQUE /
 * CASCADE invariants are verified against a fully-migrated PostGIS testcontainer.
 *
 * No DB mocks per CLAUDE.md "No DB mocks in tests".
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

const MIGRATION_FILE = '1700000030000_add_species_descriptions.sql';

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

  const migrationsDir = resolve(process.cwd(), '../../migrations');
  const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const { up } = parseMigration(join(migrationsDir, f));
    if (up) {
      await pool.query(up);
    }
  }

  // Seed a parent species for the FK.
  await pool.query(
    `INSERT INTO species_meta (species_code, com_name, sci_name, family_code, family_name)
     VALUES ('vermfly', 'Vermilion Flycatcher', 'Pyrocephalus rubinus', 'tyrannidae', 'Tyrant Flycatchers')`
  );
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe('migration 1700000030000_add_species_descriptions — Up', () => {
  it('adds species_meta.inat_taxon_id column (BIGINT, nullable)', async () => {
    const { rows } = await pool.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_name = 'species_meta' AND column_name = 'inat_taxon_id'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.data_type).toBe('bigint');
    expect(rows[0]?.is_nullable).toBe('YES');
  });

  it('creates species_descriptions with the documented columns and types', async () => {
    const { rows } = await pool.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_name = 'species_descriptions'
        ORDER BY ordinal_position`
    );
    const byName = Object.fromEntries(rows.map(r => [r.column_name, r]));

    expect(Object.keys(byName).sort()).toEqual(
      [
        'attribution_url', 'body', 'etag', 'fetched_at', 'id', 'license',
        'revision_id', 'source', 'species_code',
      ].sort()
    );

    // id BIGSERIAL → bigint NOT NULL with a sequence default.
    expect(byName.id?.data_type).toBe('bigint');
    expect(byName.id?.is_nullable).toBe('NO');
    expect(byName.id?.column_default).toMatch(/nextval/);

    // species_code TEXT NOT NULL.
    expect(byName.species_code?.data_type).toBe('text');
    expect(byName.species_code?.is_nullable).toBe('NO');

    // source TEXT NOT NULL.
    expect(byName.source?.data_type).toBe('text');
    expect(byName.source?.is_nullable).toBe('NO');

    // body TEXT NOT NULL.
    expect(byName.body?.data_type).toBe('text');
    expect(byName.body?.is_nullable).toBe('NO');

    // license TEXT NOT NULL.
    expect(byName.license?.data_type).toBe('text');
    expect(byName.license?.is_nullable).toBe('NO');

    // revision_id BIGINT (nullable — Wikipedia 304 path may not echo it).
    expect(byName.revision_id?.data_type).toBe('bigint');
    expect(byName.revision_id?.is_nullable).toBe('YES');

    // etag TEXT (nullable — first-fetch path may have null upstream etag).
    expect(byName.etag?.data_type).toBe('text');
    expect(byName.etag?.is_nullable).toBe('YES');

    // attribution_url TEXT NOT NULL.
    expect(byName.attribution_url?.data_type).toBe('text');
    expect(byName.attribution_url?.is_nullable).toBe('NO');

    // fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW().
    expect(byName.fetched_at?.data_type).toBe('timestamp with time zone');
    expect(byName.fetched_at?.is_nullable).toBe('NO');
    expect(byName.fetched_at?.column_default).toMatch(/now\(\)/i);
  });

  it('declares species_code as a FK to species_meta with ON DELETE CASCADE', async () => {
    const { rows } = await pool.query<{
      delete_rule: string;
      foreign_table: string;
      foreign_column: string;
    }>(
      `SELECT rc.delete_rule,
              ccu.table_name  AS foreign_table,
              ccu.column_name AS foreign_column
         FROM information_schema.referential_constraints rc
         JOIN information_schema.constraint_column_usage ccu
              ON rc.unique_constraint_name = ccu.constraint_name
         JOIN information_schema.key_column_usage kcu
              ON rc.constraint_name = kcu.constraint_name
        WHERE kcu.table_name = 'species_descriptions'
          AND kcu.column_name = 'species_code'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.delete_rule).toBe('CASCADE');
    expect(rows[0]?.foreign_table).toBe('species_meta');
    expect(rows[0]?.foreign_column).toBe('species_code');
  });

  it("accepts source='wikipedia' and rejects any other value via CHECK", async () => {
    await pool.query(
      `INSERT INTO species_descriptions (species_code, source, body, license, attribution_url)
       VALUES ('vermfly', 'wikipedia', '${'x'.repeat(60)}', 'CC-BY-SA-4.0', 'https://en.wikipedia.org/wiki/Vermilion_flycatcher')`
    );
    await expect(
      pool.query(
        `INSERT INTO species_descriptions (species_code, source, body, license, attribution_url)
         VALUES ('vermfly', 'inaturalist', '${'y'.repeat(60)}', 'CC-BY-SA-4.0', 'https://example.test/x')`
      )
    ).rejects.toThrow(/check constraint/i);
    await pool.query(`DELETE FROM species_descriptions`);
  });

  it('rejects body length below 50 chars and above 8192 chars', async () => {
    // Below 50 chars.
    await expect(
      pool.query(
        `INSERT INTO species_descriptions (species_code, source, body, license, attribution_url)
         VALUES ('vermfly', 'wikipedia', 'too short', 'CC-BY-SA-4.0', 'https://x.test/x')`
      )
    ).rejects.toThrow(/check constraint/i);

    // Above 8192 chars.
    await expect(
      pool.query(
        `INSERT INTO species_descriptions (species_code, source, body, license, attribution_url)
         VALUES ('vermfly', 'wikipedia', '${'x'.repeat(8193)}', 'CC-BY-SA-4.0', 'https://x.test/x')`
      )
    ).rejects.toThrow(/check constraint/i);

    // Exactly 50 and 8192 are accepted.
    await pool.query(
      `INSERT INTO species_descriptions (species_code, source, body, license, attribution_url)
       VALUES ('vermfly', 'wikipedia', '${'x'.repeat(50)}', 'CC-BY-SA-4.0', 'https://x.test/x')`
    );
    await pool.query(`DELETE FROM species_descriptions`);
    await pool.query(
      `INSERT INTO species_descriptions (species_code, source, body, license, attribution_url)
       VALUES ('vermfly', 'wikipedia', '${'x'.repeat(8192)}', 'CC-BY-SA-4.0', 'https://x.test/x')`
    );
    await pool.query(`DELETE FROM species_descriptions`);
  });

  it('accepts CC-BY-SA-3.0 and CC-BY-SA-4.0 license values; rejects others', async () => {
    await pool.query(
      `INSERT INTO species_descriptions (species_code, source, body, license, attribution_url)
       VALUES ('vermfly', 'wikipedia', '${'x'.repeat(60)}', 'CC-BY-SA-3.0', 'https://x.test/x')`
    );
    await pool.query(`DELETE FROM species_descriptions`);

    await pool.query(
      `INSERT INTO species_descriptions (species_code, source, body, license, attribution_url)
       VALUES ('vermfly', 'wikipedia', '${'x'.repeat(60)}', 'CC-BY-SA-4.0', 'https://x.test/x')`
    );
    await pool.query(`DELETE FROM species_descriptions`);

    await expect(
      pool.query(
        `INSERT INTO species_descriptions (species_code, source, body, license, attribution_url)
         VALUES ('vermfly', 'wikipedia', '${'x'.repeat(60)}', 'CC-BY-NC-4.0', 'https://x.test/x')`
      )
    ).rejects.toThrow(/check constraint/i);
  });

  it('UNIQUE (species_code) blocks duplicate description rows', async () => {
    await pool.query(
      `INSERT INTO species_descriptions (species_code, source, body, license, attribution_url)
       VALUES ('vermfly', 'wikipedia', '${'a'.repeat(60)}', 'CC-BY-SA-4.0', 'https://en.wikipedia.org/wiki/A')`
    );
    await expect(
      pool.query(
        `INSERT INTO species_descriptions (species_code, source, body, license, attribution_url)
         VALUES ('vermfly', 'wikipedia', '${'b'.repeat(60)}', 'CC-BY-SA-4.0', 'https://en.wikipedia.org/wiki/B')`
      )
    ).rejects.toThrow(/duplicate key|unique/i);
    await pool.query(`DELETE FROM species_descriptions`);
  });

  it('CASCADEs description rows when the parent species is deleted', async () => {
    await pool.query(
      `INSERT INTO species_meta (species_code, com_name, sci_name, family_code, family_name)
       VALUES ('annhum-tmp', 'Anna''s Hummingbird', 'Calypte anna', 'trochilidae', 'Hummingbirds')`
    );
    await pool.query(
      `INSERT INTO species_descriptions (species_code, source, body, license, attribution_url)
       VALUES ('annhum-tmp', 'wikipedia', '${'z'.repeat(60)}', 'CC-BY-SA-4.0', 'https://x.test/x')`
    );
    await pool.query(`DELETE FROM species_meta WHERE species_code = 'annhum-tmp'`);
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM species_descriptions WHERE species_code = 'annhum-tmp'`
    );
    expect(Number(rows[0]?.count)).toBe(0);
  });
});

describe('migration 1700000030000_add_species_descriptions — Down', () => {
  it('drops species_descriptions and removes species_meta.inat_taxon_id cleanly', async () => {
    const migrationsDir = resolve(process.cwd(), '../../migrations');
    const { down, up } = parseMigration(join(migrationsDir, MIGRATION_FILE));
    expect(down).toBeTruthy();
    await pool.query(down);

    const tableCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count
         FROM information_schema.tables
        WHERE table_name = 'species_descriptions'`
    );
    expect(Number(tableCount.rows[0]?.count)).toBe(0);

    const colCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count
         FROM information_schema.columns
        WHERE table_name = 'species_meta' AND column_name = 'inat_taxon_id'`
    );
    expect(Number(colCount.rows[0]?.count)).toBe(0);

    // Down is idempotent — running it again must not error.
    await expect(pool.query(down)).resolves.toBeDefined();

    // Re-apply Up so other tests in the file see the table.
    await pool.query(up);
  });
});

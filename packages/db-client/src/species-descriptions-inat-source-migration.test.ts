/**
 * Integration test for migration 1700000031000 — widen the
 * `species_descriptions_source_check` CHECK constraint to accept the new
 * 'inat' source value alongside the original 'wikipedia' value.
 *
 * The Up migration is a DROP+RECREATE of the constraint. Verifies the actual
 * Postgres-auto-generated constraint name (`species_descriptions_source_check`),
 * that 'inat' is now accepted, that 'wikipedia' is still accepted, and that
 * any other value (e.g. 'ebird', 'wikidata') is still rejected.
 *
 * The Down migration must reverse the widening: only 'wikipedia' accepted,
 * 'inat' rejected. Idempotent on both directions via IF EXISTS on DROP.
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

const MIGRATION_FILE = '1700000031000_widen_species_descriptions_source.sql';

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

  // Seed a parent species for the FK so the CHECK-violation tests have a
  // valid species_code to attach to (otherwise the FK fires before the CHECK).
  await pool.query(
    `INSERT INTO species_meta (species_code, com_name, sci_name, family_code, family_name)
     VALUES ('vermfly', 'Vermilion Flycatcher', 'Pyrocephalus rubinus', 'tyrannidae', 'Tyrant Flycatchers')`
  );
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe('migration 1700000031000_widen_species_descriptions_source — Up', () => {
  it('the auto-generated constraint name is `species_descriptions_source_check` (PG convention)', async () => {
    // The widening migration relies on this exact name to drop the original
    // (column-level inline CHECK from migration 30000). Postgres's convention
    // for an inline column CHECK with no explicit name is `<table>_<column>_check`.
    // If a future PG release changes that convention, this test will fail
    // loudly and the migration's DROP CONSTRAINT will need updating.
    const { rows } = await pool.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'species_descriptions'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%source%'`
    );
    const names = rows.map(r => r.conname);
    expect(names).toContain('species_descriptions_source_check');
  });

  it("accepts source='wikipedia' (preserves the original allowed value)", async () => {
    await pool.query(
      `INSERT INTO species_descriptions (species_code, source, body, license, attribution_url)
       VALUES ('vermfly', 'wikipedia', '${'x'.repeat(60)}', 'CC-BY-SA-4.0', 'https://en.wikipedia.org/wiki/Vermilion_flycatcher')`
    );
    await pool.query(`DELETE FROM species_descriptions`);
  });

  it("accepts source='inat' (the newly widened value)", async () => {
    await pool.query(
      `INSERT INTO species_descriptions (species_code, source, body, license, attribution_url)
       VALUES ('vermfly', 'inat', '${'y'.repeat(60)}', 'CC-BY-SA-4.0', 'https://www.inaturalist.org/taxa/9083')`
    );
    await pool.query(`DELETE FROM species_descriptions`);
  });

  it('rejects any other source value (e.g. ebird, wikidata) via the widened CHECK', async () => {
    await expect(
      pool.query(
        `INSERT INTO species_descriptions (species_code, source, body, license, attribution_url)
         VALUES ('vermfly', 'ebird', '${'z'.repeat(60)}', 'CC-BY-SA-4.0', 'https://x.test/x')`
      )
    ).rejects.toThrow(/check constraint/i);

    await expect(
      pool.query(
        `INSERT INTO species_descriptions (species_code, source, body, license, attribution_url)
         VALUES ('vermfly', 'wikidata', '${'z'.repeat(60)}', 'CC-BY-SA-4.0', 'https://x.test/x')`
      )
    ).rejects.toThrow(/check constraint/i);
  });

  it('the body length CHECK is unchanged (still 50..8192)', async () => {
    // Belt-and-suspenders: the widening migration must not accidentally drop
    // the body-length CHECK while replacing the source CHECK.
    await expect(
      pool.query(
        `INSERT INTO species_descriptions (species_code, source, body, license, attribution_url)
         VALUES ('vermfly', 'inat', 'too short', 'CC-BY-SA-4.0', 'https://x.test/x')`
      )
    ).rejects.toThrow(/check constraint/i);
  });

  it('the license CHECK is unchanged (still CC-BY-SA-3.0 / CC-BY-SA-4.0 only)', async () => {
    // iNat fallback rows still license as CC-BY-SA-4.0 because the underlying
    // source is the same Wikipedia article; non-CC-BY-SA license codes must
    // still be rejected.
    await expect(
      pool.query(
        `INSERT INTO species_descriptions (species_code, source, body, license, attribution_url)
         VALUES ('vermfly', 'inat', '${'w'.repeat(60)}', 'CC-BY-NC-4.0', 'https://x.test/x')`
      )
    ).rejects.toThrow(/check constraint/i);
  });
});

describe('migration 1700000031000_widen_species_descriptions_source — Down', () => {
  it('reverts to wikipedia-only: rejects inat after Down, accepts wikipedia', async () => {
    const migrationsDir = resolve(process.cwd(), '../../migrations');
    const { down, up } = parseMigration(join(migrationsDir, MIGRATION_FILE));
    expect(down).toBeTruthy();
    await pool.query(down);

    // After Down: 'wikipedia' must still work.
    await pool.query(
      `INSERT INTO species_descriptions (species_code, source, body, license, attribution_url)
       VALUES ('vermfly', 'wikipedia', '${'x'.repeat(60)}', 'CC-BY-SA-4.0', 'https://en.wikipedia.org/wiki/X')`
    );
    await pool.query(`DELETE FROM species_descriptions`);

    // After Down: 'inat' must be rejected.
    await expect(
      pool.query(
        `INSERT INTO species_descriptions (species_code, source, body, license, attribution_url)
         VALUES ('vermfly', 'inat', '${'y'.repeat(60)}', 'CC-BY-SA-4.0', 'https://www.inaturalist.org/taxa/9083')`
      )
    ).rejects.toThrow(/check constraint/i);

    // Down is idempotent — running it again must not error.
    await expect(pool.query(down)).resolves.toBeDefined();

    // Re-apply Up so other tests / parallel describe blocks see the wide CHECK.
    await pool.query(up);
  });
});

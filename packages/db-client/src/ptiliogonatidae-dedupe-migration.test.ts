/**
 * Integration test for migration 1700000052000 —
 * dedupe the spelling-variant duplicate in family_silhouettes for the
 * silky-flycatcher family (`ptilogonatidae` vs `ptiliogonatidae`).
 *
 * Issue #922 (family-name hygiene). The table historically carried two rows for
 * one family: the project-canonical `ptilogonatidae` (`lower(familySciName)`,
 * the key observations/species_meta resolve against) and an extra-`i`
 * `ptiliogonatidae` variant (matching eBird's own spelling), inserted by
 * migration 34000. Both have a common_name so rendering is fine today, but the
 * duplicate is latent taxonomy drift and would let PR4's `family_silhouettes`
 * LEFT JOIN match two rows for the family.
 *
 * Invariants exercised here:
 *   - Up leaves exactly ONE silky-flycatcher row, the canonical
 *     `ptilogonatidae`, and it still has a non-null common_name.
 *   - Up does not touch the canonical row's common_name.
 *   - Down re-inserts the `ptiliogonatidae` variant (rollback restores the
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

// The two spellings of the Ptilogonatidae (silky-flycatcher) family.
const CANONICAL = 'ptilogonatidae'; // lower(familySciName) — kept
const VARIANT = 'ptiliogonatidae'; // extra `i`, eBird spelling — removed

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

  it('removes the extra-`i` variant row entirely', async () => {
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
  it('re-inserts the variant row (restores the two-row pre-migration state)', async () => {
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
    expect(rows[0]?.common_name).toBe('Silky-flycatchers');
    expect(rows[0]?.color).toBe('#73596a');
    expect(rows[0]?.color_dark).toBe('#73596a');
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

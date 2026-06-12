/**
 * Integration test for migration 1700000053000 — species_photo_scores table
 * (epic #1074, child C1 #1070).
 *
 * Locks the schema contract for the append-only photo-quality score table that
 * gives the photo-judge eval (#1010) an immutable, reproducible baseline pin.
 * Mirrors the shape of species-descriptions-migration.test.ts and
 * state-boundaries-migration.test.ts: columns / FK / UNIQUE / pin index /
 * append-only / CASCADE invariants are verified against a fully-migrated
 * PostGIS testcontainer.
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

const MIGRATION_FILE = '1700000053000_add_species_photo_scores.sql';

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

  // Seed a parent species for the FK.
  await pool.query(
    `INSERT INTO species_meta (species_code, com_name, sci_name, family_code, family_name)
     VALUES ('vermfly', 'Vermilion Flycatcher', 'Pyrocephalus rubinus', 'tyrannidae', 'Tyrant Flycatchers')`
  );
}, 180_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe('migration 1700000053000_add_species_photo_scores — Up', () => {
  it('creates species_photo_scores with the documented columns and types', async () => {
    const { rows } = await pool.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_name = 'species_photo_scores'
        ORDER BY ordinal_position`
    );
    const byName = Object.fromEntries(rows.map(r => [r.column_name, r]));

    expect(Object.keys(byName).sort()).toEqual(
      [
        'criteria', 'content_hash', 'field_marks', 'id', 'keep', 'model',
        'quality_score', 'rationale', 'rubric_version', 'scored_at',
        'species_code',
      ].sort()
    );

    // id BIGSERIAL → bigint NOT NULL with a sequence default.
    expect(byName.id?.data_type).toBe('bigint');
    expect(byName.id?.is_nullable).toBe('NO');
    expect(byName.id?.column_default).toMatch(/nextval/);

    // species_code TEXT NOT NULL.
    expect(byName.species_code?.data_type).toBe('text');
    expect(byName.species_code?.is_nullable).toBe('NO');

    // content_hash TEXT NOT NULL.
    expect(byName.content_hash?.data_type).toBe('text');
    expect(byName.content_hash?.is_nullable).toBe('NO');

    // model TEXT NOT NULL.
    expect(byName.model?.data_type).toBe('text');
    expect(byName.model?.is_nullable).toBe('NO');

    // rubric_version TEXT NOT NULL.
    expect(byName.rubric_version?.data_type).toBe('text');
    expect(byName.rubric_version?.is_nullable).toBe('NO');

    // keep BOOLEAN NOT NULL.
    expect(byName.keep?.data_type).toBe('boolean');
    expect(byName.keep?.is_nullable).toBe('NO');

    // quality_score REAL (nullable — deterministic-gate rows have no numeric score).
    expect(byName.quality_score?.data_type).toBe('real');
    expect(byName.quality_score?.is_nullable).toBe('YES');

    // criteria JSONB (nullable).
    expect(byName.criteria?.data_type).toBe('jsonb');
    expect(byName.criteria?.is_nullable).toBe('YES');

    // field_marks JSONB (nullable).
    expect(byName.field_marks?.data_type).toBe('jsonb');
    expect(byName.field_marks?.is_nullable).toBe('YES');

    // rationale TEXT (nullable).
    expect(byName.rationale?.data_type).toBe('text');
    expect(byName.rationale?.is_nullable).toBe('YES');

    // scored_at TIMESTAMPTZ NOT NULL DEFAULT NOW().
    expect(byName.scored_at?.data_type).toBe('timestamp with time zone');
    expect(byName.scored_at?.is_nullable).toBe('NO');
    expect(byName.scored_at?.column_default).toMatch(/now\(\)/i);
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
        WHERE kcu.table_name = 'species_photo_scores'
          AND kcu.column_name = 'species_code'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.delete_rule).toBe('CASCADE');
    expect(rows[0]?.foreign_table).toBe('species_meta');
    expect(rows[0]?.foreign_column).toBe('species_code');
  });

  it('declares the UNIQUE constraint over (species_code, content_hash, model, rubric_version)', async () => {
    const { rows } = await pool.query<{ columns: string }>(
      `SELECT string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS columns
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_name = 'species_photo_scores'
          AND tc.constraint_type = 'UNIQUE'
        GROUP BY tc.constraint_name`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.columns).toBe('species_code,content_hash,model,rubric_version');
  });

  it('creates the pin index on (model, rubric_version)', async () => {
    const { rows } = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'species_photo_scores'
          AND indexname = 'idx_species_photo_scores_pin'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.indexdef).toMatch(/\(model, rubric_version\)/);
  });

  it('UNIQUE blocks a duplicate (species_code, content_hash, model, rubric_version) but allows a re-score under a different model/rubric (append-only)', async () => {
    await pool.query(
      `INSERT INTO species_photo_scores
         (species_code, content_hash, model, rubric_version, keep, quality_score, criteria, field_marks, rationale)
       VALUES ('vermfly', 'sha256:aaa', 'claude-opus-4-8', 'v1', true, 8.5,
               '{"composition": 9}'::jsonb, '["red crest"]'::jsonb, 'sharp, diagnostic')`
    );

    // Exact same key → blocked.
    await expect(
      pool.query(
        `INSERT INTO species_photo_scores
           (species_code, content_hash, model, rubric_version, keep)
         VALUES ('vermfly', 'sha256:aaa', 'claude-opus-4-8', 'v1', false)`
      )
    ).rejects.toThrow(/duplicate key|unique/i);

    // Same image, different model → appends (new row).
    await pool.query(
      `INSERT INTO species_photo_scores
         (species_code, content_hash, model, rubric_version, keep)
       VALUES ('vermfly', 'sha256:aaa', 'gemini-2.5-flash', 'v1', true)`
    );
    // Same image+model, bumped rubric → appends (new row).
    await pool.query(
      `INSERT INTO species_photo_scores
         (species_code, content_hash, model, rubric_version, keep)
       VALUES ('vermfly', 'sha256:aaa', 'claude-opus-4-8', 'v2', true)`
    );

    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM species_photo_scores WHERE content_hash = 'sha256:aaa'`
    );
    expect(Number(rows[0]?.count)).toBe(3);
    await pool.query(`DELETE FROM species_photo_scores`);
  });

  it('allows a deterministic-gate row with a NULL quality_score', async () => {
    await pool.query(
      `INSERT INTO species_photo_scores
         (species_code, content_hash, model, rubric_version, keep, quality_score)
       VALUES ('vermfly', 'sha256:gate', 'deterministic-gate', 'v1', false, NULL)`
    );
    const { rows } = await pool.query<{ quality_score: number | null }>(
      `SELECT quality_score FROM species_photo_scores WHERE content_hash = 'sha256:gate'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.quality_score).toBeNull();
    await pool.query(`DELETE FROM species_photo_scores`);
  });

  it('CASCADEs score rows when the parent species is deleted', async () => {
    await pool.query(
      `INSERT INTO species_meta (species_code, com_name, sci_name, family_code, family_name)
       VALUES ('annhum-tmp', 'Anna''s Hummingbird', 'Calypte anna', 'trochilidae', 'Hummingbirds')`
    );
    await pool.query(
      `INSERT INTO species_photo_scores
         (species_code, content_hash, model, rubric_version, keep)
       VALUES ('annhum-tmp', 'sha256:bbb', 'claude-opus-4-8', 'v1', true)`
    );
    await pool.query(`DELETE FROM species_meta WHERE species_code = 'annhum-tmp'`);
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM species_photo_scores WHERE species_code = 'annhum-tmp'`
    );
    expect(Number(rows[0]?.count)).toBe(0);
  });
});

describe('migration 1700000053000_add_species_photo_scores — Down/Up round-trip', () => {
  it('Down drops the table; re-applying Up restores it cleanly and is idempotent', async () => {
    const migrationsDir = resolve(process.cwd(), '../../migrations');
    const { up, down } = parseMigration(join(migrationsDir, MIGRATION_FILE));
    expect(down).toBeTruthy();

    await pool.query(down);
    const { rows: gone } = await pool.query<{ reg: string | null }>(
      `SELECT to_regclass('species_photo_scores') AS reg`
    );
    expect(gone[0]?.reg).toBeNull();

    // Down is idempotent — running it again must not error.
    await expect(pool.query(down)).resolves.toBeDefined();

    // Re-apply Up so the table (and its pin index) come back cleanly.
    await pool.query(up);
    const { rows: back } = await pool.query<{ reg: string | null }>(
      `SELECT to_regclass('species_photo_scores') AS reg`
    );
    expect(back[0]?.reg).not.toBeNull();

    const { rows: idx } = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE tablename = 'species_photo_scores'
          AND indexname = 'idx_species_photo_scores_pin'`
    );
    expect(idx).toHaveLength(1);
  });
});

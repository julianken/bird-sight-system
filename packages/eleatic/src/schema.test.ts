import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from './schema.js';

describe('schema', () => {
  let db: Database.Database | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  it('creates the three generic tables and three indexes on a fresh :memory: db', () => {
    db = new Database(':memory:');
    migrate(db);

    const names = (
      db.prepare(`SELECT name FROM sqlite_master WHERE type IN ('table','index') ORDER BY name`).all() as {
        name: string;
      }[]
    ).map((r) => r.name);

    expect(names).toContain('eval_run');
    expect(names).toContain('eval_row');
    expect(names).toContain('eval_adjudication');
    expect(names).toContain('idx_eval_row_run');
    expect(names).toContain('idx_eval_row_key');
    expect(names).toContain('idx_eval_run_started');
  });

  it('turns foreign keys ON (the pragma that load-bears the FK cascade + rollback)', () => {
    db = new Database(':memory:');
    migrate(db);
    // PRAGMA foreign_keys persists per-connection; WAL is a no-op on :memory:.
    const fk = db.pragma('foreign_keys', { simple: true });
    expect(fk).toBe(1);
  });

  it('migrate is idempotent (CREATE ... IF NOT EXISTS) — re-running does not throw', () => {
    db = new Database(':memory:');
    migrate(db);
    expect(() => migrate(db!)).not.toThrow();
  });

  it('eval_row carries the nullable trace_json column (generic per-row trace)', () => {
    db = new Database(':memory:');
    migrate(db);
    const cols = (
      db.prepare(`PRAGMA table_info(eval_row)`).all() as { name: string; notnull: number }[]
    );
    const trace = cols.find((c) => c.name === 'trace_json');
    expect(trace).toBeDefined();
    // Additive + nullable: existing rows read NULL, no backfill needed.
    expect(trace?.notnull).toBe(0);
  });
});

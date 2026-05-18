import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDualWritePool, isWriteSql } from './dual-write-pool.js';
import type { Pool } from './pool.js';

/**
 * Unit tests for the dual-write pool wrapper. These tests stub two pg pools
 * (no real Postgres) and assert the fan-out + failure-handling contract:
 *
 *   1. Write SQL (INSERT/UPDATE/DELETE/TRUNCATE/MERGE) is sent to BOTH pools.
 *   2. Read SQL (SELECT/WITH) is sent ONLY to the primary.
 *   3. If the SECONDARY write fails, the error is logged with a `dual_write_secondary_failed`
 *      marker and the call returns the primary result without throwing.
 *   4. If the PRIMARY write fails, the error throws as usual.
 *
 * Real-Postgres integration coverage for `createPool` lives in pool.test.ts;
 * the dual-write layer is logic-only, so unit tests are sufficient.
 */

function makeFakePool(queryImpl: (sql: string) => Promise<{ rows: unknown[]; rowCount: number }>): Pool {
  return {
    query: vi.fn(queryImpl),
    end: vi.fn(async () => {}),
    // We intentionally don't model `connect`, `on`, etc. — the ingestor code
    // only uses `.query()` and pool lifecycle is managed via createPool/closePool.
  } as unknown as Pool;
}

describe('isWriteSql', () => {
  it.each([
    ['INSERT INTO foo VALUES (1)', true],
    ['  insert into foo values (1)', true],
    ['UPDATE foo SET x = 1', true],
    ['DELETE FROM foo', true],
    ['TRUNCATE foo', true],
    ['MERGE INTO foo USING bar ON ...', true],
    ['SELECT * FROM foo', false],
    ['WITH x AS (SELECT 1) SELECT * FROM x', false],
    ['VACUUM ANALYZE foo', false], // VACUUM is maintenance, not a row write — and runs OK on either DB independently
    ['BEGIN', false],
    ['  -- comment\nINSERT INTO foo VALUES (1)', true],
  ])('classifies %s as write=%s', (sql, expected) => {
    expect(isWriteSql(sql)).toBe(expected);
  });
});

describe('createDualWritePool', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it('fans out INSERT to both primary and secondary', async () => {
    const primary = makeFakePool(async () => ({ rows: [], rowCount: 1 }));
    const secondary = makeFakePool(async () => ({ rows: [], rowCount: 1 }));
    const pool = createDualWritePool({ primary, secondary });

    await pool.query('INSERT INTO observations (sub_id) VALUES ($1)', ['S1']);

    expect(primary.query).toHaveBeenCalledTimes(1);
    expect(secondary.query).toHaveBeenCalledTimes(1);
    expect(primary.query).toHaveBeenCalledWith('INSERT INTO observations (sub_id) VALUES ($1)', ['S1']);
    expect(secondary.query).toHaveBeenCalledWith('INSERT INTO observations (sub_id) VALUES ($1)', ['S1']);
  });

  it('does NOT fan out SELECT to secondary', async () => {
    const primary = makeFakePool(async () => ({ rows: [{ n: 1 }], rowCount: 1 }));
    const secondary = makeFakePool(async () => ({ rows: [], rowCount: 0 }));
    const pool = createDualWritePool({ primary, secondary });

    const result = await pool.query('SELECT 1 AS n');

    expect(primary.query).toHaveBeenCalledTimes(1);
    expect(secondary.query).not.toHaveBeenCalled();
    expect(result.rows).toEqual([{ n: 1 }]);
  });

  it('swallows + logs when secondary write fails; returns primary result', async () => {
    const primary = makeFakePool(async () => ({ rows: [], rowCount: 3 }));
    const secondary = makeFakePool(async () => {
      throw new Error('connection refused');
    });
    const pool = createDualWritePool({ primary, secondary, kind: 'recent' });

    const result = await pool.query('UPDATE foo SET x = 1');

    expect(result.rowCount).toBe(3);
    expect(primary.query).toHaveBeenCalledTimes(1);
    expect(secondary.query).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const logMsg = String(logSpy.mock.calls[0][0]);
    expect(logMsg).toContain('dual_write_secondary_failed');
    expect(logMsg).toContain('kind=recent');
    expect(logMsg).toContain('connection refused');
  });

  it('throws when primary write fails (does not call secondary)', async () => {
    const primary = makeFakePool(async () => {
      throw new Error('primary unique violation');
    });
    const secondary = makeFakePool(async () => ({ rows: [], rowCount: 1 }));
    const pool = createDualWritePool({ primary, secondary });

    await expect(pool.query('INSERT INTO foo VALUES (1)')).rejects.toThrow('primary unique violation');
    expect(secondary.query).not.toHaveBeenCalled();
  });

  it('end() closes both pools', async () => {
    const primary = makeFakePool(async () => ({ rows: [], rowCount: 0 }));
    const secondary = makeFakePool(async () => ({ rows: [], rowCount: 0 }));
    const pool = createDualWritePool({ primary, secondary });

    await pool.end();
    expect(primary.end).toHaveBeenCalledTimes(1);
    expect(secondary.end).toHaveBeenCalledTimes(1);
  });
});

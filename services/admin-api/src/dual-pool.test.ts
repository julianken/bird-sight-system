import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Pool } from '@bird-watch/db-client';
import { createDualWritePool, isWriteSql } from './dual-pool.js';

/**
 * Unit tests for admin-api's dual-write pool wrapper. We stub two pg-shaped
 * pools (no real Postgres) and assert the contract Julian set in the brief:
 *
 *   1. Write SQL (INSERT/UPDATE/DELETE) fans out to BOTH pools.
 *   2. Read SQL (SELECT/WITH) goes to the PRIMARY only.
 *   3. If SECONDARY fails, log `dual_write_secondary_failed surface=... err=...`
 *      and CONTINUE — primary result is returned and no error is thrown.
 *   4. If PRIMARY fails, the error propagates as-is and SECONDARY is not called.
 *   5. end() closes both pools.
 *
 * The admin-api copy of this primitive is local-by-design so the admin-api
 * PR is fully independent of the parallel ingestor PR that ships an
 * equivalent primitive in @bird-watch/db-client. The two implementations can
 * be unified later once both have landed.
 */
function makeFakePool(
  queryImpl: (sql: string) => Promise<{ rows: unknown[]; rowCount: number }>,
): Pool {
  return {
    query: vi.fn(queryImpl),
    end: vi.fn(async () => {}),
  } as unknown as Pool;
}

describe('isWriteSql', () => {
  it.each([
    ['INSERT INTO foo VALUES (1)', true],
    ['  insert into foo values (1)', true],
    ['UPDATE family_silhouettes SET svg_url = NULL WHERE family_code = $1', true],
    ['DELETE FROM foo', true],
    ['SELECT svg_url FROM family_silhouettes WHERE family_code = $1', false],
    ['WITH x AS (SELECT 1) SELECT * FROM x', false],
    ['BEGIN', false],
    ['  -- comment\nUPDATE foo SET x = 1', true],
  ])('classifies %s as write=%s', (sql, expected) => {
    expect(isWriteSql(sql)).toBe(expected);
  });
});

describe('createDualWritePool', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errSpy.mockRestore();
  });

  it('fans out UPDATE to both primary and secondary', async () => {
    const primary = makeFakePool(async () => ({ rows: [], rowCount: 1 }));
    const secondary = makeFakePool(async () => ({ rows: [], rowCount: 1 }));
    const pool = createDualWritePool({ primary, secondary, surface: 'silhouette' });

    await pool.query(
      'UPDATE family_silhouettes SET svg_url = $1, svg_data = $2 WHERE family_code = $3',
      ['u', 'p', 'cuculidae'],
    );

    expect(primary.query).toHaveBeenCalledTimes(1);
    expect(secondary.query).toHaveBeenCalledTimes(1);
  });

  it('does NOT fan out SELECT to secondary', async () => {
    const primary = makeFakePool(async () => ({ rows: [{ svg_url: null }], rowCount: 1 }));
    const secondary = makeFakePool(async () => ({ rows: [], rowCount: 0 }));
    const pool = createDualWritePool({ primary, secondary, surface: 'silhouette' });

    const result = await pool.query('SELECT svg_url FROM family_silhouettes WHERE family_code = $1', ['x']);

    expect(primary.query).toHaveBeenCalledTimes(1);
    expect(secondary.query).not.toHaveBeenCalled();
    expect(result.rows).toEqual([{ svg_url: null }]);
  });

  it('swallows + logs when secondary write fails; returns primary result', async () => {
    const primary = makeFakePool(async () => ({ rows: [], rowCount: 1 }));
    const secondary = makeFakePool(async () => {
      throw new Error('connection refused');
    });
    const pool = createDualWritePool({ primary, secondary, surface: 'silhouette' });

    const result = await pool.query('UPDATE family_silhouettes SET svg_url = NULL WHERE family_code = $1', ['x']);

    expect(result.rowCount).toBe(1);
    expect(primary.query).toHaveBeenCalledTimes(1);
    expect(secondary.query).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledTimes(1);
    const logMsg = String(errSpy.mock.calls[0]![0]);
    expect(logMsg).toContain('dual_write_secondary_failed');
    expect(logMsg).toContain('surface=silhouette');
    expect(logMsg).toContain('connection refused');
  });

  it('throws when primary write fails (does not call secondary)', async () => {
    const primary = makeFakePool(async () => {
      throw new Error('primary boom');
    });
    const secondary = makeFakePool(async () => ({ rows: [], rowCount: 1 }));
    const pool = createDualWritePool({ primary, secondary, surface: 'silhouette' });

    await expect(
      pool.query('UPDATE family_silhouettes SET svg_url = $1 WHERE family_code = $2', ['u', 'x']),
    ).rejects.toThrow('primary boom');
    expect(secondary.query).not.toHaveBeenCalled();
  });

  it('end() closes both pools', async () => {
    const primary = makeFakePool(async () => ({ rows: [], rowCount: 0 }));
    const secondary = makeFakePool(async () => ({ rows: [], rowCount: 0 }));
    const pool = createDualWritePool({ primary, secondary, surface: 'silhouette' });

    await pool.end();
    expect(primary.end).toHaveBeenCalledTimes(1);
    expect(secondary.end).toHaveBeenCalledTimes(1);
  });
});

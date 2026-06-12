import { describe, it, expect, vi, afterEach } from 'vitest';
import pg from 'pg';
import { createPool, closePool } from './pool.js';

// These tests need NO real database. They construct a pool (which does not open
// a connection until a query runs) and assert that an idle-client `'error'`
// event emitted on the pool is caught by a handler `createPool` attaches —
// rather than becoming an uncaught exception that exits the process.
//
// Regression guard for #1069: node-postgres docs mandate a pool-level `'error'`
// listener; without one, an idle client erroring (a CI testcontainers teardown
// blip, or a prod network blip) crashes the process. The `test` CI workflow
// flaked on exactly this — an uncaught `pg-protocol` parser exception off an
// idle socket, with zero failed assertions.

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createPool idle-client error handling (#1069)', () => {
  it('attaches a pool-level error listener so an idle-client error is not uncaught', () => {
    const pool = createPool({ databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/none' });
    try {
      // Without a listener, EventEmitter rethrows an emitted 'error' (which is
      // what becomes the process-killing uncaught exception in CI). The handler
      // createPool attaches must absorb it.
      expect(pool.listenerCount('error')).toBeGreaterThan(0);
    } finally {
      closePool(pool);
    }
  });

  it('swallows (does not rethrow) an emitted idle-client error', () => {
    const pool = createPool({ databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/none' });
    const fakeClient = {} as pg.PoolClient;
    try {
      // If no handler is attached, EventEmitter throws here. The handler must
      // not rethrow, so this emit returns cleanly.
      expect(() =>
        pool.emit('error', new Error('idle client boom'), fakeClient),
      ).not.toThrow();
    } finally {
      closePool(pool);
    }
  });

  it('structured-logs the idle-client error in the repo {severity, message} shape', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pool = createPool({ databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/none' });
    const fakeClient = {} as pg.PoolClient;
    try {
      pool.emit('error', new Error('idle client boom'), fakeClient);

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const logged = errorSpy.mock.calls[0][0];
      expect(typeof logged).toBe('string');
      const parsed = JSON.parse(logged as string);
      expect(parsed.severity).toBe('ERROR');
      expect(parsed.message).toBe('db_pool_idle_client_error');
      expect(parsed.error).toContain('idle client boom');
    } finally {
      closePool(pool);
    }
  });
});

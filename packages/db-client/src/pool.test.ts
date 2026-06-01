import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createPool, closePool } from './pool.js';

let container: StartedPostgreSqlContainer;
let dbUrl: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgis/postgis:16-3.4').start();
  dbUrl = container.getConnectionUri();
}, 60_000);

afterAll(async () => {
  await container?.stop();
});

describe('createPool', () => {
  it('connects to Postgres and returns a usable pool', async () => {
    const pool = createPool({ databaseUrl: dbUrl });
    const result = await pool.query('SELECT 1 AS n');
    expect(result.rows[0].n).toBe(1);
    await closePool(pool);
  });

  it('returns the same pool when called twice with the same key', () => {
    const a = createPool({ databaseUrl: dbUrl, key: 'shared' });
    const b = createPool({ databaseUrl: dbUrl, key: 'shared' });
    expect(a).toBe(b);
    closePool(a);
  });

  it('threads statement_timeout through to the live connection (#821)', async () => {
    // Behavioral proof that the option is wired into the pg.Pool config and
    // honored by the server session — not merely stored. A 1ms statement
    // timeout against a 500ms sleep MUST be cancelled server-side; pg surfaces
    // the cancellation as SQLSTATE 57014 (query_canceled / "canceling statement
    // due to statement timeout"). This is the no-mocks-compliant way to verify
    // the timeout reaches the live connection without poking pg internals.
    const pool = createPool({ databaseUrl: dbUrl, statement_timeout: 1 });
    await expect(pool.query('SELECT pg_sleep(0.5)')).rejects.toMatchObject({
      code: '57014',
    });
    await closePool(pool);
  });
});

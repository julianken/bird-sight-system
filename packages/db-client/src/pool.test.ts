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
});

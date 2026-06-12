import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';
// Side-effect import: registers pool-wide type parsers (e.g. NUMERIC → number)
// before any test pool executes queries.
import './pool.js';

export interface TestDb {
  pool: pg.Pool;
  url: string;
  stop: () => Promise<void>;
}

/**
 * Spin up an ephemeral PostGIS container, apply all repository SQL migrations
 * in numeric order, and return a ready-to-use pool. Use in beforeAll().
 */
export async function startTestDb(): Promise<TestDb> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    'postgis/postgis:16-3.4'
  ).start();
  const url = container.getConnectionUri();
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  // Mirror createPool's idle-client error guard (#1069). This pool is built
  // directly (not via createPool) to keep the integration harness's config —
  // no statement_timeout, max: 4 — but it is precisely the pool most exposed to
  // the flake: testcontainers tearing its container down can fire 'error' on an
  // idle client between suites. Without a listener that becomes an uncaught
  // exception that reds the whole `test` run. Log and swallow; pg evicts the
  // dead client.
  pool.on('error', (err) => {
    console.error(
      JSON.stringify({
        severity: 'ERROR',
        message: 'db_pool_idle_client_error',
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  });

  const migrationsDir = resolve(process.cwd(), '../../migrations');
  const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = readFileSync(join(migrationsDir, f), 'utf-8');
    // node-pg-migrate uses "-- Up Migration" / "-- Down Migration" markers.
    const [rawUpPart = ''] = sql.split(/-- Down Migration/i);
    const upPart = rawUpPart.replace(/-- Up Migration/i, '');
    if (upPart.trim()) {
      await pool.query(upPart);
    }
  }

  return {
    pool,
    url,
    stop: async () => {
      await pool.end();
      await container.stop();
    },
  };
}

import pg from 'pg';

// PostgreSQL NUMERIC (OID 1700) defaults to string to preserve arbitrary precision.
// None of our NUMERIC columns need that — species_meta.taxon_order is the only
// NUMERIC in the schema and it's a small integer-ish taxonomic ordering value.
// Parse to number so shared-types' number annotations are actually truthful.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v: string) => (v === null ? null : parseFloat(v)));

export interface PoolOptions {
  databaseUrl: string;
  key?: string;          // when set, pool is memoized by key
  max?: number;
  idleTimeoutMillis?: number;
  // Crash-hardening (#821): a per-statement server-side timeout and a
  // connection-acquisition timeout. The statement ceiling caps a runaway
  // query so it fails fast with a clean pg error (SQLSTATE 57014) instead of
  // holding the connection open until the read-api container OOM-kills. The
  // 15s default sits above the observed 6–13s legitimate slow-query runtimes
  // (ops-log-forensics report §3.3.1) and below the OOM path. Both are
  // optional so all existing callers keep compiling.
  statement_timeout?: number;
  connectionTimeoutMillis?: number;
}

const POOLS = new Map<string, pg.Pool>();

export function createPool(opts: PoolOptions): pg.Pool {
  if (opts.key && POOLS.has(opts.key)) {
    return POOLS.get(opts.key)!;
  }
  const pool = new pg.Pool({
    connectionString: opts.databaseUrl,
    max: opts.max ?? 5,
    idleTimeoutMillis: opts.idleTimeoutMillis ?? 30_000,
    statement_timeout: opts.statement_timeout ?? 15_000,
    connectionTimeoutMillis: opts.connectionTimeoutMillis ?? 10_000,
  });
  // An idle pooled client that hits a backend/network error emits 'error' on
  // the pool. node-postgres docs are explicit: without a pool-level listener,
  // that event becomes an uncaught exception and the node process exits
  // (#1069 — the `test` CI job flaked on exactly this, a pg-protocol parser
  // error parsed off an idle socket during testcontainers teardown; the same
  // gap would crash read-api/ingestor on any prod network blip). Log in the
  // repo's structured {severity, message, …} shape and swallow — pg will evict
  // and replace the dead client on its own; rethrowing would defeat the point.
  pool.on('error', (err) => {
    console.error(
      JSON.stringify({
        severity: 'ERROR',
        message: 'db_pool_idle_client_error',
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  });
  if (opts.key) POOLS.set(opts.key, pool);
  return pool;
}

export async function closePool(pool: pg.Pool): Promise<void> {
  for (const [key, p] of POOLS.entries()) {
    if (p === pool) POOLS.delete(key);
  }
  await pool.end();
}

export type Pool = pg.Pool;

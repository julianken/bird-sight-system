import pg from 'pg';

export interface PoolOptions {
  databaseUrl: string;
  key?: string;          // when set, pool is memoized by key
  max?: number;
  idleTimeoutMillis?: number;
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

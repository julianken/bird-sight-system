import { createPool, closePool } from '@bird-watch/db-client';
import { runIngest, type RunSummary } from './run-ingest.js';
import { runHotspotIngest, type RunHotspotSummary } from './run-hotspots.js';
import { runBackfill, type RunBackfillSummary } from './run-backfill.js';

export interface HandlerEnv {
  DATABASE_URL: string;
  EBIRD_API_KEY: string;
}

export type ScheduledKind = 'recent' | 'hotspots' | 'backfill';

/**
 * Platform-agnostic entry. Accepts `kind` and an env object; constructs a
 * pool, runs the appropriate flow, closes the pool, returns the summary.
 *
 * Cloudflare Worker wrapper (Plan 5) calls this from `scheduled()`.
 */
export async function handleScheduled(
  kind: ScheduledKind,
  env: HandlerEnv
): Promise<RunSummary | RunHotspotSummary | RunBackfillSummary> {
  const pool = createPool({ databaseUrl: env.DATABASE_URL });
  try {
    switch (kind) {
      case 'recent':
        return await runIngest({ pool, apiKey: env.EBIRD_API_KEY, regionCode: 'US-AZ' });
      case 'hotspots':
        return await runHotspotIngest({ pool, apiKey: env.EBIRD_API_KEY, regionCode: 'US-AZ' });
      case 'backfill':
        return await runBackfill({
          pool, apiKey: env.EBIRD_API_KEY, regionCode: 'US-AZ', days: 30,
        });
    }
  } finally {
    await closePool(pool);
  }
}

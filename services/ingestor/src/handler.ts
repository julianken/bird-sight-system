import { createPool, closePool } from '@bird-watch/db-client';
import { runIngest, type RunSummary } from './run-ingest.js';
import { runHotspotIngest, type RunHotspotSummary } from './run-hotspots.js';
import { runBackfill, type RunBackfillSummary } from './run-backfill.js';
import { runTaxonomy, type RunTaxonomySummary } from './run-taxonomy.js';

export interface HandlerEnv {
  DATABASE_URL: string;
  EBIRD_API_KEY: string;
}

export type ScheduledKind = 'recent' | 'hotspots' | 'backfill' | 'taxonomy';

/**
 * Platform-agnostic handler: invoked by the Cloud Run Job entry point
 * (Plan 5 — services/ingestor/cmd/cloud-run-job.ts). Returns a JSON-
 * serializable summary the platform-specific wrapper logs.
 */
export async function handleScheduled(
  kind: ScheduledKind,
  env: HandlerEnv
): Promise<RunSummary | RunHotspotSummary | RunBackfillSummary | RunTaxonomySummary> {
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
      case 'taxonomy':
        return await runTaxonomy({ pool, apiKey: env.EBIRD_API_KEY });
    }
  } finally {
    await closePool(pool);
  }
}

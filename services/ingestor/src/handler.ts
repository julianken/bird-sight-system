import { createPool, closePool } from '@bird-watch/db-client';
import { runIngest, type RunSummary } from './run-ingest.js';
import { runHotspotIngest, type RunHotspotSummary } from './run-hotspots.js';
import { runBackfill, type RunBackfillSummary } from './run-backfill.js';
import { runTaxonomy, type RunTaxonomySummary } from './run-taxonomy.js';
import { runPhotos, type RunPhotosSummary } from './run-photos.js';
import { runDescriptions, type RunDescriptionsSummary } from './run-descriptions.js';

export interface HandlerEnv {
  DATABASE_URL: string;
  EBIRD_API_KEY: string;
}

export type ScheduledKind =
  | 'recent'
  | 'hotspots'
  | 'backfill'
  | 'taxonomy'
  | 'photos'
  | 'descriptions';

/**
 * Platform-agnostic handler: invoked by the Cloud Run Job entry point
 * at `services/ingestor/src/cli.ts`. Returns a JSON-serializable summary
 * the platform-specific wrapper logs.
 */
export async function handleScheduled(
  kind: ScheduledKind,
  env: HandlerEnv
): Promise<
  | RunSummary
  | RunHotspotSummary
  | RunBackfillSummary
  | RunTaxonomySummary
  | RunPhotosSummary
  | RunDescriptionsSummary
> {
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
      case 'photos':
        // runPhotos's upstream is iNat (no eBird key needed). Wired via the
        // Cloud Run job + monthly Scheduler cron in task-8b (#327).
        return await runPhotos({ pool });
      case 'descriptions':
        // runDescriptions's upstreams are iNat + Wikipedia (no eBird key).
        // Wired via the dedicated Cloud Run job + daily Scheduler cron in #371.
        return await runDescriptions({ pool });
    }
  } finally {
    await closePool(pool);
  }
}

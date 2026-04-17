import {
  upsertObservations, startIngestRun, finishIngestRun, type Pool,
} from '@bird-watch/db-client';
import { EbirdClient } from './ebird/client.js';
import { toObservationInput } from './transform.js';

export interface RunBackfillOptions {
  pool: Pool;
  apiKey: string;
  regionCode: string;
  days: number;          // how many days back, e.g. 30
  today?: Date;          // injectable for tests
  client?: EbirdClient;
}

export interface RunBackfillSummary {
  status: 'success' | 'partial' | 'failure';
  fetched: number;
  upserted: number;
  daysProcessed: number;
  error?: string;
}

export async function runBackfill(o: RunBackfillOptions): Promise<RunBackfillSummary> {
  const client = o.client ?? new EbirdClient({ apiKey: o.apiKey });
  const runId = await startIngestRun(o.pool, 'backfill');
  const today = o.today ?? new Date();

  let totalFetched = 0;
  let totalUpserted = 0;
  let daysProcessed = 0;
  let firstError: string | undefined;

  for (let i = 1; i <= o.days; i++) {
    const date = new Date(today.getTime() - i * 24 * 3600 * 1000);
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth() + 1;
    const d = date.getUTCDate();
    try {
      const obs = await client.fetchHistoric(o.regionCode, y, m, d);
      const inputs = obs.map(eb => toObservationInput(eb, new Set()));
      const upserted = await upsertObservations(o.pool, inputs);
      totalFetched += obs.length;
      totalUpserted += upserted;
      daysProcessed++;
    } catch (err) {
      if (!firstError) firstError = err instanceof Error ? err.message : String(err);
    }
  }

  const status: RunBackfillSummary['status'] =
    daysProcessed === o.days ? 'success'
      : daysProcessed === 0 ? 'failure'
        : 'partial';

  await finishIngestRun(o.pool, runId, {
    status,
    obsFetched: totalFetched,
    obsUpserted: totalUpserted,
    ...(firstError !== undefined && { errorMessage: firstError }),
  });

  return {
    status, fetched: totalFetched, upserted: totalUpserted,
    daysProcessed,
    ...(firstError !== undefined && { error: firstError }),
  };
}

import {
  upsertObservations, startIngestRun, finishIngestRun, type Pool,
} from '@bird-watch/db-client';
import { EbirdClient } from './ebird/client.js';
import { toObservationInput, notableKeyset } from './transform.js';

export interface RunBackfillOptions {
  pool: Pool;
  apiKey: string;
  regionCode: string;
  days: number;          // how many days back, e.g. 30
  today?: Date;          // injectable for tests
  client?: EbirdClient;
  /**
   * Min millis between successive `client.fetchHistoric` calls. Defaults to 0
   * (no pacing) so the existing 30-day backfill is unaffected. The
   * `backfill-extended` 365-day kind in cli.ts passes 1000 to keep us under
   * eBird's rate limit on a long run. Mirrors the run-photos.ts pattern.
   */
  paceMs?: number;
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

  try {
    // eBird /recent/notable only accepts back=1..30. Cap at 30; observations
    // older than 30 days won't be flagged notable in this run (OR-coalesce in
    // upsertObservations preserves any previously-stamped true values).
    const notableBack = Math.min(o.days, 30);
    const notables = await client.fetchNotable(o.regionCode, { back: notableBack });
    const notableKeys = notableKeyset(notables);

    let firstCall = true;
    for (let i = 1; i <= o.days; i++) {
      const date = new Date(today.getTime() - i * 24 * 3600 * 1000);
      const y = date.getUTCFullYear();
      const m = date.getUTCMonth() + 1;
      const d = date.getUTCDate();
      try {
        // Pace successive eBird calls. Skip the wait before the first call;
        // otherwise a 365-day run sits idle for paceMs * 365 when paceMs *
        // (365 - 1) would do. Mirrors run-photos.ts:113-116.
        if (!firstCall && (o.paceMs ?? 0) > 0) await sleep(o.paceMs!);
        firstCall = false;
        const obs = await client.fetchHistoric(o.regionCode, y, m, d);
        const inputs = obs.map(eb => toObservationInput(eb, notableKeys));
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishIngestRun(o.pool, runId, {
      status: 'failure',
      obsFetched: totalFetched,
      obsUpserted: totalUpserted,
      errorMessage: message,
    });
    return {
      status: 'failure', fetched: totalFetched, upserted: totalUpserted,
      daysProcessed,
      error: message,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

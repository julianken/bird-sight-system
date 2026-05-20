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
  // 120s (not the 30s default) accommodates /historic slowness on high-density
  // states (CA/FL/TX/NY) where per-day responses regularly exceed 30s. The
  // /historic endpoint's only paging knob — maxResults — is already at the
  // 10000 API ceiling, so client-side timeout is the remaining lever. Scoped
  // to backfill so /recent and /hotspots keep their 30s failure-detection.
  const client = o.client ?? new EbirdClient({ apiKey: o.apiKey, requestTimeoutMs: 120_000 });
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
      const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      // Pace successive eBird calls. Skip the wait before the first call;
      // otherwise a 365-day run sits idle for paceMs * 365 when paceMs *
      // (365 - 1) would do. Mirrors run-photos.ts:113-116.
      if (!firstCall && (o.paceMs ?? 0) > 0) await sleep(o.paceMs!);
      firstCall = false;

      // Per-day diagnostic logging (issue #TBD): the prior single-catch
      // block hid which phase failed (fetch vs upsert) and produced no
      // per-day visibility — a long backfill that died early left only
      // `daysProcessed=0` in the run-completed summary. Split phases and
      // emit one compact structured line per day.
      let obs;
      try {
        obs = await client.fetchHistoric(o.regionCode, y, m, d);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(JSON.stringify({
          severity: 'WARNING',
          kind: 'backfill',
          message: 'bird_ingest_day_failed',
          state: o.regionCode,
          dayOffset: i,
          date: dateStr,
          phase: 'fetch',
          error: msg.slice(0, 500),
        }));
        if (!firstError) firstError = msg;
        continue;
      }
      try {
        const inputs = obs.map(eb => toObservationInput(eb, notableKeys));
        const upserted = await upsertObservations(o.pool, inputs);
        totalFetched += obs.length;
        totalUpserted += upserted;
        daysProcessed++;
        console.log(JSON.stringify({
          severity: 'INFO',
          kind: 'backfill',
          message: 'bird_ingest_day_succeeded',
          state: o.regionCode,
          dayOffset: i,
          date: dateStr,
          fetched: obs.length,
          upserted,
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(JSON.stringify({
          severity: 'WARNING',
          kind: 'backfill',
          message: 'bird_ingest_day_failed',
          state: o.regionCode,
          dayOffset: i,
          date: dateStr,
          phase: 'upsert',
          error: msg.slice(0, 500),
        }));
        if (!firstError) firstError = msg;
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

import {
  upsertObservations, startIngestRun, finishIngestRun, type Pool,
} from '@bird-watch/db-client';
import { EbirdClient } from './ebird/client.js';
import { toObservationInput, notableKeyset } from './transform.js';

export interface RunIngestOptions {
  pool: Pool;
  apiKey: string;
  regionCode: string;
  back?: number;
  /** Test hooks — used by retry tests. */
  maxRetries?: number;
  retryBaseMs?: number;
  /** Inject a client for tests; if omitted, one is constructed. */
  client?: EbirdClient;
}

export interface RunSummary {
  status: 'success' | 'failure';
  fetched: number;
  upserted: number;
  error?: string;
}

export async function runIngest(opts: RunIngestOptions): Promise<RunSummary> {
  const clientOpts: import('./ebird/client.js').EbirdClientOptions = {
    apiKey: opts.apiKey,
    ...(opts.maxRetries !== undefined && { maxRetries: opts.maxRetries }),
    ...(opts.retryBaseMs !== undefined && { retryBaseMs: opts.retryBaseMs }),
  };
  const client = opts.client ?? new EbirdClient(clientOpts);

  const runId = await startIngestRun(opts.pool, 'recent');
  try {
    const [recent, notable] = await Promise.all([
      client.fetchRecent(opts.regionCode, { back: opts.back ?? 14 }),
      client.fetchNotable(opts.regionCode, { back: opts.back ?? 14 }),
    ]);
    const notableKeys = notableKeyset(notable);
    const inputs = recent.map(o => toObservationInput(o, notableKeys));
    const upserted = await upsertObservations(opts.pool, inputs);

    await finishIngestRun(opts.pool, runId, {
      status: 'success',
      obsFetched: recent.length,
      obsUpserted: upserted,
    });

    return { status: 'success', fetched: recent.length, upserted };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishIngestRun(opts.pool, runId, {
      status: 'failure',
      errorMessage: msg,
    });
    return { status: 'failure', fetched: 0, upserted: 0, error: msg };
  }
}

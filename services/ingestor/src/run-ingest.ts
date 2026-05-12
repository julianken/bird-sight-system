import {
  upsertObservations, findMissingSpeciesMeta,
  startIngestRun, finishIngestRun, type Pool,
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

    // Invariant (issue #484): every observation we insert must have a
    // matching `species_meta` row, otherwise the read-api 404s on
    // /api/species/:code for a code the same API also returns from
    // /api/observations. The check runs BEFORE upsert so a leak aborts the
    // whole batch — converting future eBird hybrid/spuh additions to the AZ
    // feed into a loud CI/cron failure instead of a silent prod 404. The
    // error names every offending code so a triage agent can jump straight
    // to a `species_meta` backfill PR (see migration
    // 1700000032000_backfill_species_meta_spuh_hybrid.sql for the 10 codes
    // this fix unblocked).
    const speciesCodes = inputs.map(o => o.speciesCode);
    const missing = await findMissingSpeciesMeta(opts.pool, speciesCodes);
    if (missing.length > 0) {
      throw new Error(
        `ingest invariant violation: ${missing.length} observation species_code(s) ` +
        `have no species_meta row — refusing to insert observations the read-api ` +
        `cannot resolve. Missing codes: ${missing.join(', ')}. ` +
        `Fix: add species_meta rows for these codes (see issue #484 for the pattern).`
      );
    }

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

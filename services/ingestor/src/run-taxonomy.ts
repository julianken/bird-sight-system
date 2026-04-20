import {
  upsertSpeciesMeta, runReconcileStamping,
  startIngestRun, finishIngestRun,
  type Pool,
} from '@bird-watch/db-client';
import type { SpeciesMeta } from '@bird-watch/shared-types';
import { EbirdClient } from './ebird/client.js';
import type { EbirdTaxon } from './ebird/types.js';

export interface RunTaxonomyOptions {
  pool: Pool;
  apiKey: string;
  /** Test hooks — forwarded to EbirdClient. */
  maxRetries?: number;
  retryBaseMs?: number;
  /** Inject a client for tests; if omitted, one is constructed. */
  client?: EbirdClient;
  /** Upsert batch size. pg caps parameter count at ~65k; upsert uses 6 params
   *  per row so 500 = 3000 params per statement (well under the cap). */
  batchSize?: number;
}

export interface RunTaxonomySummary {
  status: 'success' | 'failure';
  totalFetched: number;
  speciesInserted: number;
  nonSpeciesFiltered: number;
  reconciled: number;
  error?: string;
}

const DEFAULT_BATCH_SIZE = 500;

export async function runTaxonomy(opts: RunTaxonomyOptions): Promise<RunTaxonomySummary> {
  const clientOpts: import('./ebird/client.js').EbirdClientOptions = {
    apiKey: opts.apiKey,
    ...(opts.maxRetries !== undefined && { maxRetries: opts.maxRetries }),
    ...(opts.retryBaseMs !== undefined && { retryBaseMs: opts.retryBaseMs }),
  };
  const client = opts.client ?? new EbirdClient(clientOpts);
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;

  const runId = await startIngestRun(opts.pool, 'taxonomy');
  try {
    const taxonomy = await client.fetchTaxonomy();
    const speciesOnly = taxonomy.filter(t => t.category === 'species');
    const nonSpeciesFiltered = taxonomy.length - speciesOnly.length;

    const inputs = speciesOnly.map(toSpeciesMeta);
    let speciesInserted = 0;
    for (let i = 0; i < inputs.length; i += batchSize) {
      const chunk = inputs.slice(i, i + batchSize);
      speciesInserted += await upsertSpeciesMeta(opts.pool, chunk);
    }

    // Fill silhouette_id / region_id on rows whose species_meta JOIN previously
    // found nothing. Idempotent — a no-op on subsequent runs once all rows are
    // stamped.
    const reconciled = await runReconcileStamping(opts.pool);

    await finishIngestRun(opts.pool, runId, {
      status: 'success',
      obsFetched: taxonomy.length,
      obsUpserted: speciesInserted,
    });

    return {
      status: 'success',
      totalFetched: taxonomy.length,
      speciesInserted,
      nonSpeciesFiltered,
      reconciled,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishIngestRun(opts.pool, runId, {
      status: 'failure',
      errorMessage: msg,
    });
    return {
      status: 'failure',
      totalFetched: 0,
      speciesInserted: 0,
      nonSpeciesFiltered: 0,
      reconciled: 0,
      error: msg,
    };
  }
}

/**
 * Maps eBird's taxonomy row to SpeciesMeta.
 *
 * family_code conventions: the `family_silhouettes` seed in migration
 * 1700000009000_seed_family_silhouettes.sql uses lowercased scientific family
 * names (e.g., 'tyrannidae') as the join key. eBird's own `familyCode` field
 * is different (e.g., 'tyrann1'), so we derive family_code from
 * `familySciName.toLowerCase()` to stay aligned with the silhouette schema.
 * Falls back to eBird's familyCode lowercased if familySciName is absent.
 *
 * family_name carries the human-readable English label
 * (`familyComName`, e.g. 'Tyrant Flycatchers').
 */
export function toSpeciesMeta(t: EbirdTaxon): SpeciesMeta {
  const familyCode = (t.familySciName ?? t.familyCode ?? '').toLowerCase();
  return {
    speciesCode: t.speciesCode,
    comName: t.comName,
    sciName: t.sciName,
    familyCode,
    familyName: t.familyComName ?? '',
    taxonOrder: typeof t.taxonOrder === 'number' ? t.taxonOrder : null,
  };
}

import {
  upsertSpeciesMeta, runReconcileStamping,
  startIngestRun, finishIngestRun,
  type Pool,
} from '@bird-watch/db-client';
import type { SpeciesMeta } from '@bird-watch/shared-types';
import { EbirdClient } from '../ebird/client.js';
import type { EbirdTaxon } from '../ebird/types.js';

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
  const clientOpts: import('../ebird/client.js').EbirdClientOptions = {
    apiKey: opts.apiKey,
    ...(opts.maxRetries !== undefined && { maxRetries: opts.maxRetries }),
    ...(opts.retryBaseMs !== undefined && { retryBaseMs: opts.retryBaseMs }),
  };
  const client = opts.client ?? new EbirdClient(clientOpts);
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;

  const runId = await startIngestRun(opts.pool, 'taxonomy');
  try {
    const taxonomy = await client.fetchTaxonomy();
    // eBird's category enum is a closed union of 7 values (see
    // `ebird/types.ts:42`). We keep all of them here so the monthly taxonomy
    // cron populates species_meta for hybrid/spuh/slash/domestic/form/issf
    // rows (not just true species). PR #484's species-only invariant
    // previously stalled production for 42h on a missing hybrid (`x00013`,
    // Bullock's x Baltimore Oriole); see issue #527 for the incident. The
    // allowlist shape is deliberate: if eBird invents an 8th category, it
    // falls through and is logged by the relaxed invariant in
    // `run-ingest.ts` (#527 PR-3, gated on #528) rather than silently
    // upserted with unknown semantics.
    const KEPT_CATEGORIES = new Set<EbirdTaxon['category']>([
      'species', 'issf', 'hybrid', 'spuh', 'slash', 'domestic', 'form',
    ]);
    const speciesOnly = taxonomy.filter(t => KEPT_CATEGORIES.has(t.category));
    const nonSpeciesFiltered = taxonomy.length - speciesOnly.length;

    const inputs = speciesOnly.map(toSpeciesMeta);
    let speciesInserted = 0;
    for (let i = 0; i < inputs.length; i += batchSize) {
      const chunk = inputs.slice(i, i + batchSize);
      speciesInserted += await upsertSpeciesMeta(opts.pool, chunk);
    }

    // Fill silhouette_id on rows whose species_meta JOIN previously found
    // nothing. Idempotent — a no-op on subsequent runs once all rows are
    // stamped. (region_id stamping was removed in #532 PR-1; the column
    // itself is dropped in PR-3.)
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

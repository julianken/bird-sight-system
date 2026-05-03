#!/usr/bin/env tsx
import { pathToFileURL } from 'node:url';
import {
  createPool as realCreatePool,
  closePool as realClosePool,
  type Pool,
} from '@bird-watch/db-client';
import { runIngest as realRunIngest, type RunSummary } from './run-ingest.js';
import {
  runHotspotIngest as realRunHotspotIngest,
  type RunHotspotSummary,
} from './run-hotspots.js';
import {
  runBackfill as realRunBackfill,
  type RunBackfillSummary,
} from './run-backfill.js';
import {
  runTaxonomy as realRunTaxonomy,
  type RunTaxonomySummary,
} from './run-taxonomy.js';
import {
  runPhotos as realRunPhotos,
  type RunPhotosSummary,
} from './run-photos.js';
import { fetchWikipediaSummary as realFetchWikipediaSummary } from './wikipedia/client.js';
import { fetchInatTaxon as realFetchInatTaxon } from './inat/taxon-client.js';

/**
 * Every run summary discriminates on `status`. `RunBackfillSummary` can also be
 * `'partial'`, which we intentionally treat as non-failure — the job made
 * forward progress and Cloud Run Jobs should see it as success.
 */
type AnyRunSummary =
  | RunSummary
  | RunHotspotSummary
  | RunBackfillSummary
  | RunTaxonomySummary
  | RunPhotosSummary;

/**
 * Injectable dependencies for `runCli`. In production `cli.ts`'s IIFE passes
 * the real pool/runner functions; tests pass stubs to drive specific branches
 * (including the silent-failure path that bit us in prod with PR #84).
 */
export interface CliDeps {
  createPool: (opts: { databaseUrl: string }) => Pool;
  closePool: (pool: Pool) => Promise<void>;
  runIngest: typeof realRunIngest;
  runHotspotIngest: typeof realRunHotspotIngest;
  runBackfill: typeof realRunBackfill;
  runTaxonomy: typeof realRunTaxonomy;
  runPhotos: typeof realRunPhotos;
  fetchWikipediaSummary: typeof realFetchWikipediaSummary;
  fetchInatTaxon: typeof realFetchInatTaxon;
}

/**
 * Executes one ingest run and returns without throwing for run-level failures.
 *
 * Sets `process.exitCode = 1` on `summary.status === 'failure'` so Cloud Run
 * Jobs record the job as failed. We do NOT call `process.exit(1)` — that would
 * kill the event loop before the `finally` block's `closePool(pool)` runs.
 * Setting `exitCode` lets the loop drain naturally and Node exits with that
 * code once the microtask queue is empty.
 *
 * Unknown-kind and missing-env errors still `throw`, matching the pre-fix
 * contract: those are programmer errors, not runner-level failures, and the
 * outer IIFE catches them to print a stack trace and exit 1.
 */
export async function runCli(kind: string, deps: CliDeps): Promise<void> {
  // Operator debug kinds that don't touch the DB or eBird short-circuit
  // ahead of the env guards below — that lets `probe-wiki` run from a
  // laptop without standing up `EBIRD_API_KEY`/`DATABASE_URL`. Same shape
  // as `probe-taxon` (sibling PR #369).
  if (kind === 'probe-wiki') {
    const title = process.argv[3];
    if (!title) throw new Error('probe-wiki requires a title argument');
    const summary = await deps.fetchWikipediaSummary(title);
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  // probe-taxon is an operator triage tool that hits iNat's /v1/taxa endpoint
  // directly — no DB, no eBird auth. Early-return ahead of the env guards so
  // an operator can `npx tsx services/ingestor/src/cli.ts probe-taxon "..."`
  // locally without setting EBIRD_API_KEY or DATABASE_URL in their shell.
  if (kind === 'probe-taxon') {
    const sciName = process.argv[3];
    if (!sciName) throw new Error('probe-taxon requires a binomial argument');
    const taxon = await deps.fetchInatTaxon(sciName);
    console.log(JSON.stringify(taxon, null, 2));
    return;
  }

  const apiKey = process.env.EBIRD_API_KEY;
  const dbUrl = process.env.DATABASE_URL;
  if (!apiKey) throw new Error('EBIRD_API_KEY not set');
  if (!dbUrl) throw new Error('DATABASE_URL not set');

  const pool = deps.createPool({ databaseUrl: dbUrl });
  try {
    let summary: AnyRunSummary;
    if (kind === 'recent') {
      summary = await deps.runIngest({ pool, apiKey, regionCode: 'US-AZ' });
    } else if (kind === 'hotspots') {
      summary = await deps.runHotspotIngest({ pool, apiKey, regionCode: 'US-AZ' });
    } else if (kind === 'backfill') {
      summary = await deps.runBackfill({ pool, apiKey, regionCode: 'US-AZ', days: 30 });
    } else if (kind === 'backfill-extended') {
      // 'backfill-extended': one-shot 365-day backfill at 1 rps; this is NOT
      // scheduled — it's an operator-triggered one-shot to populate historical
      // phenology data. See run-backfill.ts paceMs comment.
      //
      // Wall time is ~364s (paceMs=1000 between calls 2..365, plus per-call
      // fetch + upsert work). The shared `bird-ingestor` Cloud Run job has
      // `timeout = "300s"` — see infra/terraform/ingestor.tf:91 — so the
      // default execution will be killed by Cloud Run after ~300 days,
      // silently producing a partial backfill. Override the per-execution
      // timeout to 600s when invoking this kind:
      //
      //   gcloud run jobs execute bird-ingestor \
      //     --args=backfill-extended \
      //     --task-timeout=600s \
      //     --region=us-west1 --project=bird-maps-prod --wait
      //
      // The `--task-timeout` flag overrides the Terraform default for one
      // execution only and does not require a Terraform apply. Splitting into
      // two runs (days 1-180 then 181-365) is also acceptable, but the
      // override is cleaner.
      summary = await deps.runBackfill({
        pool, apiKey, regionCode: 'US-AZ', days: 365, paceMs: 1_000,
      });
    } else if (kind === 'taxonomy') {
      summary = await deps.runTaxonomy({ pool, apiKey });
    } else if (kind === 'photos') {
      summary = await deps.runPhotos({ pool });
    } else {
      throw new Error(`Unknown kind: ${kind}. Try recent | hotspots | backfill | backfill-extended | taxonomy | photos | probe-taxon | probe-wiki`);
    }
    console.log(JSON.stringify(summary, null, 2));
    if (summary.status === 'failure') {
      // Flag the process as failed without killing the loop mid-pool-close.
      process.exitCode = 1;
    }
  } finally {
    await deps.closePool(pool);
  }
}

// Only run the IIFE when invoked as a script, not when imported by tests.
// `import.meta.url` resolves to this file; `pathToFileURL(process.argv[1])`
// is the entry point the user ran. When they match, this is the CLI
// entrypoint. Using pathToFileURL is the canonical Node idiom and handles
// Windows paths correctly (vs. naively prefixing with `file://`).
const isEntrypoint = (() => {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return pathToFileURL(argv1).href === import.meta.url;
  } catch {
    return false;
  }
})();

if (isEntrypoint) {
  const KIND = process.argv[2] ?? 'recent';
  runCli(KIND, {
    createPool: realCreatePool,
    closePool: realClosePool,
    runIngest: realRunIngest,
    runHotspotIngest: realRunHotspotIngest,
    runBackfill: realRunBackfill,
    runTaxonomy: realRunTaxonomy,
    runPhotos: realRunPhotos,
    fetchWikipediaSummary: realFetchWikipediaSummary,
    fetchInatTaxon: realFetchInatTaxon,
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

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
    } else if (kind === 'taxonomy') {
      summary = await deps.runTaxonomy({ pool, apiKey });
    } else if (kind === 'photos') {
      summary = await deps.runPhotos({ pool });
    } else {
      throw new Error(`Unknown kind: ${kind}. Try recent | hotspots | backfill | taxonomy | photos`);
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
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

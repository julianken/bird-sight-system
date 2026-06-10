#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import { openDb, DEFAULT_DB_PATH } from './db.js';
import { sync, syncAll, scoreBatch } from './sources.js';
import {
  scorePrepare, scoreCommit, sourcePrepare, sourceCommit,
  type ScoreResult, type SourceResult,
} from './score-orchestration.js';
import { startServer } from './server/serve.js';
import { resolveAdminEnv, runApplySwaps } from './apply-swaps.js';

const API_BASE = process.env.READ_API_BASE ?? 'https://api.bird-maps.com';
const THUMB_DIR = process.env.THUMB_DIR ?? './thumb-cache';

/** Live thumbnail download for the prepare CLI (unit tests inject a stub). */
async function downloadBytes(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`download ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

const program = new Command();
program.name('photo-curate').description('Local bird-photo quality curation tool');

program
  .command('sync')
  .description('Snapshot live photos from prod read-api into photo_current (reviewed=0). Cheap, NO tokens — re-run to scan new photos.')
  .option('--species <code>', 'sync a single species code instead of the whole dictionary')
  .action(async (opts: { species?: string }) => {
    const db = openDb(DEFAULT_DB_PATH);
    // No `--species`: ONE call to /api/species/with-photos (#992), which returns
    // the ~715 observed-with-photos species in a single body — no per-species
    // detail walk. `--species <code>`: the single-species path via
    // /api/species/:code (unchanged).
    const summary = opts.species
      ? await sync(db, [opts.species], { apiBase: API_BASE })
      : await syncAll(db, { apiBase: API_BASE });
    console.log(`[sync] ${JSON.stringify(summary, null, 2)}`);
    console.log('[sync] Next: run the score-current workflow to AI-score the reviewed=0 rows (default 10, --limit up to 100).');
    db.close();
  });

program
  .command('score-prepare')
  .description('Select the next N reviewed=0 photos, download each, and write a manifest the score agents Read (Node half of the score Workflow — Bug 1, #992).')
  .option('--limit <n>', 'how many photos to prepare (clamped to [1,100])', '10')
  .action(async (opts: { limit: string }) => {
    const db = openDb(DEFAULT_DB_PATH);
    try {
      const limit = scoreBatch.clampLimit(Number(opts.limit));
      const result = await scorePrepare(db, limit, { download: downloadBytes, thumbDir: THUMB_DIR });
      console.log(`[score-prepare] picked ${result.picked} photo(s); manifest at ${result.manifestPath}`);
      // The manifest path on its own line so the Workflow's prepare agent can
      // grep it out of stdout and hand it to the parallel score agents.
      console.log(result.manifestPath);
    } finally {
      db.close();
    }
  });

program
  .command('score-commit')
  .description('Commit agent scoring results (composeReport → upsertScore + markReviewed) — Node half of the score Workflow (Bug 1, #992).')
  .argument('<results.json>', 'path to the agent results JSON: [{ speciesCode, criteria, flags, rationale }]')
  .action(async (resultsPath: string) => {
    const db = openDb(DEFAULT_DB_PATH);
    try {
      const results = JSON.parse(await readFile(resultsPath, 'utf8')) as ScoreResult[];
      const summary = await scoreCommit(db, results);
      console.log(`[score-commit] ${JSON.stringify(summary, null, 2)}`);
      // Non-zero exit when any result failed so a wrapping shell/Workflow step
      // can detect partial failure and re-run (idempotent — committed rows are
      // reviewed=1 and drop out of the next prepare).
      process.exit(summary.failed > 0 ? 1 : 0);
    } finally {
      db.close();
    }
  });

program
  .command('source-prepare')
  .description('Fetch + download a deep iNat candidate pool for FLAGGED species and write a manifest the source agents Read (Node half of the source-candidates Workflow — Bug 1, #992).')
  .option('--pool <n>', 'iNat candidates per flagged species', '15')
  .action(async (opts: { pool: string }) => {
    const db = openDb(DEFAULT_DB_PATH);
    try {
      const result = await sourcePrepare(db, Number(opts.pool), { download: downloadBytes, thumbDir: THUMB_DIR });
      console.log(`[source-prepare] sourced ${result.picked} candidate(s); manifest at ${result.manifestPath}`);
      console.log(result.manifestPath);
    } finally {
      db.close();
    }
  });

program
  .command('source-commit')
  .description('Commit agent candidate scores (composeReport → upsertScore role=candidate) — Node half of the source-candidates Workflow (Bug 1, #992).')
  .argument('<results.json>', 'path to the agent results JSON: [{ speciesCode, inatId, contentHash, criteria, flags, rationale }]')
  .action(async (resultsPath: string) => {
    const db = openDb(DEFAULT_DB_PATH);
    try {
      const results = JSON.parse(await readFile(resultsPath, 'utf8')) as SourceResult[];
      const summary = await sourceCommit(db, results);
      console.log(`[source-commit] ${JSON.stringify(summary, null, 2)}`);
      process.exit(summary.failed > 0 ? 1 : 0);
    } finally {
      db.close();
    }
  });

program
  .command('serve')
  .description('Start the local review server (default http://localhost:5180)')
  .option('--port <port>', 'port to bind', '5180')
  .option('--db <path>', 'review store path', DEFAULT_DB_PATH)
  .action((opts: { port: string; db: string }) => {
    // startServer opens the store via openDb and starts Express; the http server
    // holds the event loop open, so the process stays alive until Ctrl-C.
    startServer({ dbPath: opts.db, port: Number(opts.port) });
  });

program
  .command('apply-swaps')
  .description('Push approved photo_decision rows to the admin endpoint (confirm-gated)')
  .action(async () => {
    const env = resolveAdminEnv(process.env);
    if (!env.ok) {
      console.error(env.error);
      process.exit(2); // mirrors scripts/silhouette.mjs missing-env exit code
    }
    const db = openDb(DEFAULT_DB_PATH); // opens ./review.sqlite (Slice 4 helper)
    try {
      const result = await runApplySwaps({
        db,
        adminBase: env.adminBase,
        adminToken: env.adminToken,
        fetch: globalThis.fetch,
        log: line => console.log(line),
        confirm: async () => {
          const rl = createInterface({ input, output });
          try {
            const answer = await rl.question('Apply these swaps to PROD? [y/N] ');
            return /^y(es)?$/i.test(answer.trim());
          } finally {
            rl.close();
          }
        },
        now: () => new Date().toISOString(),
      });
      // Non-zero exit when any species failed, so a wrapping shell script / CI
      // step can detect partial failure and re-run (idempotent — applied rows
      // are skipped on the retry).
      process.exit(result.failed.length > 0 ? 1 : 0);
    } finally {
      db.close();
    }
  });

program.parseAsync(process.argv);

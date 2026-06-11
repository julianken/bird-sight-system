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
import {
  runLogRun, logRunExitCode, isIsoDate, LOG_RUN_EXIT, PRICE_TABLE, LEDGER_ISSUE,
  type LedgerInput, type Op, type AgentDesign, type YesNo, type JudgeModel, type TokenSplit,
} from './token-ledger.js';
import { ghLedgerDeps } from './gh-ledger.js';

const API_BASE = process.env.READ_API_BASE ?? 'https://api.bird-maps.com';
const THUMB_DIR = process.env.THUMB_DIR ?? './thumb-cache';
const LEDGER_REPO = process.env.LEDGER_REPO ?? 'julianken/bird-sight-system';

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
      console.log(`[score-prepare] judged ${result.picked} / gate-rejected ${result.gateRejected} / already-scored skipped ${result.skipped} — ${result.downloads} edge download(s); manifest at ${result.manifestPath}`);
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
  .option('--limit <n>', 'cap how many keep=0 species to source this run, worst-first (default: all)')
  .action(async (opts: { pool: string; limit?: string }) => {
    const db = openDb(DEFAULT_DB_PATH);
    try {
      // --limit caps the number of keep=0 species sourced (worst-first); omit for
      // all. Only set the opt when the flag was passed (exactOptionalPropertyTypes).
      const limitOpts = opts.limit !== undefined ? { limit: Number(opts.limit) } : {};
      const result = await sourcePrepare(
        db, Number(opts.pool), { download: downloadBytes, thumbDir: THUMB_DIR }, limitOpts,
      );
      console.log(`[source-prepare] sourced ${result.picked} candidate(s) — ${result.inatFetches} iNat fetch(es) + ${result.downloads} edge download(s); manifest at ${result.manifestPath}`);
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

program
  .command('log-run')
  .description(
    `Append one token-spend row to ledger issue #${LEDGER_ISSUE}. REQUIRED final step after every score / source-candidates / calibration run (#997). Computes scored, tokens/item, est_$ (blended 85/15 by default, exact when the four split flags are given, x0.5 with --batch), and $/item, then splices the row above the marker.`,
  )
  .requiredOption('--run-id <id>', 'Workflow run/task id (row identity + join key)')
  .requiredOption('--op <op>', 'score_batch | source_candidates | calibration')
  .requiredOption('--judge-model <model>', `exact judge model (one of: ${Object.keys(PRICE_TABLE).join(', ')})`)
  .requiredOption('--items-in <n>', 'photos submitted to the run')
  .requiredOption('--total-tokens <n>', 'aggregate tokens (Workflow subagent_tokens)')
  .requiredOption('--agents <n>', 'subagents spawned (Workflow agent_count)')
  .requiredOption('--tool-uses <n>', 'total tool invocations (Workflow tool_uses)')
  .requiredOption('--duration-ms <n>', 'wall-clock ms (Workflow duration_ms)')
  .option('--agent-design <design>', 'generic | lean_photo_judge', 'generic')
  .option('--prefilter <yesno>', 'yes | no — was the #994 deterministic gate run', 'no')
  .option('--gate-rejected <n>', 'photos auto-rejected by the pre-filter, never judged', '0')
  .option('--date <yyyy-mm-dd>', 'run date (UTC); defaults to today')
  .option('--batch', 'run used the Batch API (applies the 0.5x discount)')
  .option('--notes <text>', 'run context / what changed')
  .option('--input <n>', 'EXACT split: input tokens (requires all four split flags)')
  .option('--output <n>', 'EXACT split: output tokens')
  .option('--cache-read <n>', 'EXACT split: cache-read tokens')
  .option('--cache-create <n>', 'EXACT split: cache-creation (5m write) tokens')
  .option('--repo <owner/name>', 'ledger repo', LEDGER_REPO)
  .action(async (opts: Record<string, string | boolean | undefined>) => {
    const num = (v: string | boolean | undefined, name: string): number => {
      const n = Number(v);
      if (!Number.isFinite(n)) {
        console.error(`--${name} must be a number (got ${String(v)})`);
        process.exit(2);
      }
      return n;
    };
    const oneOf = <T extends string>(v: string, name: string, allowed: readonly T[]): T => {
      if (!allowed.includes(v as T)) {
        console.error(`--${name} must be one of: ${allowed.join(', ')} (got ${v})`);
        process.exit(2);
      }
      return v as T;
    };

    // Exact split is all-or-nothing — partial flags are an operator error.
    const splitKeys = ['input', 'output', 'cacheRead', 'cacheCreate'] as const;
    const splitGiven = splitKeys.filter(k => opts[k] !== undefined);
    let split: TokenSplit | undefined;
    if (splitGiven.length > 0 && splitGiven.length < 4) {
      console.error('--input/--output/--cache-read/--cache-create must be given together (all four) for an exact cost, or none.');
      process.exit(2);
    }
    if (splitGiven.length === 4) {
      split = {
        input: num(opts.input, 'input'),
        output: num(opts.output, 'output'),
        cacheRead: num(opts.cacheRead, 'cache-read'),
        cacheCreate: num(opts.cacheCreate, 'cache-create'),
      };
    }

    // --date is the only free-string operator input; validate the override so a
    // malformed value (`2026-13-40`, `june10`) never lands verbatim in the date
    // column. Omitted → today's UTC date. Exit 2 mirrors num()/oneOf().
    if (opts.date !== undefined && !isIsoDate(String(opts.date))) {
      console.error(
        `--date must be an ISO-8601 date (YYYY-MM-DD, optionally with time) (got ${String(opts.date)})`,
      );
      process.exit(LOG_RUN_EXIT.BAD_ARG);
    }

    const ledgerInput: LedgerInput = {
      runId: String(opts.runId),
      date: opts.date ? String(opts.date) : new Date().toISOString().slice(0, 10),
      op: oneOf(String(opts.op), 'op', ['score_batch', 'source_candidates', 'calibration'] as const) as Op,
      judgeModel: oneOf(String(opts.judgeModel), 'judge-model', Object.keys(PRICE_TABLE) as JudgeModel[]),
      agentDesign: oneOf(String(opts.agentDesign), 'agent-design', ['generic', 'lean_photo_judge'] as const) as AgentDesign,
      prefilter: oneOf(String(opts.prefilter), 'prefilter', ['yes', 'no'] as const) as YesNo,
      itemsIn: num(opts.itemsIn, 'items-in'),
      gateRejected: num(opts.gateRejected, 'gate-rejected'),
      agents: num(opts.agents, 'agents'),
      totalTokens: num(opts.totalTokens, 'total-tokens'),
      toolUses: num(opts.toolUses, 'tool-uses'),
      durationMs: num(opts.durationMs, 'duration-ms'),
      batch: opts.batch === true,
      split,
      notes: opts.notes ? String(opts.notes) : undefined,
    };

    const deps = ghLedgerDeps({ repo: String(opts.repo), log: line => console.log(`[log-run] ${line}`) });
    try {
      const result = await runLogRun(ledgerInput, deps);
      // Distinct exit codes so a wrapper can tell a benign already-logged
      // duplicate (3 — nothing more to do, safe) from a real write failure
      // (the catch below, 1 — nothing was recorded, must retry). See
      // LOG_RUN_EXIT for the full contract.
      const code = logRunExitCode(result);
      if (code === LOG_RUN_EXIT.DUPLICATE) {
        console.error(
          `[log-run] run "${ledgerInput.runId}" was already logged — nothing appended (exit ${LOG_RUN_EXIT.DUPLICATE}, safe to ignore).`,
        );
      }
      process.exit(code);
    } catch (err) {
      // A genuine failure — gh read/write error, missing append marker, etc.
      // Nothing was recorded; exit 1 signals the operator/wrapper must retry.
      console.error(`[log-run] ${err instanceof Error ? err.message : String(err)}`);
      console.error(`[log-run] nothing was recorded — retry (exit ${LOG_RUN_EXIT.FAILED}).`);
      process.exit(LOG_RUN_EXIT.FAILED);
    }
  });

program.parseAsync(process.argv);

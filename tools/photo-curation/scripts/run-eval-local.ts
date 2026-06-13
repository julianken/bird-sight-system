// ─────────────────────────────────────────────────────────────────────────────
// Standalone local eval runner (#1094) — replaces `bt eval eval/photo-judge.eval.ts`.
//
// Scores the INSTRUMENTED Gemini judge against the frozen Opus baseline (read
// from PROD `species_photo_scores`, pinned to (BASELINE_MODEL, BASELINE_RUBRIC))
// and writes the result to the LOCAL SQLite store (#1094) instead of a hosted
// Braintrust experiment:
//   • one `eval_result` per judgment (the candidate decision joined with the
//     Opus baseline + the per-call token/cost metrics from the sink), and
//   • one `eval_run` aggregate (keep-agreement, false-keep/replace, score-MAE,
//     total cost) computed via the pure scorers (src/eval/scorers.ts).
//
// Rows run SERIALLY (one at a time) — the proven-good pacing. A concurrent loop
// degraded the thinking-heavy models in the last sweep (77–96/150 rows,
// agreement 61–67% vs 78% serial), so the loop is a plain `for await`, NEVER
// parallelized (#1094).
//
// The judge is obtained through `resolveJudge` — the ONLY public way to build a
// judge (#1012); there is no uninstrumented scoring path. The sink it emits to
// is the join point: each `JudgmentRecord` is paired with the row's `expected`
// Opus baseline + the run id and written as one `eval_result`.
//
// UNIT CONTRACT (#1094, load-bearing for #1095's gate): `eval_run.agreement` and
// `score_mae` are stored as 0–1 FRACTIONS — the mean of the per-row scorer
// scores (each already in [0,1]). PR2 renders ×100 and gates at >= 0.90.
//
// This file lives OUTSIDE src/ (the tool's tsconfig is rootDir:src), so it is
// not part of the tsc build. `tsx` runs it via the `eval` npm-script. Its
// testable core (`runEvalLocal`) is covered by run-eval-local.test.ts with a
// fake judge + fake readImage + an in-memory db (no network, no real DB).
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import type Database from 'better-sqlite3';
import type { ImageInput, VisionJudge } from '@bird-watch/photo-quality';
import { createPool, closePool, getPhotoScores } from '@bird-watch/db-client';
import { openDb } from '../src/db.js';
import { buildEvalRows, resolveBaselinePin, type EvalRow } from '../src/eval/build-dataset.js';
import { resolveJudge, type JudgmentRecord, type JudgmentSink } from '../src/judges/index.js';
import { keepAgreement, scoreMAE, keepConfusion } from '../src/eval/scorers.js';
import { runRow } from '../src/eval/run-row.js';
import { mimeFromUrl } from '../src/sources.js';
import { insertEvalResult, insertEvalRun, type EvalResultRecord } from '../src/eval/store.js';
import { judgePromptForRubricVersion, resolveEvalModel } from '../eval/rubric-prompts.js';

/** The injected collaborators `runEvalLocal` needs — all fakeable in tests. */
export interface RunEvalDeps {
  /** The open review store the run writes `eval_result` + `eval_run` to. */
  db: Database.Database;
  /** The dataset rows (built from the pinned baseline, hash-verified). */
  rows: EvalRow[];
  /** The run id (e.g. `<model>-<unix>`) — the `eval_run.id` / `eval_result.run_id`. */
  runId: string;
  /** The judge model evaluated (recorded on `eval_run.model`). */
  model: string;
  /** The frozen-baseline model pin (recorded on `eval_run.baseline_model`). */
  baselineModel: string;
  /** The frozen-baseline rubric pin (recorded on `eval_run.baseline_rubric`). */
  baselineRubric: string;
  /** The EVAL_SAMPLE the dataset was built with (recorded on `eval_run.sample_size`). */
  sampleSize: number;
  /** ISO timestamp the run started at. */
  startedAt: string;
  /** The rubric prompt handed to the judge (pinned to the baseline's version). */
  prompt: string;
  /** Reads a LOCAL image path into an `ImageInput` (buffer + mime). */
  readImage: (readPath: string) => ImageInput;
  /**
   * Build the INSTRUMENTED judge around the run's sink. Called once; the sink
   * captures each judgment's record so the runner can join it with the row's
   * Opus baseline. In production this is `(sink) => resolveJudge(env, {…, sink})`.
   */
  makeJudge: (sink: JudgmentSink) => VisionJudge;
}

/**
 * Run the eval SERIALLY and write the local store. For each row, in order:
 *   1. `runRow` invokes the instrumented judge → its sink captures one
 *      `JudgmentRecord` (output + tokens + cost),
 *   2. the record is joined with the row's `expected` Opus baseline + `runId`
 *      and written as one `eval_result`,
 *   3. the per-row scorer scores (keepAgreement, scoreMAE, keepConfusion) are
 *      accumulated.
 * After the loop, the aggregates are written as one `eval_run` — agreement and
 * scoreMae as 0–1 FRACTIONS (means of the per-row scores), the confusion counts
 * summed, and total cost summed over the priced judgments.
 */
export async function runEvalLocal(deps: RunEvalDeps): Promise<void> {
  const { db, rows, runId, model, baselineModel, baselineRubric, sampleSize, startedAt, prompt } = deps;

  // The sink appends each judgment's record; the loop reads the one emitted by
  // the row it just ran (the judge emits exactly once per resolved judgment, so
  // exactly one record is appended per `runRow`). Appending to an array — rather
  // than reassigning a `let` to `undefined` each iteration — keeps TS's
  // control-flow analysis from narrowing the closure-mutated value to `never`.
  const emitted: JudgmentRecord[] = [];
  const sink: JudgmentSink = (record) => {
    emitted.push(record);
  };
  const judge = deps.makeJudge(sink);

  let agreementSum = 0;
  let maeSum = 0;
  let falseKeep = 0;
  let falseReplace = 0;
  let totalCost = 0;

  // SERIAL loop — one judgment at a time. Do NOT replace with Promise.all /
  // a concurrency pool (#1094): concurrency degraded the thinking models.
  for (const row of rows) {
    const before = emitted.length;
    const output = await runRow({ judge, readImage: deps.readImage, prompt }, row.input);
    const record = emitted[emitted.length - 1];
    if (emitted.length !== before + 1 || record === undefined) {
      // Defensive: the instrumented judge emits once per resolved judgment, so
      // this is unreachable in practice — but never write a half-row.
      throw new Error(`[run-eval-local] no judgment record captured for ${row.input.speciesCode}`);
    }

    const scorerArgs = { output, expected: row.expected };
    const keep = keepAgreement(scorerArgs).score; // 0 or 1
    const mae = scoreMAE(scorerArgs).score; // [0,1]
    const confusion = keepConfusion(scorerArgs).metadata;
    agreementSum += keep;
    maeSum += mae;
    falseKeep += confusion.falseKeep;
    falseReplace += confusion.falseReplace;
    if (record.estimatedCost !== undefined) totalCost += record.estimatedCost;

    const result: EvalResultRecord = {
      runId,
      speciesCode: row.input.speciesCode,
      comName: row.input.comName,
      contentHash: row.metadata.contentHash,
      sourceUrl: row.input.imageUrl,
      geminiKeep: output.keep,
      geminiQuality: output.qualityScore,
      geminiCriteriaJson: JSON.stringify(output.criteria),
      opusKeep: row.expected.keep,
      opusQuality: row.expected.qualityScore,
      cost: record.estimatedCost,
      promptTokens: record.promptTokens,
      completionTokens: record.completionTokens,
    };
    insertEvalResult(db, result);
  }

  const n = rows.length;
  insertEvalRun(db, {
    id: runId,
    model,
    baselineModel,
    baselineRubric,
    sampleSize,
    startedAt,
    // 0–1 fractions (means of the per-row scores) — NOT percents (#1094).
    agreement: n === 0 ? 0 : agreementSum / n,
    falseKeep,
    falseReplace,
    scoreMae: n === 0 ? 0 : maeSum / n,
    totalCost,
  });
}

/** Fail loud on a missing required env var — never run the eval half-configured. */
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`${name} is required to run the photo-judge eval (see docs/runbooks/photo-judge-eval.md)`);
  }
  return v;
}

/** Parse `--first N` (a smoke cap) from argv; returns undefined when absent. */
function parseFirst(argv: string[]): number | undefined {
  const i = argv.indexOf('--first');
  if (i === -1) return undefined;
  const n = Number(argv[i + 1]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

/**
 * Read a cached thumbnail into an ImageInput; mime is derived from the LOCAL
 * path's extension. Deliberately does NOT set `sourceUrl` (#1067): `runRow`
 * sets it to the row's portable R2 `imageUrl`.
 */
function readImage(readPath: string): ImageInput {
  return { buffer: readFileSync(readPath), mime: mimeFromUrl(readPath) };
}

/** CLI entry: build the dataset from the pinned prod baseline, then run + persist. */
async function main(argv: string[]): Promise<void> {
  const REVIEW_DB = requireEnv('REVIEW_DB');
  const THUMB_DIR = requireEnv('THUMB_DIR');
  // PROD baseline connection (#1073). A READ-ONLY connection string suffices.
  const DATABASE_URL = requireEnv('DATABASE_URL');
  const EVAL_SAMPLE = Number(process.env.EVAL_SAMPLE ?? 150);
  const EVAL_MODEL = resolveEvalModel(process.env);
  const BASELINE_PIN = resolveBaselinePin(process.env);

  const db = openDb(REVIEW_DB);

  // Eager build (#1037/#1073): reads the pinned baseline from PROD and hash-
  // verifies each local image against it. Hard-fails on a mixed/unknown rubric
  // version or an empty baseline before any judge construction or Gemini call.
  const pool = createPool({ databaseUrl: DATABASE_URL, max: 1 });
  let rows = await buildEvalRows(db, {
    thumbDir: THUMB_DIR,
    sample: EVAL_SAMPLE,
    getScores: () => getPhotoScores(pool, BASELINE_PIN),
  }).finally(() => closePool(pool));

  // Optional `--first N` smoke cap, applied AFTER the deterministic sample.
  const first = parseFirst(argv);
  if (first !== undefined) rows = rows.slice(0, first);

  if (rows.length === 0) {
    throw new Error('[run-eval-local] no eval rows after build — nothing to score (check the baseline pin + thumb cache)');
  }

  // The pinned rubric version (single, asserted by the builder) drives the prompt.
  const pinnedRubricVersion = rows[0]!.metadata.expectedRubricVersion;
  const prompt = judgePromptForRubricVersion(pinnedRubricVersion);

  const startedAt = new Date().toISOString();
  const runId = `${EVAL_MODEL}-${Math.floor(Date.now() / 1000)}`;

  // The judge is built ONCE around the run's sink (a single shared Pacer — see
  // gemini.ts; one per row would reset the GEMINI_PACE_MS gate, #1015 review).
  await runEvalLocal({
    db,
    rows,
    runId,
    model: EVAL_MODEL,
    baselineModel: BASELINE_PIN.model,
    baselineRubric: BASELINE_PIN.rubricVersion,
    sampleSize: EVAL_SAMPLE,
    startedAt,
    prompt,
    readImage,
    makeJudge: (sink) =>
      resolveJudge(process.env, { model: EVAL_MODEL, rubricVersion: pinnedRubricVersion, sink }),
  });

  const run = db.prepare(`SELECT agreement, false_keep, false_replace, score_mae, total_cost FROM eval_run WHERE id = ?`).get(runId) as {
    agreement: number; false_keep: number; false_replace: number; score_mae: number; total_cost: number;
  };
  db.close();

  console.log(`eval run ${runId} (${rows.length} rows) written to ${REVIEW_DB}`);
  console.log(`  agreement     ${(run.agreement * 100).toFixed(2)}%  (stored as fraction ${run.agreement})`);
  console.log(`  falseKeep     ${run.false_keep}   falseReplace ${run.false_replace}`);
  console.log(`  score MAE     ${run.score_mae.toFixed(4)} (fraction)`);
  console.log(`  total cost    $${run.total_cost.toFixed(4)}`);
  console.log(`  analyze with: npm run analyze -w @bird-watch/photo-curation ${runId}`);
}

// Run only when invoked directly (tsx scripts/run-eval-local.ts …), never on import.
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Standalone local eval runner (#1094) — replaces `bt eval eval/photo-judge.eval.ts`.
//
// Scores the INSTRUMENTED Gemini judge against the frozen Opus baseline (read
// from PROD `species_photo_scores`, pinned to (BASELINE_MODEL, BASELINE_RUBRIC))
// and writes the result to the LOCAL @bird-watch/eleatic store (E7/E8,
// #1150/#1151) — the eleatic `eval.sqlite` is the SOLE eval store now (the
// bespoke #1094 `eval_run`/`eval_result` review-store write was retired in E8):
//   • one eleatic eval row per judgment (the candidate decision joined with the
//     Opus baseline + the per-call token/cost metrics from the sink), and
//   • one eleatic eval run header (keep-agreement, false-keep/replace, score-MAE,
//     total cost) computed via the pure scorers (src/eval/scorers.ts) and patched
//     in via `finalizeRun`.
//
// Rows run SERIALLY (one at a time) — the proven-good pacing. A concurrent loop
// degraded the thinking-heavy models in the last sweep (77–96/150 rows,
// agreement 61–67% vs 78% serial), so the loop is a plain `for await`, NEVER
// parallelized (#1094).
//
// The judge is obtained through `resolveJudge` — the ONLY public way to build a
// judge (#1012); there is no uninstrumented scoring path. The sink it emits to
// is the join point: each `JudgmentRecord` is paired with the row's `expected`
// Opus baseline + the run id and recorded as one eleatic eval row.
//
// REVIEW_DB (the review.sqlite review store) is STILL opened here — but only to
// BUILD the dataset: `buildEvalRows` reads `photo_current` / `photo_score` from
// it. Those tables stay; only the eval_* tables were removed. The eval results
// themselves are written exclusively to the eleatic store.
//
// UNIT CONTRACT (#1094, load-bearing for the gate): the run's `agreement` and
// `scoreMae` are stored as 0–1 FRACTIONS — the mean of the per-row scorer scores
// (each already in [0,1]). The viewer renders ×100 and gates at >= 0.90.
//
// This file lives OUTSIDE src/ (the tool's tsconfig is rootDir:src), so it is
// not part of the tsc build. `tsx` runs it via the `eval` npm-script. Its
// testable core (`runEvalLocal`) is covered by run-eval-local.test.ts with a
// fake judge + fake readImage + an in-memory eleatic store (no network, no real DB).
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import type { ImageInput, VisionJudge } from '@bird-watch/photo-quality';
import { createPool, closePool, getPhotoScores } from '@bird-watch/db-client';
import { openDb } from '../src/db.js';
import { buildEvalRows, resolveBaselinePin, type EvalRow } from '../src/eval/build-dataset.js';
import { resolveJudge, type JudgmentRecord, type JudgmentSink } from '../src/judges/index.js';
import { keepAgreement, scoreMAE, keepConfusion } from '../src/eval/scorers.js';
import { runRow } from '../src/eval/run-row.js';
import { mimeFromUrl } from '../src/sources.js';
// All eleatic access goes through the adapter — the single domain seam (#1150).
// The photo-judge domain records (`EvalResultRecord`) also live there now (E8,
// #1151, after the bespoke src/eval/store.ts was retired).
import {
  openStore, makeReader, toEleaticRow, toEleaticRun,
  type EleaticStore, type EvalResultRecord,
} from '../src/eval/eleatic-adapter.js';
import { judgePromptForRubricVersion, resolveEvalModel } from '../eval/rubric-prompts.js';

/** The injected collaborators `runEvalLocal` needs — all fakeable in tests. */
export interface RunEvalDeps {
  /**
   * The open eleatic store the run writes each eval row + the run header to —
   * the SOLE eval store (E7/E8, #1150/#1151). Written via the eleatic-adapter.
   * `:memory:` in tests.
   *
   * NOTE: the review-store handle (`db`) is no longer a dep — `runEvalLocal`
   * never touched it after the eval write moved entirely to eleatic (E8, #1151).
   * `main` still opens the review store locally to BUILD the dataset
   * (`buildEvalRows`), but that handle is not handed to `runEvalLocal`.
   */
  eleatic: EleaticStore;
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
 * Run the eval SERIALLY and write the eleatic store. For each row, in order:
 *   1. `runRow` invokes the instrumented judge → its sink captures one
 *      `JudgmentRecord` (output + tokens + cost),
 *   2. the record is joined with the row's `expected` Opus baseline + `runId`
 *      and recorded as one eleatic eval row,
 *   3. the per-row scorer scores (keepAgreement, scoreMAE, keepConfusion) are
 *      accumulated.
 * After the loop, the aggregates are patched onto the run header via
 * `finalizeRun` — agreement and scoreMae as 0–1 FRACTIONS (means of the per-row
 * scores), the confusion counts summed, and total cost summed over the priced
 * judgments.
 */
export async function runEvalLocal(deps: RunEvalDeps): Promise<void> {
  const { eleatic, rows, runId, model, baselineModel, baselineRubric, sampleSize, startedAt, prompt } = deps;

  // Write the eleatic run HEADER before any child row (E7, #1150). eval_row has
  // a `run_id REFERENCES eval_run(id)` FK with `foreign_keys = ON`, so a row
  // inserted before its run would throw. The header carries identity + config +
  // startedAt now; `finalizeRun` patches the aggregate metrics after the loop
  // (the runner computes them late, exactly the finalize seam's purpose).
  eleatic.recordRun(
    toEleaticRun({
      id: runId,
      model,
      baselineModel,
      baselineRubric,
      sampleSize,
      startedAt,
      // Placeholder aggregates — overwritten by finalizeRun below. Stored as the
      // same 0–1 fraction units the runner uses (#1094); these are never read.
      agreement: 0,
      falseKeep: 0,
      falseReplace: 0,
      scoreMae: 0,
      totalCost: 0,
    }),
  );

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
    // Record the judgment to the eleatic store via the adapter — the SOLE eval
    // store (E8, #1151). Written serially, one row per `runRow`, so the SERIAL
    // loop invariant (#1094) is preserved and a mid-run crash leaves the store
    // at exactly the rows already scored.
    eleatic.recordRow(toEleaticRow(result));
  }

  const n = rows.length;
  const run = {
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
  };
  // Patch the eleatic run header's aggregates now they are computed. finalizeRun
  // writes row_count + metrics_json; the metrics are the 0–1 fractions the runner
  // computed (toEleaticRun maps them through unchanged, #1094).
  // `toEleaticRun` always sets `metrics`, but the field is optional on the
  // record type; `?? {}` keeps exactOptionalPropertyTypes happy without ever
  // hitting the fallback in practice.
  eleatic.finalizeRun(runId, { rowCount: n, metrics: toEleaticRun(run).metrics ?? {} });
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
  // The eleatic store the run is ADDITIVELY mirrored to (E7, #1150). Defaults to
  // ./eval.sqlite alongside REVIEW_DB; the analyzer reads it back.
  const EVAL_DB = process.env.EVAL_DB ?? './eval.sqlite';
  const EVAL_SAMPLE = Number(process.env.EVAL_SAMPLE ?? 150);
  const EVAL_MODEL = resolveEvalModel(process.env);
  const BASELINE_PIN = resolveBaselinePin(process.env);

  const db = openDb(REVIEW_DB);
  const eleatic = openStore(EVAL_DB);

  // Close BOTH stores on BOTH the success and error paths (#1108). `db` +
  // `eleatic` are opened inside main (unlike the sibling analyze-experiment.ts,
  // which opens at the entry block and closes in both .then/.catch), so a
  // try/finally here is the clean mirror of that close-on-both contract.
  try {
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
      eleatic,
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

    // Read the run header back from the eleatic store for the summary (the run's
    // SOLE store now, E8 #1151). `metrics` carries the 0–1 fractions written by
    // toEleaticRun; the keys mirror the run record (agreement/falseKeep/…).
    const stored = makeReader(eleatic.db).getRun(runId);
    const m = stored?.metrics ?? {};
    const agreement = m.agreement ?? 0;

    console.log(`eval run ${runId} (${rows.length} rows) written to ${EVAL_DB}`);
    console.log(`  agreement     ${(agreement * 100).toFixed(2)}%  (stored as fraction ${agreement})`);
    console.log(`  falseKeep     ${m.falseKeep ?? 0}   falseReplace ${m.falseReplace ?? 0}`);
    console.log(`  score MAE     ${(m.scoreMae ?? 0).toFixed(4)} (fraction)`);
    console.log(`  total cost    $${(m.totalCost ?? 0).toFixed(4)}`);
    console.log(`  analyze with: npm run analyze -w @bird-watch/photo-curation ${runId}`);
  } finally {
    db.close();
    eleatic.close();
  }
}

// Run only when invoked directly (tsx scripts/run-eval-local.ts …), never on import.
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

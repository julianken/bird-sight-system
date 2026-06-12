// ─────────────────────────────────────────────────────────────────────────────
// Braintrust eval entry (C5, #1015; part of #1010) — run via `bt eval`.
//
// Scores the TRACED Gemini judge against the Opus 902-score proxy baseline in
// review.sqlite, reporting the #969 calibration metrics (keep-agreement %,
// score-MAE, keep-confusion) as a `bird-maps` Braintrust EXPERIMENT.
//
//   data  — buildEvalRows(openDb(REVIEW_DB), {thumbDir, sample}) (#1013), the
//           stratified Opus-current rows: each {input:{imagePath,species…},
//           expected:{keep,qualityScore}}.
//   task  — runRow({judge, readImage, prompt}, input) (this PR's run-row.ts).
//           Braintrust calls task(input, hooks): the FIRST positional arg IS the
//           row's `input` value, so we write `task: (input) => …`, NOT
//           `({input})` (which would read a nonexistent `.input` → undefined).
//   scores— keepAgreement / scoreMAE / keepConfusion (#1014).
//
// The judge is obtained through `resolveTracedJudge` — the ONLY public way to
// build a judge (#1012); there is no un-traced scoring path. Because the wrapper
// opens its span via the bare ambient `braintrust` `traced` (not an
// initLogger-bound one), each per-judgment span NESTS UNDER this experiment's
// trace rather than landing in the project Logs stream (verified via context7,
// 2026-06-11: `traced` parents to the active span → experiment → logger).
//
// This file lives OUTSIDE src/ (the tool's tsconfig is rootDir:src), so it is
// not part of the tsc build and not a vitest target; `bt eval` runs it directly.
// Its testable core — the row→judge mapping — is covered by src/eval/run-row.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { Eval } from 'braintrust';
import { defaultRubricConfig, type ImageInput } from '@bird-watch/photo-quality';
import { openDb } from '../src/db.js';
import { buildEvalRows } from '../src/eval/build-dataset.js';
import { resolveTracedJudge } from '../src/judges/index.js';
import { keepAgreement, scoreMAE, keepConfusion } from '../src/eval/scorers.js';
import { runRow } from '../src/eval/run-row.js';
import { mimeFromUrl } from '../src/sources.js';

/** Fail loud on a missing required env var — never run the eval half-configured. */
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`${name} is required to run the photo-judge eval (see docs/runbooks/photo-judge-eval.md)`);
  }
  return v;
}

const REVIEW_DB = requireEnv('REVIEW_DB');
const THUMB_DIR = requireEnv('THUMB_DIR');
const EVAL_SAMPLE = Number(process.env.EVAL_SAMPLE ?? 150);

/** Read a cached thumbnail into an ImageInput; mime is derived from the path's extension. */
function readImage(imagePath: string): ImageInput {
  return { buffer: readFileSync(imagePath), mime: mimeFromUrl(imagePath), sourceUrl: imagePath };
}

Eval('bird-maps', {
  data: () => buildEvalRows(openDb(REVIEW_DB), { thumbDir: THUMB_DIR, sample: EVAL_SAMPLE }),
  // Braintrust calls task(input, hooks) — the first positional arg is the row's
  // `input` value. resolveTracedJudge fails loud on a missing GEMINI/BRAINTRUST key.
  task: (input) =>
    runRow(
      {
        judge: resolveTracedJudge(process.env, { project: 'bird-maps', model: 'gemini-2.5-flash' }),
        readImage,
        prompt: defaultRubricConfig.judgePrompt,
      },
      input,
    ),
  scores: [keepAgreement, scoreMAE, keepConfusion],
});

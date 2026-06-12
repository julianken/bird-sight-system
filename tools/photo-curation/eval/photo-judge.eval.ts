// ─────────────────────────────────────────────────────────────────────────────
// Braintrust eval entry (C5, #1015; part of #1010) — run via `bt eval`.
//
// Scores the TRACED Gemini judge against the Opus 902-score proxy baseline in
// review.sqlite, reporting the #969 calibration metrics (keep-agreement %,
// score-MAE, keep-confusion) as a `bird-maps` Braintrust EXPERIMENT.
//
//   data  — buildEvalRows(openDb(REVIEW_DB), {thumbDir, sample}) (#1013), the
//           stratified Opus-current rows: each {input:{readPath,imageUrl,
//           species…}, expected:{keep,qualityScore,criteria?},
//           metadata:{contentHash,…,expectedRubricVersion}}. readPath is the
//           LOCAL byte source; imageUrl is the portable R2 URL logged as the
//           span sourceUrl (#1067). Det-gate rows are excluded and the
//           single-rubric-version invariant is asserted inside the builder (#1037).
//   task  — runRow({judge, readImage, prompt}, input) (run-row.ts).
//           Braintrust calls task(input, hooks): the FIRST positional arg IS the
//           row's `input` value, so we write `task: (input) => …`, NOT
//           `({input})` (which would read a nonexistent `.input` → undefined).
//   scores— keepAgreement / scoreMAE / keepConfusion (#1014) + criteriaAxisMAE
//           (#1067; 7 per-axis `criteria_mae_<axis>` columns).
//
// COMPARABILITY (#1037): the judge prompt is PINNED to the baseline's recorded
// rubric_version — the rubric version is part of the dataset, not the live
// code. The dataset is built EAGERLY at module load so (a) a mixed/unknown
// version fails before any Gemini call is even possible, and (b) the pinned
// version is known in time to select the prompt and to stamp the experiment
// metadata at Eval() registration. That build needs only REVIEW_DB/THUMB_DIR
// (already import-time requirements) — local sqlite + readdir, no network and
// no API keys, so `bt eval --list` still works keyless. EVAL_MODEL picks the
// judge model (default gemini-2.5-flash): same dataset + same pinned rubric +
// different model = directly comparable experiments.
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
// Its testable cores are covered next door: the row→judge mapping by
// src/eval/run-row.test.ts, the dataset invariants by
// src/eval/build-dataset.test.ts, and the prompt pin + model knob by
// eval/rubric-prompts.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { Eval } from 'braintrust';
import type { ImageInput, VisionJudge } from '@bird-watch/photo-quality';
import { openDb } from '../src/db.js';
import { buildEvalRows } from '../src/eval/build-dataset.js';
import { resolveTracedJudge } from '../src/judges/index.js';
import { keepAgreement, scoreMAE, keepConfusion, criteriaAxisMAE } from '../src/eval/scorers.js';
import { runRow } from '../src/eval/run-row.js';
import { mimeFromUrl } from '../src/sources.js';
import { judgePromptForRubricVersion, resolveEvalModel } from './rubric-prompts.js';

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
const EVAL_MODEL = resolveEvalModel(process.env);

// Eager build (#1037): hard-fails here on a mixed/unknown rubric_version or an
// empty baseline — before any judge construction, prompt selection, or network.
const rows = buildEvalRows(openDb(REVIEW_DB), { thumbDir: THUMB_DIR, sample: EVAL_SAMPLE });

// Non-empty + single-version are guaranteed by the builder's assertions, so
// row 0 carries THE baseline version. The prompt pin follows it: judging a
// v0.2.1 baseline uses the frozen v0.2.1 prompt even when the live config has
// moved on — and an unknown version throws rather than judging under drift.
const PINNED_RUBRIC_VERSION = rows[0]!.metadata.expectedRubricVersion;
const JUDGE_PROMPT = judgePromptForRubricVersion(PINNED_RUBRIC_VERSION);

/**
 * Read a cached thumbnail into an ImageInput; mime is derived from the LOCAL
 * path's extension. Deliberately does NOT set `sourceUrl` (#1067): `runRow`
 * sets it to the row's portable R2 `imageUrl`, so the span logs the live
 * bird-maps.com photo, not this non-portable local cache path.
 */
function readImage(readPath: string): ImageInput {
  return { buffer: readFileSync(readPath), mime: mimeFromUrl(readPath) };
}

// ── Single shared judge (the pacing fix, #1015 review) ───────────────────────
// The judge owns the per-instance `Pacer` (src/judges/gemini.ts → ../pacing.ts).
// Constructing one judge PER ROW would reset that Pacer on every call, defeating
// the GEMINI_PACE_MS gate the runbook promises (default 12 s/call ⇒ ≤5 RPM, the
// measured free-tier cap, #1036) — a 150-row `bt eval` would burst unpaced and
// trip Gemini's free-tier RPM/RPD with 429s. So we build
// the judge EXACTLY ONCE and share the instance (hence the single Pacer) across
// all rows. Memoized via a getter so it is NOT constructed at import time:
// `resolveTracedJudge` fails loud on a missing key, and `bt eval --list` /
// dataset introspection must not throw before the keys are even needed.
let _judge: VisionJudge | undefined;
const getJudge = (): VisionJudge =>
  (_judge ??= resolveTracedJudge(process.env, {
    project: 'bird-maps',
    model: EVAL_MODEL,
    rubricVersion: PINNED_RUBRIC_VERSION,
  }));

Eval('bird-maps', {
  data: () => rows,
  // Rows run SERIALLY (one at a time): the shared judge's single Pacer enforces
  // the GEMINI_PACE_MS gate globally only if rows don't race it. Braintrust's default
  // concurrency is unbounded, so we pin it to 1 — without this, concurrent rows
  // sharing one Pacer could still burst past the RPM cap.
  maxConcurrency: 1,
  // Braintrust calls task(input, hooks) — the first positional arg is the row's
  // `input` value. `getJudge()` lazily builds the ONE shared judge (fails loud on
  // a missing GEMINI/BRAINTRUST key) and reuses it for every row.
  task: (input) =>
    runRow({ judge: getJudge(), readImage, prompt: JUDGE_PROMPT }, input),
  // The 3 headline scorers plus the per-axis criteria-MAE (#1067), which emits
  // its own `criteria_mae_<axis>` column per CRITERIA_KEYS axis (null-skipping a
  // missing axis). `contentHash` lands in span metadata automatically: each
  // dataset row's `metadata` (built by buildEvalRows) is logged to its span.
  scores: [keepAgreement, scoreMAE, keepConfusion, criteriaAxisMAE],
  // Experiment provenance (#1037): which model judged, under which pinned
  // criteria — so cross-model / cross-pin experiments are sliceable by name.
  metadata: { model: EVAL_MODEL, rubricVersion: PINNED_RUBRIC_VERSION },
});

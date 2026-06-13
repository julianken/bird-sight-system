// Read-path queries for the model-comparison viewer (#1095, PR2 of 2). These
// read the `eval_run` + `eval_result` tables that #1094 created (see ../db.ts)
// and the store helpers in ../eval/store.ts.
//
// UNIT CONTRACT (load-bearing): #1094 stores `eval_run.agreement` and
// `score_mae` as 0–1 FRACTIONS — `agreement` is the mean of the per-row
// keepAgreement scores. So the gate is a DIRECT `agreement >= 0.90` (NOT
// `>= 90`); a stored percent would make every run gate PASS silently. The viewer
// (`public/eval.js`) renders `× 100` for the `%` columns.

import type Database from 'better-sqlite3';

/** Pass-or-fail headline gate for a run. */
export type Gate = 'PASS' | 'fail';

/** The 90% keep-agreement gate as a 0–1 fraction (the #1094 unit contract). */
export const AGREEMENT_GATE = 0.9;

/**
 * One row per eval RUN for the comparison table. Mirrors `EvalRunRecord` (the
 * store helper) plus a derived `gate`. `agreement` / `scoreMae` stay 0–1
 * fractions — the viewer multiplies by 100 for display.
 */
export interface EvalRunSummary {
  id: string;
  model: string;
  baselineModel: string;
  baselineRubric: string;
  sampleSize: number;
  agreement: number;
  falseKeep: number;
  falseReplace: number;
  scoreMae: number;
  totalCost: number;
  startedAt: string;
  gate: Gate;
}

/** One falseKeep judgment: Gemini kept what the Opus baseline replaced. */
export interface FalseKeep {
  sourceUrl: string;
  comName: string;
  speciesCode: string;
  geminiQuality: number;
  opusQuality: number;
}

interface EvalRunSummaryDbRow {
  id: string;
  model: string;
  baseline_model: string;
  baseline_rubric: string;
  sample_size: number;
  agreement: number;
  false_keep: number;
  false_replace: number;
  score_mae: number;
  total_cost: number;
  started_at: string;
}

/** Derive the headline gate from the 0–1 fraction agreement. */
function gateFor(agreement: number): Gate {
  return agreement >= AGREEMENT_GATE ? 'PASS' : 'fail';
}

/** Every eval run, newest `started_at` first, each with its derived gate. */
export function evalRuns(db: Database.Database): EvalRunSummary[] {
  const rows = db
    .prepare(
      `SELECT id, model, baseline_model, baseline_rubric, sample_size,
              agreement, false_keep, false_replace, score_mae, total_cost, started_at
         FROM eval_run
        ORDER BY started_at DESC`,
    )
    .all() as EvalRunSummaryDbRow[];
  return rows.map((r) => ({
    id: r.id,
    model: r.model,
    baselineModel: r.baseline_model,
    baselineRubric: r.baseline_rubric,
    sampleSize: r.sample_size,
    agreement: r.agreement,
    falseKeep: r.false_keep,
    falseReplace: r.false_replace,
    scoreMae: r.score_mae,
    totalCost: r.total_cost,
    startedAt: r.started_at,
    gate: gateFor(r.agreement),
  }));
}

interface FalseKeepDbRow {
  source_url: string;
  com_name: string;
  species_code: string;
  gemini_quality: number;
  opus_quality: number;
}

/**
 * The dangerous-disagreement set for a run: judgments where Gemini KEPT
 * (`gemini_keep = 1`) what the Opus baseline REPLACED (`opus_keep = 0`).
 * Ordered by `species_code` for stable gallery output.
 */
export function evalFalseKeeps(db: Database.Database, runId: string): FalseKeep[] {
  const rows = db
    .prepare(
      `SELECT source_url, com_name, species_code, gemini_quality, opus_quality
         FROM eval_result
        WHERE run_id = ? AND gemini_keep = 1 AND opus_keep = 0
        ORDER BY species_code`,
    )
    .all(runId) as FalseKeepDbRow[];
  return rows.map((r) => ({
    sourceUrl: r.source_url,
    comName: r.com_name,
    speciesCode: r.species_code,
    geminiQuality: r.gemini_quality,
    opusQuality: r.opus_quality,
  }));
}

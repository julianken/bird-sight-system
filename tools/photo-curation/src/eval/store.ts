// ─────────────────────────────────────────────────────────────────────────────
// Local eval store helpers (#1094) — the Braintrust write-path replacement.
//
// These read/write the `eval_run` + `eval_result` tables added to db.ts. The
// runner (scripts/run-eval-local.ts) writes one `eval_result` per judgment and
// one `eval_run` aggregate; the analyze CLI (scripts/analyze-experiment.ts)
// reads `eval_result` back. The web viewer (PR2, #1095) reads both.
//
// The TS record shapes use natural types (booleans, `number | undefined`); the
// SQLite columns are INTEGER/REAL/TEXT, so the helpers map at the boundary:
//   • boolean ↔ 0/1 (gemini_keep / opus_keep)
//   • `undefined` ↔ NULL (an UNPRICED judgment has no cost/token counts — kept
//     distinct from a real 0 so a partial-cost run stays visible, mirroring the
//     pricing.ts contract).
// ─────────────────────────────────────────────────────────────────────────────

import type Database from 'better-sqlite3';

/**
 * One eval RUN's record. `agreement` and `scoreMae` are 0–1 FRACTIONS (the
 * #1094 unit contract — the mean of the per-row scores, NOT a percent), so
 * PR2's `>= 0.90` gate reads them directly. `totalCost` is the summed estimated
 * USD across priced judgments.
 */
export interface EvalRunRecord {
  id: string;
  model: string;
  baselineModel: string;
  baselineRubric: string;
  sampleSize: number;
  startedAt: string;
  agreement: number;
  falseKeep: number;
  falseReplace: number;
  scoreMae: number;
  totalCost: number;
}

/**
 * One JUDGMENT's record: the candidate (`gemini*`) decision joined with the
 * Opus baseline (`opus*`) and per-call token/cost metrics. `cost` /
 * `promptTokens` / `completionTokens` are `undefined` for an unpriced or
 * usage-less judgment (stored NULL); `geminiCriteriaJson` is `null` when the
 * candidate carried no per-axis sub-scores.
 */
export interface EvalResultRecord {
  runId: string;
  speciesCode: string;
  comName: string;
  contentHash: string;
  sourceUrl: string;
  geminiKeep: boolean;
  geminiQuality: number;
  geminiCriteriaJson: string | null;
  opusKeep: boolean;
  opusQuality: number;
  cost: number | undefined;
  promptTokens: number | undefined;
  completionTokens: number | undefined;
}

/** Insert one eval-run aggregate row. */
export function insertEvalRun(db: Database.Database, run: EvalRunRecord): void {
  db.prepare(
    `INSERT INTO eval_run
       (id, model, baseline_model, baseline_rubric, sample_size, started_at,
        agreement, false_keep, false_replace, score_mae, total_cost)
     VALUES
       (@id, @model, @baselineModel, @baselineRubric, @sampleSize, @startedAt,
        @agreement, @falseKeep, @falseReplace, @scoreMae, @totalCost)`,
  ).run(run);
}

/** Insert one judgment row (`undefined` → NULL, booleans → 0/1). */
export function insertEvalResult(db: Database.Database, row: EvalResultRecord): void {
  db.prepare(
    `INSERT INTO eval_result
       (run_id, species_code, com_name, content_hash, source_url,
        gemini_keep, gemini_quality, gemini_criteria_json,
        opus_keep, opus_quality, cost, prompt_tokens, completion_tokens)
     VALUES
       (@runId, @speciesCode, @comName, @contentHash, @sourceUrl,
        @geminiKeep, @geminiQuality, @geminiCriteriaJson,
        @opusKeep, @opusQuality, @cost, @promptTokens, @completionTokens)`,
  ).run({
    runId: row.runId,
    speciesCode: row.speciesCode,
    comName: row.comName,
    contentHash: row.contentHash,
    sourceUrl: row.sourceUrl,
    geminiKeep: row.geminiKeep ? 1 : 0,
    geminiQuality: row.geminiQuality,
    geminiCriteriaJson: row.geminiCriteriaJson,
    opusKeep: row.opusKeep ? 1 : 0,
    opusQuality: row.opusQuality,
    // `undefined` is not a valid better-sqlite3 bind value — coerce to null so
    // an unpriced/usage-less judgment stores NULL (distinct from a real 0).
    cost: row.cost ?? null,
    promptTokens: row.promptTokens ?? null,
    completionTokens: row.completionTokens ?? null,
  });
}

/** The raw `eval_run` row shape as better-sqlite3 returns it. */
interface EvalRunDbRow {
  id: string;
  model: string;
  baseline_model: string;
  baseline_rubric: string;
  sample_size: number;
  started_at: string;
  agreement: number;
  false_keep: number;
  false_replace: number;
  score_mae: number;
  total_cost: number;
}

/** The raw `eval_result` row shape as better-sqlite3 returns it (NULLs intact). */
interface EvalResultDbRow {
  run_id: string;
  species_code: string;
  com_name: string;
  content_hash: string;
  source_url: string;
  gemini_keep: number;
  gemini_quality: number;
  gemini_criteria_json: string | null;
  opus_keep: number;
  opus_quality: number;
  cost: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
}

/** A SQLite NULL (read back as `null`) → `undefined`; a number stays a number. */
function nullableNumber(v: number | null): number | undefined {
  return v === null ? undefined : v;
}

/** Read one eval-run aggregate by id, or `undefined` when absent. */
export function readEvalRun(db: Database.Database, runId: string): EvalRunRecord | undefined {
  const row = db
    .prepare(`SELECT * FROM eval_run WHERE id = ?`)
    .get(runId) as EvalRunDbRow | undefined;
  if (row === undefined) return undefined;
  return {
    id: row.id,
    model: row.model,
    baselineModel: row.baseline_model,
    baselineRubric: row.baseline_rubric,
    sampleSize: row.sample_size,
    startedAt: row.started_at,
    agreement: row.agreement,
    falseKeep: row.false_keep,
    falseReplace: row.false_replace,
    scoreMae: row.score_mae,
    totalCost: row.total_cost,
  };
}

/** Read every judgment for a run, ordered by `species_code` for stable output. */
export function readEvalResults(db: Database.Database, runId: string): EvalResultRecord[] {
  const rows = db
    .prepare(`SELECT * FROM eval_result WHERE run_id = ? ORDER BY species_code`)
    .all(runId) as EvalResultDbRow[];
  return rows.map((row) => ({
    runId: row.run_id,
    speciesCode: row.species_code,
    comName: row.com_name,
    contentHash: row.content_hash,
    sourceUrl: row.source_url,
    geminiKeep: row.gemini_keep === 1,
    geminiQuality: row.gemini_quality,
    geminiCriteriaJson: row.gemini_criteria_json,
    opusKeep: row.opus_keep === 1,
    opusQuality: row.opus_quality,
    cost: nullableNumber(row.cost),
    promptTokens: nullableNumber(row.prompt_tokens),
    completionTokens: nullableNumber(row.completion_tokens),
  }));
}

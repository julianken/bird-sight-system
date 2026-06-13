// ─────────────────────────────────────────────────────────────────────────────
// The SINGLE domain seam between photo-curation's photo-judge eval and the
// generic @bird-watch/eleatic store (E7, #1150).
//
// This is the ONLY file in tools/photo-curation that imports @bird-watch/eleatic.
// It maps the photo-judge's `EvalResultRecord` / `EvalRunRecord` (src/eval/store.ts)
// onto eleatic's generic three-table records, and reads them back for the
// analyzer. Keeping the import here means eleatic stays zero-`@bird-watch`-coupled
// and the runner/analyzer only ever speak the photo-judge vocabulary.
//
// UNIT CONTRACT (#1094, load-bearing for the #1095 gate): `agreement` and
// `scoreMae` are stored as the SAME 0–1 FRACTIONS the runner computes — 0.8 must
// NOT become 80. PHOTO_JUDGE_GATE reads `agreement` as a fraction (>= 0.90).
//
// exactOptionalPropertyTypes: every omittable eleatic field (imageUrl,
// contentHash, output.criteria) is left ABSENT when its source is missing —
// never assigned `undefined` on a required key.
// ─────────────────────────────────────────────────────────────────────────────

import { openStore, makeReader } from '@bird-watch/eleatic';
import type { EvalRowRecord, EvalRunRecord as EleaticRunRecord, EleaticStore } from '@bird-watch/eleatic';
import type { CriteriaScores } from '@bird-watch/photo-quality';
import type { EvalResultRecord, EvalRunRecord } from './store.js';

// Re-export the eleatic LIFECYCLE surface the runner + analyzer need, so this
// adapter stays the SINGLE file in tools/photo-curation that imports
// `@bird-watch/eleatic` (#1150). The scripts open/read the store through here,
// never reaching into the package directly — the one-seam rule keeps the
// photo-judge↔eleatic coupling auditable in one place.
export { openStore, makeReader };
export type { EleaticStore };

/**
 * The eleatic gate for the photo-judge eval: keep-agreement at or above 0.90,
 * read as a 0–1 fraction (NOT a percent). Mirrors the #1095 `>= 0.90` gate; the
 * E4 server / E6 UI read this metric/op/threshold directly off the stored run.
 */
export const PHOTO_JUDGE_GATE = { metric: 'agreement', op: 'gte', threshold: 0.9 } as const;

/** The disagreement cell a row falls into, used as a categorical facet axis. */
export type Disagreement = 'agree' | 'falseKeep' | 'falseReplace';

/**
 * The candidate (Gemini) decision blob embedded as `output_json`. `criteria` is
 * the PARSED per-axis sub-scores object (the source `geminiCriteriaJson` is an
 * already-serialized string — it is `JSON.parse`d here, never double-encoded),
 * omitted entirely when the source was null.
 */
interface OutputBlob {
  keep: boolean;
  qualityScore: number;
  criteria?: CriteriaScores;
}

/** The Opus baseline decision blob embedded as `expected_json`. */
interface ExpectedBlob {
  keep: boolean;
  qualityScore: number;
  criteria?: CriteriaScores;
}

/**
 * The four values the analyzer's dataset-level diagnostics need, projected back
 * out of an eleatic row. Structurally identical to the analyzer's own
 * `AnalysisRow` (scripts/analyze-experiment.ts) — kept here so the adapter (a
 * `src/**` build target) does not import from `scripts/**` (outside rootDir).
 */
export interface AnalysisRow {
  outputKeep: boolean;
  outputScore: number;
  expectedKeep: boolean;
  expectedScore: number;
}

/** Classify a row into its keep-disagreement cell (gemini vs. opus). */
function disagreementOf(geminiKeep: boolean, opusKeep: boolean): Disagreement {
  if (geminiKeep && !opusKeep) return 'falseKeep';
  if (!geminiKeep && opusKeep) return 'falseReplace';
  return 'agree';
}

/** Parse the (already-serialized) criteria JSON, null-guarded → `undefined`. */
function parseCriteria(json: string | null): CriteriaScores | undefined {
  if (json === null) return undefined;
  return JSON.parse(json) as CriteriaScores;
}

/**
 * Map one photo-judge judgment onto an eleatic `EvalRowRecord`.
 *   - row_key = speciesCode, label = comName, image_url = sourceUrl (omitted
 *     when empty), content_hash = contentHash (omitted when empty).
 *   - output_json = {keep, qualityScore, criteria?} with criteria PARSED.
 *   - expected_json = {keep, qualityScore} (the baseline carries no criteria).
 *   - scores_json = {outputQuality, expectedQuality} (numeric facet axes).
 *   - metadata_json = {disagreement} (the categorical facet axis).
 */
export function toEleaticRow(r: EvalResultRecord): EvalRowRecord {
  const output: OutputBlob = { keep: r.geminiKeep, qualityScore: r.geminiQuality };
  const criteria = parseCriteria(r.geminiCriteriaJson);
  if (criteria !== undefined) output.criteria = criteria;

  const expected: ExpectedBlob = { keep: r.opusKeep, qualityScore: r.opusQuality };

  // Numeric facet axes. `cost` is an axis too (the analyzer's #1088 cost block
  // reads it back) — present for a priced judgment, ABSENT for an unpriced one
  // (cost `undefined` → omitted key, mirroring the review store's NULL).
  const scores: Record<string, number> = {
    outputQuality: r.geminiQuality,
    expectedQuality: r.opusQuality,
  };
  if (r.cost !== undefined) scores.cost = r.cost;

  const row: EvalRowRecord = {
    runId: r.runId,
    rowKey: r.speciesCode,
    label: r.comName,
    output,
    expected,
    scores,
    metadata: { disagreement: disagreementOf(r.geminiKeep, r.opusKeep) },
  };
  // exactOptionalPropertyTypes: leave the optional keys ABSENT (not `undefined`)
  // when their source is missing, so the store coerces them to a column NULL.
  if (r.sourceUrl !== '') row.imageUrl = r.sourceUrl;
  if (r.contentHash !== '') row.contentHash = r.contentHash;
  return row;
}

/**
 * Map the photo-judge run aggregate onto an eleatic `EvalRunRecord`.
 *   - label = model, baseline = baselineModel.
 *   - config = {baselineModel, baselineRubric, sampleSize}.
 *   - metrics = {agreement, falseKeep, falseReplace, scoreMae, totalCost} — the
 *     SAME 0–1 fractions the runner computed (agreement/scoreMae are NOT scaled
 *     to percents; #1094 unit contract).
 */
export function toEleaticRun(run: EvalRunRecord): EleaticRunRecord {
  return {
    id: run.id,
    label: run.model,
    baseline: run.baselineModel,
    startedAt: run.startedAt,
    config: {
      baselineModel: run.baselineModel,
      baselineRubric: run.baselineRubric,
      sampleSize: run.sampleSize,
    },
    metrics: {
      agreement: run.agreement,
      falseKeep: run.falseKeep,
      falseReplace: run.falseReplace,
      scoreMae: run.scoreMae,
      totalCost: run.totalCost,
    },
  };
}

/**
 * Project a stored eleatic row back to the analyzer's `AnalysisRow`. Reads the
 * candidate/baseline keep + qualityScore from the row's `output_json` /
 * `expected_json` blobs (written by {@link toEleaticRow}).
 */
export function fromEleaticRow(row: EvalRowRecord): AnalysisRow {
  const output = row.output as OutputBlob;
  const expected = row.expected as ExpectedBlob;
  return {
    outputKeep: output.keep,
    outputScore: output.qualityScore,
    expectedKeep: expected.keep,
    expectedScore: expected.qualityScore,
  };
}

/**
 * One judgment's cost, structurally identical to the analyzer's `CostRow`
 * (scripts/analyze-experiment.ts). `estimatedCost` is the priced USD figure or
 * `undefined` for an unpriced judgment — kept here so the adapter (a `src/**`
 * build target) does not import from `scripts/**`.
 */
export interface CostRow {
  estimatedCost: number | undefined;
}

/**
 * Project a stored eleatic row back to the analyzer's `CostRow` (#1088). Reads
 * the `cost` numeric axis from `scores_json` (written by {@link toEleaticRow}):
 * present → priced, absent → unpriced (`undefined`), mirroring the review
 * store's priced/NULL distinction.
 */
export function costFromEleaticRow(row: EvalRowRecord): CostRow {
  return { estimatedCost: row.scores?.cost };
}

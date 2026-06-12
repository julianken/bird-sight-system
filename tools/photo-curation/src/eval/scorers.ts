/**
 * Braintrust eval scorers for the photo-judge experiment (C4, #1014; part of
 * #1010). Headline metrics comparing a candidate judge `output` against the
 * reference `expected` (both JudgeOutput-shaped):
 *
 *   - keepAgreement   — exact boolean match of `keep` (the #969 ≥90% gate).
 *   - scoreMAE        — normalized 1 - |Δ qualityScore| / 100, clamped to [0,1].
 *   - keepConfusion   — splits disagreements into false-keep (output keeps what
 *                       expected would replace — the DANGEROUS direction: it
 *                       ships a bad photo) vs false-replace.
 *   - criteriaAxisMAE — per-axis agreement on the 7 `CriteriaScores` sub-scores
 *                       (#1067): one `criteria_mae_<axis>` column per axis,
 *                       `1 − |out − exp|/10` clamped to [0,1]. A missing axis on
 *                       EITHER side null-skips that axis only (never a phantom 0).
 *
 * Braintrust calls scorers with `{input, output, expected, metadata}`; these
 * read only `output` + `expected`. All are PURE — no IO — so they unit-test
 * directly and can run inside the eval harness without side effects.
 */

import { type CriteriaScores, CRITERIA_KEYS } from '@bird-watch/photo-quality';

/**
 * The subset of JudgeOutput these scorers depend on. `criteria` is optional
 * because the EXPECTED side may carry no per-axis baseline (older rows, or a
 * NULL `criteria_json`) — that case null-skips the per-axis columns rather than
 * fabricating agreement. The candidate `output` is always a full `JudgeOutput`
 * and so always carries `criteria`; the optionality is for the expected side.
 */
export interface ScorerJudgeOutput {
  keep: boolean;
  qualityScore: number;
  criteria?: CriteriaScores;
}

/** Braintrust scorer args, narrowed to the fields these scorers consume. */
export interface ScorerArgs {
  output: ScorerJudgeOutput;
  expected: ScorerJudgeOutput;
}

export interface ScorerResult {
  name: string;
  score: number;
}

export interface KeepConfusionResult extends ScorerResult {
  metadata: { falseKeep: number; falseReplace: number };
}

/** Exact boolean agreement on the keep/replace gate. */
export function keepAgreement({ output, expected }: ScorerArgs): ScorerResult {
  return { name: 'keep_agreement', score: output.keep === expected.keep ? 1 : 0 };
}

/**
 * Normalized mean-absolute-error on qualityScore, clamped to [0,1] so an
 * out-of-domain qualityScore (e.g. >100-point error) can never produce a
 * negative score.
 */
export function scoreMAE({ output, expected }: ScorerArgs): ScorerResult {
  const score = Math.max(0, 1 - Math.abs(output.qualityScore - expected.qualityScore) / 100);
  return { name: 'score_mae', score };
}

/**
 * Confusion split. score is 1 when keep agrees, 0 on any disagreement; the
 * metadata names WHICH disagreement: falseKeep is the dangerous direction
 * (output keeps what expected would replace → ships a bad photo).
 */
export function keepConfusion({ output, expected }: ScorerArgs): KeepConfusionResult {
  const falseKeep = output.keep && !expected.keep ? 1 : 0;
  const falseReplace = !output.keep && expected.keep ? 1 : 0;
  return {
    name: 'keep_confusion',
    score: output.keep === expected.keep ? 1 : 0,
    metadata: { falseKeep, falseReplace },
  };
}

/** One per-axis score column. `score: null` is a deliberate axis-skip. */
export interface AxisScoreResult {
  name: string;
  score: number | null;
}

/**
 * Per-axis criteria-MAE (#1067). Returns one `criteria_mae_<axis>` column per
 * `CriteriaScores` axis (iterating `CRITERIA_KEYS`, never hardcoded), each
 * `1 − |output_axis − expected_axis| / 10` clamped to [0,1]. The scale divisor
 * is 10 because criteria sub-scores are 0–10 (not 0–100 like qualityScore).
 *
 * A row missing an axis on EITHER side (the expected side has no `criteria`, or
 * either side omits that key) null-skips THAT axis only — `score: null`, which
 * Braintrust drops from the column's aggregate rather than averaging in a 0.
 * The contract is "never fabricate agreement OR disagreement from absence": a
 * missing baseline axis is unknown, not a perfect match and not a total miss.
 *
 * Braintrust supports a scorer returning an array of `{name, score}` objects,
 * each rendering as its own column (verified via the Braintrust docs,
 * 2026-06-12: a scorer may return `number | {score, name?, metadata?} | null`,
 * or an array thereof). Always emits all 7 columns so the experiment UI shape
 * is stable even when every axis skips.
 */
export function criteriaAxisMAE({ output, expected }: ScorerArgs): AxisScoreResult[] {
  const out = output.criteria;
  const exp = expected.criteria;
  return CRITERIA_KEYS.map((axis): AxisScoreResult => {
    const name = `criteria_mae_${axis}`;
    const o = out?.[axis];
    const e = exp?.[axis];
    if (typeof o !== 'number' || typeof e !== 'number') {
      return { name, score: null };
    }
    return { name, score: Math.max(0, 1 - Math.abs(o - e) / 10) };
  });
}

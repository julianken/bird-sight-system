/**
 * Braintrust eval scorers for the photo-judge experiment (C4, #1014; part of
 * #1010). Three headline metrics comparing a candidate judge `output` against
 * the reference `expected` (both JudgeOutput-shaped — only `keep` and
 * `qualityScore` matter here):
 *
 *   - keepAgreement  — exact boolean match of `keep` (the #969 ≥90% gate).
 *   - scoreMAE       — normalized 1 - |Δ qualityScore| / 100, clamped to [0,1].
 *   - keepConfusion  — splits disagreements into false-keep (output keeps what
 *                      expected would replace — the DANGEROUS direction: it
 *                      ships a bad photo) vs false-replace.
 *
 * Braintrust calls scorers with `{input, output, expected, metadata}`; these
 * read only `output` + `expected`. All three are PURE — no IO — so they unit-
 * test directly and can run inside the eval harness without side effects.
 */

/** The subset of JudgeOutput these scorers depend on. */
export interface ScorerJudgeOutput {
  keep: boolean;
  qualityScore: number;
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

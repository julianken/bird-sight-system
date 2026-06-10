import { CRITERIA_KEYS } from './types.js';
import type { CriteriaScores, RubricConfig, Verdict } from './types.js';

/**
 * Weighted composite of the 0–10 sub-scores onto a 0–100 scale. Weights sum to
 * 1, so the composite is (Σ wᵢ·criteriaᵢ)·10 — an all-10 input yields 100.
 * Iterates the canonical CRITERIA_KEYS order so the math is independent of
 * object key order.
 */
export function composeOverall(
  criteria: CriteriaScores,
  weights: Record<keyof CriteriaScores, number>,
): number {
  let weighted = 0;
  for (const key of CRITERIA_KEYS) {
    weighted += weights[key] * criteria[key];
  }
  return weighted * 10;
}

/**
 * Apply disqualifier caps. For every flag present that has a configured
 * disqualifier entry, the overall is clamped to that entry's cap; the LOWEST
 * applicable cap wins (a dead+in-hand image caps at 20, not 35). Flags with no
 * configured cap (e.g. watermark) are inert here. Never raises the score.
 */
export function applyCaps(
  overall: number,
  flags: string[],
  disqualifiers: RubricConfig['disqualifiers'],
): number {
  let capped = overall;
  for (const { flag, cap } of disqualifiers) {
    if (flags.includes(flag)) {
      capped = Math.min(capped, cap);
    }
  }
  return capped;
}

/**
 * Map a 0–100 overall to a Verdict via inclusive lower-bound thresholds:
 *   overall >= autoAccept → great
 *   overall >= review     → good
 *   overall >= reject      → mediocre
 *   else                   → reject
 */
export function toVerdict(
  overall: number,
  thresholds: RubricConfig['thresholds'],
): Verdict {
  if (overall >= thresholds.autoAccept) return 'great';
  if (overall >= thresholds.review) return 'good';
  if (overall >= thresholds.reject) return 'mediocre';
  return 'reject';
}

/**
 * Full composite step: weighted overall → disqualifier caps → verdict. Pure;
 * scoreImage wires it after the judge returns. Returned overall is rounded to
 * one decimal for stable storage/display.
 */
export function composeReport(
  criteria: CriteriaScores,
  flags: string[],
  config: RubricConfig,
): { overall: number; verdict: Verdict } {
  const raw = composeOverall(criteria, config.weights);
  const capped = applyCaps(raw, flags, config.disqualifiers);
  const overall = Math.round(capped * 10) / 10;
  return { overall, verdict: toVerdict(overall, config.thresholds) };
}

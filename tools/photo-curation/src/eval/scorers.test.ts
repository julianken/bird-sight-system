import { describe, it, expect } from 'vitest';
import { keepAgreement, scoreMAE, keepConfusion, criteriaAxisMAE } from './scorers.js';
import { CRITERIA_KEYS, type CriteriaScores } from '@bird-watch/photo-quality';

/**
 * The Braintrust scorer args are `{input, output, expected, metadata}`; these
 * three scorers read only `output` + `expected`, which are JudgeOutput-shaped
 * (the relevant fields are `keep: boolean` and `qualityScore: number`). The
 * scorers are pure — no IO — so they can be unit-tested directly.
 */
const judge = (keep: boolean, qualityScore: number) => ({ keep, qualityScore });

describe('keepAgreement', () => {
  it('scores 1 when output.keep matches expected.keep', () => {
    expect(keepAgreement({ output: judge(true, 80), expected: judge(true, 80) })).toEqual({
      name: 'keep_agreement',
      score: 1,
    });
    expect(keepAgreement({ output: judge(false, 20), expected: judge(false, 90) })).toEqual({
      name: 'keep_agreement',
      score: 1,
    });
  });

  it('scores 0 when output.keep mismatches expected.keep', () => {
    expect(keepAgreement({ output: judge(true, 80), expected: judge(false, 80) })).toEqual({
      name: 'keep_agreement',
      score: 0,
    });
    expect(keepAgreement({ output: judge(false, 80), expected: judge(true, 80) })).toEqual({
      name: 'keep_agreement',
      score: 0,
    });
  });
});

describe('scoreMAE', () => {
  it('scores 1 for an exact qualityScore match', () => {
    expect(scoreMAE({ output: judge(true, 80), expected: judge(true, 80) })).toEqual({
      name: 'score_mae',
      score: 1,
    });
  });

  it('scores 0.5 for a 50-point absolute error', () => {
    expect(scoreMAE({ output: judge(true, 80), expected: judge(true, 30) })).toEqual({
      name: 'score_mae',
      score: 0.5,
    });
  });

  it('scores 0 for a full 100-point absolute error', () => {
    expect(scoreMAE({ output: judge(true, 0), expected: judge(true, 100) })).toEqual({
      name: 'score_mae',
      score: 0,
    });
  });

  it('clamps to 0 for an out-of-domain qualityScore (no negative scores)', () => {
    // |130 - 0| / 100 = 1.3 → 1 - 1.3 = -0.3, a NEGATIVE raw score that the
    // Math.max(0, …) clamp pulls up to 0 (an out-of-domain >100-point error
    // can never produce a negative metric).
    expect(scoreMAE({ output: judge(true, 130), expected: judge(true, 0) })).toEqual({
      name: 'score_mae',
      score: 0,
    });
  });
});

describe('keepConfusion', () => {
  it('keep/keep — no confusion, score 1, neither flag set', () => {
    expect(keepConfusion({ output: judge(true, 80), expected: judge(true, 80) })).toEqual({
      name: 'keep_confusion',
      score: 1,
      metadata: { falseKeep: 0, falseReplace: 0 },
    });
  });

  it('keep/replace — false-keep (the dangerous direction), score 0', () => {
    expect(keepConfusion({ output: judge(true, 80), expected: judge(false, 20) })).toEqual({
      name: 'keep_confusion',
      score: 0,
      metadata: { falseKeep: 1, falseReplace: 0 },
    });
  });

  it('replace/keep — false-replace, score 0', () => {
    expect(keepConfusion({ output: judge(false, 20), expected: judge(true, 80) })).toEqual({
      name: 'keep_confusion',
      score: 0,
      metadata: { falseKeep: 0, falseReplace: 1 },
    });
  });

  it('replace/replace — no confusion, score 1, neither flag set', () => {
    expect(keepConfusion({ output: judge(false, 20), expected: judge(false, 30) })).toEqual({
      name: 'keep_confusion',
      score: 1,
      metadata: { falseKeep: 0, falseReplace: 0 },
    });
  });
});

describe('criteriaAxisMAE', () => {
  const full = (over: Partial<CriteriaScores> = {}): CriteriaScores => ({
    framing: 8, subjectClarity: 8, liveness: 8, naturalness: 8, pose: 8, background: 8, lighting: 8, ...over,
  });
  /** A candidate JudgeOutput-shaped value carrying full criteria. */
  const out = (criteria: CriteriaScores) => ({ keep: true, qualityScore: 80, criteria });

  it('emits exactly 7 columns, one per CRITERIA_KEYS axis, named criteria_mae_<axis>', () => {
    const results = criteriaAxisMAE({ output: out(full()), expected: { keep: true, qualityScore: 80, criteria: full() } });
    expect(results).toHaveLength(CRITERIA_KEYS.length);
    expect(results.map((r) => r.name)).toEqual(CRITERIA_KEYS.map((k) => `criteria_mae_${k}`));
  });

  it('scores 1.0 on every axis when both sides match exactly', () => {
    const results = criteriaAxisMAE({ output: out(full()), expected: { keep: true, qualityScore: 80, criteria: full() } });
    for (const r of results) expect(r.score).toBe(1);
  });

  it('scores 0.5 on a single axis with a 5-point gap, leaving the others at 1.0', () => {
    const results = criteriaAxisMAE({
      output: out(full({ naturalness: 9 })),
      expected: { keep: true, qualityScore: 80, criteria: full({ naturalness: 4 }) },
    });
    const byName = new Map(results.map((r) => [r.name, r.score]));
    expect(byName.get('criteria_mae_naturalness')).toBe(0.5);
    for (const k of CRITERIA_KEYS) {
      if (k === 'naturalness') continue;
      expect(byName.get(`criteria_mae_${k}`)).toBe(1);
    }
  });

  it('scores 0 on a full 10-point axis gap', () => {
    const results = criteriaAxisMAE({
      output: out(full({ lighting: 10 })),
      expected: { keep: true, qualityScore: 80, criteria: full({ lighting: 0 }) },
    });
    const byName = new Map(results.map((r) => [r.name, r.score]));
    expect(byName.get('criteria_mae_lighting')).toBe(0);
  });

  it('null-skips ALL axes when the expected side has no criteria (still 7 columns)', () => {
    const results = criteriaAxisMAE({ output: out(full()), expected: { keep: true, qualityScore: 80 } });
    expect(results).toHaveLength(CRITERIA_KEYS.length);
    for (const r of results) expect(r.score).toBeNull();
  });

  it('null-skips only the missing axis when one side omits a single axis', () => {
    // Expected criteria missing `pose` (partial blob from an older baseline).
    const partial = full();
    delete (partial as Record<string, unknown>).pose;
    const results = criteriaAxisMAE({
      output: out(full()),
      expected: { keep: true, qualityScore: 80, criteria: partial as CriteriaScores },
    });
    const byName = new Map(results.map((r) => [r.name, r.score]));
    expect(byName.get('criteria_mae_pose')).toBeNull();
    // Every other axis is unaffected (matching → 1.0).
    for (const k of CRITERIA_KEYS) {
      if (k === 'pose') continue;
      expect(byName.get(`criteria_mae_${k}`)).toBe(1);
    }
  });
});

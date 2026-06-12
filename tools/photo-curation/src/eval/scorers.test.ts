import { describe, it, expect } from 'vitest';
import { keepAgreement, scoreMAE, keepConfusion } from './scorers.js';

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
    // |130 - 50| / 100 = 0.8 → 1 - 0.8 = 0.2 is in-domain; push further:
    // a >100-point error would yield a negative raw score, which we clamp to 0.
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

import { describe, it, expect } from 'vitest';
import { composeOverall, applyCaps, toVerdict, composeReport } from './composite.js';
import { defaultRubricConfig } from './rubric.config.js';
import type { CriteriaScores } from './types.js';

const perfect: CriteriaScores = {
  framing: 10, subjectClarity: 10, liveness: 10,
  naturalness: 10, pose: 10, background: 10, lighting: 10,
};
const zero: CriteriaScores = {
  framing: 0, subjectClarity: 0, liveness: 0,
  naturalness: 0, pose: 0, background: 0, lighting: 0,
};

describe('composeOverall', () => {
  it('maps all-10 sub-scores to 100 and all-0 to 0 (weights sum to 1)', () => {
    expect(composeOverall(perfect, defaultRubricConfig.weights)).toBeCloseTo(100, 6);
    expect(composeOverall(zero, defaultRubricConfig.weights)).toBeCloseTo(0, 6);
  });

  it('applies the configured weights', () => {
    // Only subjectClarity (weight 0.24) at 10, rest 0 → 0.24 * 10 * 10 = 24.
    const c: CriteriaScores = { ...zero, subjectClarity: 10 };
    expect(composeOverall(c, defaultRubricConfig.weights)).toBeCloseTo(
      defaultRubricConfig.weights.subjectClarity * 100, 6,
    );
  });
});

describe('applyCaps', () => {
  it('caps overall at 20 when the dead flag is present', () => {
    expect(applyCaps(95, ['dead'], defaultRubricConfig.disqualifiers)).toBe(20);
  });

  it('uses the lowest cap when multiple disqualifiers fire', () => {
    // in-hand cap 35, dead cap 20 → 20 wins.
    expect(applyCaps(95, ['in-hand', 'dead'], defaultRubricConfig.disqualifiers)).toBe(20);
  });

  it('never raises a score below its cap', () => {
    expect(applyCaps(10, ['captive'], defaultRubricConfig.disqualifiers)).toBe(10);
  });

  it('is a no-op when no disqualifier flags are present', () => {
    expect(applyCaps(88, ['watermark'], defaultRubricConfig.disqualifiers)).toBe(88);
  });
});

describe('toVerdict (boundaries)', () => {
  const t = defaultRubricConfig.thresholds; // autoAccept 75, review 50, reject 35
  it('great at exactly autoAccept', () => {
    expect(toVerdict(t.autoAccept, t)).toBe('great');
  });
  it('good just below autoAccept, down to review', () => {
    expect(toVerdict(t.autoAccept - 1, t)).toBe('good');
    expect(toVerdict(t.review, t)).toBe('good');
  });
  it('mediocre between reject and review', () => {
    expect(toVerdict(t.review - 1, t)).toBe('mediocre');
    expect(toVerdict(t.reject, t)).toBe('mediocre');
  });
  it('reject below the reject threshold', () => {
    expect(toVerdict(t.reject - 1, t)).toBe('reject');
  });
});

describe('composeReport', () => {
  it('caps overall and downgrades verdict to reject for a dead bird', () => {
    const r = composeReport(perfect, ['dead'], defaultRubricConfig);
    expect(r.overall).toBe(20);
    expect(r.verdict).toBe('reject');
  });

  it('passes the judge keep/qualityScore through unchanged (the gate is keep, not the composite)', () => {
    // A HIGH composite but the judge said replace (keep:false) → the gate is
    // keep:false regardless of overall. composeReport only ranks; it never
    // overrides the judge's decision.
    const r = composeReport(perfect, [], defaultRubricConfig, { keep: false, qualityScore: 40 });
    expect(r.overall).toBe(100);          // composite still high (ranking)
    expect(r.verdict).toBe('great');       // verdict still derived from composite
    expect(r.keep).toBe(false);            // but the GATE is the judge's keep
    expect(r.qualityScore).toBe(40);
  });

  it('passes keep:true through for a low-composite photo (the gate can keep a mediocre snapshot)', () => {
    const lowish: CriteriaScores = { ...zero, framing: 5, subjectClarity: 5 };
    const r = composeReport(lowish, [], defaultRubricConfig, { keep: true, qualityScore: 55 });
    expect(r.keep).toBe(true);
    expect(r.qualityScore).toBe(55);
  });

  it('defaults keep:true / qualityScore to the composite when no judge decision is supplied', () => {
    // Back-compat: a caller that omits the decision (e.g. a synthetic report)
    // gets keep:true and qualityScore = overall.
    const r = composeReport(perfect, [], defaultRubricConfig);
    expect(r.keep).toBe(true);
    expect(r.qualityScore).toBe(r.overall);
  });
});

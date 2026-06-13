import { describe, it, expect } from 'vitest';
import {
  labelAgreement,
  confusionCounts,
  scoreMAE,
  auc,
  calibratedThreshold,
  ambiguityBand,
  hybridRouting,
  analyze,
  projectForAnalysis,
  aggregateScores,
  type AnalysisRow,
} from './analysis.js';

/**
 * A hand-built fixture set with KNOWN answers, ported verbatim (with the
 * keep→label / falseKeep→falsePositive / falseReplace→falseNegative renames)
 * from tools/photo-curation/scripts/analyze-experiment.test.ts. The pure
 * dataset-level helpers (AUC, calibrated-threshold sweep, ambiguity band,
 * hybrid routing) are verified against these by-hand calculations — no SQLite,
 * no store, no network.
 *
 * Convention per row: `[outputLabel, outputScore, expectedLabel, expectedScore]`.
 * outputScore is the candidate's numeric score (the ranking signal);
 * expectedScore is the baseline's numeric score (the band axis).
 */
function row(outputLabel: boolean, outputScore: number, expectedLabel: boolean, expectedScore: number): AnalysisRow {
  return { outputLabel, outputScore, expectedLabel, expectedScore };
}

describe('labelAgreement', () => {
  it('is the fraction of rows where outputLabel === expectedLabel', () => {
    const rows = [
      row(true, 80, true, 85),   // agree
      row(false, 20, false, 15), // agree
      row(true, 60, false, 40),  // disagree (falsePositive)
      row(false, 30, true, 70),  // disagree (falseNegative)
    ];
    expect(labelAgreement(rows)).toBeCloseTo(0.5);
  });

  it('is 1 for a perfectly-agreeing set and 0 for a fully-disagreeing set', () => {
    expect(labelAgreement([row(true, 80, true, 80), row(false, 10, false, 10)])).toBe(1);
    expect(labelAgreement([row(true, 80, false, 10), row(false, 10, true, 80)])).toBe(0);
  });

  it('is 0 for an empty set', () => {
    expect(labelAgreement([])).toBe(0);
  });
});

describe('confusionCounts', () => {
  it('counts falsePositive (output true, expected false) and falseNegative', () => {
    const rows = [
      row(true, 80, true, 85),
      row(true, 60, false, 40),  // falsePositive
      row(true, 55, false, 30),  // falsePositive
      row(false, 30, true, 70),  // falseNegative
    ];
    expect(confusionCounts(rows)).toEqual({ falsePositive: 2, falseNegative: 1 });
  });
});

describe('scoreMAE', () => {
  it('is the mean absolute difference of the scores', () => {
    const rows = [
      row(true, 80, true, 70),   // |80-70| = 10
      row(false, 20, false, 50), // |20-50| = 30
    ];
    // mean(10, 30) = 20
    expect(scoreMAE(rows)).toBeCloseTo(20);
  });

  it('is 0 for an empty set', () => {
    expect(scoreMAE([])).toBe(0);
  });
});

describe('auc', () => {
  // AUC = P(a random label-positive outranks a random label-negative) by the
  // output score. Use expectedLabel as the positive label, outputScore as rank.
  it('is 1.0 when the output score perfectly separates the label classes', () => {
    const rows = [
      row(true, 90, true, 0),   // positive (expected true), high score
      row(true, 80, true, 0),   // positive, high score
      row(false, 40, false, 0), // negative, low score
      row(false, 30, false, 0), // negative, low score
    ];
    expect(auc(rows)).toBeCloseTo(1);
  });

  it('is 0.5 for ties between every positive/negative pair', () => {
    const rows = [
      row(true, 50, true, 0),
      row(true, 50, true, 0),
      row(false, 50, false, 0),
      row(false, 50, false, 0),
    ];
    expect(auc(rows)).toBeCloseTo(0.5);
  });

  it('is 0.75 for a known mixed ordering', () => {
    // positives scored {90, 50}, negatives scored {60, 40}.
    // Pairs (pos,neg): (90,60)=1, (90,40)=1, (50,60)=0, (50,40)=1 → 3/4 = 0.75.
    const rows = [
      row(true, 90, true, 0),
      row(true, 50, true, 0),
      row(false, 60, false, 0),
      row(false, 40, false, 0),
    ];
    expect(auc(rows)).toBeCloseTo(0.75);
  });

  it('returns null when a class is empty (AUC undefined)', () => {
    expect(auc([row(true, 90, true, 0), row(true, 50, true, 0)])).toBeNull();
  });
});

describe('calibratedThreshold', () => {
  // Sweep a score threshold t: predict label iff outputScore >= t, then measure
  // boolean agreement against expectedLabel. Report the best agreement + winning t.
  it('finds the threshold maximizing boolean agreement against the expected label', () => {
    // Baseline keeps the two high-output-score rows, replaces the two low ones.
    const rows = [
      row(true, 90, true, 0),
      row(true, 70, true, 0),
      row(false, 40, false, 0),
      row(false, 20, false, 0),
    ];
    const { bestAgreement, threshold } = calibratedThreshold(rows);
    expect(bestAgreement).toBeCloseTo(1); // a clean split exists
    // A threshold in (40, 70] perfectly separates; the sweep picks one such t.
    expect(threshold).toBeGreaterThan(40);
    expect(threshold).toBeLessThanOrEqual(70);
  });

  it('caps below 1 when no threshold can separate the classes', () => {
    // Interleaved: positive at 30, negative at 80 — no monotone score split works.
    const rows = [
      row(true, 30, true, 0),
      row(false, 80, false, 0),
      row(true, 80, true, 0),
      row(false, 30, false, 0),
    ];
    const { bestAgreement } = calibratedThreshold(rows);
    expect(bestAgreement).toBeLessThan(1);
    expect(bestAgreement).toBeGreaterThanOrEqual(0.5);
  });

  it('is { bestAgreement: 0, threshold: 0 } for an empty set', () => {
    expect(calibratedThreshold([])).toEqual({ bestAgreement: 0, threshold: 0 });
  });
});

describe('ambiguityBand', () => {
  // Count disagreements whose expected score sits inside [lo, hi].
  it('counts only DISAGREEMENTS whose expected score is inside the band', () => {
    const rows = [
      row(true, 60, false, 55),  // disagree, expected 55 IN [50,70]
      row(false, 40, true, 65),  // disagree, expected 65 IN band
      row(true, 90, false, 80),  // disagree, expected 80 OUT of band
      row(true, 70, true, 60),   // AGREE, expected 60 in band — not counted
    ];
    const res = ambiguityBand(rows, 50, 70);
    expect(res.inBandDisagreements).toBe(2);
    expect(res.totalDisagreements).toBe(3);
  });
});

describe('hybridRouting', () => {
  // Route any row whose output score lands in the mid-band [lo, hi] to the
  // baseline (auto-correct). Outside the band, keep the candidate's decision.
  it('routes mid-band rows to the baseline, leaving the rest on the candidate', () => {
    const rows = [
      row(true, 55, false, 30),  // in band → routed → auto-correct (was falsePositive)
      row(false, 60, true, 70),  // in band → routed → auto-correct (was falseNegative)
      row(true, 90, true, 85),   // out of band, candidate agrees
      row(true, 95, false, 20),  // out of band, candidate WRONG (residual falseKeep)
      row(false, 10, false, 15), // out of band, candidate agrees
    ];
    const res = hybridRouting(rows, 50, 70);
    expect(res.routed).toBe(2);
    expect(res.routedFraction).toBeCloseTo(2 / 5);
    // After routing: the 2 routed become correct; out-of-band keep the
    // candidate's call. Agreement = (2 routed-correct + agrees) / total.
    // out-of-band: row3 agree, row4 disagree, row5 agree → 2 correct of 3.
    // total correct = 2 + 2 = 4 of 5.
    expect(res.autoSetAgreement).toBeCloseTo(4 / 5);
    // residual falseKeep: out-of-band rows where output keeps but expected replaces.
    expect(res.residualFalseKeep).toBe(1); // row4 (score 95, output true, expected false)
  });

  it('is all-zero for an empty set', () => {
    expect(hybridRouting([], 50, 70)).toEqual({
      routed: 0,
      routedFraction: 0,
      autoSetAgreement: 0,
      residualFalseKeep: 0,
    });
  });
});

describe('analyze', () => {
  const rows = [
    row(true, 90, true, 85),
    row(false, 20, false, 15),
    row(true, 60, false, 40),  // falsePositive
    row(false, 30, true, 70),  // falseNegative
  ];

  it('aggregates every diagnostic from the rows', () => {
    const a = analyze(rows, { bandLo: 40, bandHi: 70 });
    expect(a.n).toBe(4);
    expect(a.labelAgreement).toBeCloseTo(0.5);
    expect(a.confusion).toEqual({ falsePositive: 1, falseNegative: 1 });
    expect(typeof a.scoreMAE).toBe('number');
    expect(a.auc).not.toBeNull();
    expect(a.calibrated.bestAgreement).toBeGreaterThanOrEqual(a.labelAgreement);
    expect(a.band.lo).toBe(40);
    expect(a.band.hi).toBe(70);
    expect(a.hybrid.routedFraction).toBeGreaterThanOrEqual(0);
  });
});

describe('projectForAnalysis', () => {
  // Generic eleatic rows carry opaque output_json / expected_json / scores_json.
  // The consumer-supplied selector pulls the four AnalysisRow axes out (or null).
  interface FixtureRow {
    output: { label?: unknown; score?: unknown } | null;
    expected: { label?: unknown; score?: unknown } | null;
  }
  const toNumber = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  const select = (r: FixtureRow): AnalysisRow | null => {
    const outputLabel = r.output?.label;
    const expectedLabel = r.expected?.label;
    const outputScore = toNumber(r.output?.score);
    const expectedScore = toNumber(r.expected?.score);
    if (
      typeof outputLabel === 'boolean' &&
      typeof expectedLabel === 'boolean' &&
      outputScore !== undefined &&
      expectedScore !== undefined
    ) {
      return { outputLabel, outputScore, expectedLabel, expectedScore };
    }
    return null;
  };

  it('keeps only rows the selector fully resolves; drops incomplete rows', () => {
    const raw: FixtureRow[] = [
      { output: { label: true, score: 80 }, expected: { label: false, score: 40 } }, // ok
      { output: { label: true, score: 80 }, expected: null },                          // no expected side
      { output: { label: true }, expected: { label: false, score: 40 } },              // missing output score
      { output: { label: 'yes', score: 80 }, expected: { label: false, score: 40 } },  // label not boolean
    ];
    const rows = projectForAnalysis(raw, select);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ outputLabel: true, outputScore: 80, expectedLabel: false, expectedScore: 40 });
  });

  it('returns [] when every row maps to null', () => {
    const raw: FixtureRow[] = [{ output: null, expected: null }];
    expect(projectForAnalysis(raw, select)).toEqual([]);
  });
});

describe('aggregateScores', () => {
  it('emits exactly the scores_json scorer names, each averaged across the rows', () => {
    // Two scorers carried on each row's scores_json; the result is keyed by those
    // exact names — no eleatic-invented run-level metric names (e.g. "agreement").
    const rows = [
      { sharpness: 0.8, exposure: 0.4 },
      { sharpness: 0.6, exposure: 0.6 },
      { sharpness: 0.7, exposure: 0.5 },
    ];
    const agg = aggregateScores(rows);
    expect(Object.keys(agg).sort()).toEqual(['exposure', 'sharpness']);
    expect(agg.sharpness).toBeCloseTo((0.8 + 0.6 + 0.7) / 3);
    expect(agg.exposure).toBeCloseTo((0.4 + 0.6 + 0.5) / 3);
    expect(agg).not.toHaveProperty('agreement');
    expect(agg).not.toHaveProperty('labelAgreement');
  });

  it('averages only over the rows that carry a given scorer', () => {
    const rows = [{ a: 10 }, { a: 20, b: 100 }];
    const agg = aggregateScores(rows);
    expect(agg.a).toBeCloseTo((10 + 20) / 2);
    expect(agg.b).toBeCloseTo(100); // present on one row only
  });

  it('is an empty map for no rows', () => {
    expect(aggregateScores([])).toEqual({});
  });
});

describe('consumer-derived run-level metrics (analyze path, not aggregateScores)', () => {
  // A consumer is free to derive labelAgreement / scoreMAE / auc from `analyze`
  // and merge them under whatever metric names its gate expects — eleatic does
  // not invent those names; analyze just exposes the values.
  const rows = [
    row(true, 90, true, 85),
    row(false, 20, false, 15),
    row(true, 60, false, 40),
    row(false, 30, true, 70),
  ];

  it('analyze exposes labelAgreement and scoreMAE; auc is present-or-null per the rule', () => {
    const a = analyze(rows, { bandLo: 40, bandHi: 70 });
    expect(a.labelAgreement).toBeCloseTo(0.5);
    expect(typeof a.scoreMAE).toBe('number');
    // auc is non-null here (both classes present); null only when a class is empty.
    expect(a.auc).not.toBeNull();
    const positivesOnly = [row(true, 90, true, 85), row(true, 60, true, 40)];
    expect(analyze(positivesOnly, { bandLo: 40, bandHi: 70 }).auc).toBeNull();
  });
});

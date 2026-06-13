import { describe, it, expect } from 'vitest';
import { afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { insertEvalResult } from '../src/eval/store.js';
import {
  keepAgreement,
  confusionCounts,
  scoreMAE,
  auc,
  calibratedThreshold,
  ambiguityBand,
  hybridRouting,
  analyze,
  formatReport,
  projectRows,
  projectCostRows,
  summarizeCost,
  makeSqliteReader,
  makeSqliteCostReader,
  main,
  type AnalysisRow,
  type CostRow,
} from './analyze-experiment.js';

/**
 * A hand-built fixture set with KNOWN answers. The pure dataset-level helpers
 * (AUC, calibrated-threshold sweep, ambiguity band, hybrid routing) are
 * verified against these by-hand calculations — no Braintrust read, no network.
 *
 * Convention per row: `[outputKeep, outputScore, expectedKeep, expectedScore]`.
 * outputScore is the Gemini qualityScore (0–100, the ranking signal);
 * expectedScore is the Opus qualityScore (the band axis).
 */
function row(outputKeep: boolean, outputScore: number, expectedKeep: boolean, expectedScore: number): AnalysisRow {
  return { outputKeep, outputScore, expectedKeep, expectedScore };
}

describe('keepAgreement', () => {
  it('is the fraction of rows where output.keep === expected.keep', () => {
    const rows = [
      row(true, 80, true, 85),   // agree
      row(false, 20, false, 15), // agree
      row(true, 60, false, 40),  // disagree (falseKeep)
      row(false, 30, true, 70),  // disagree (falseReplace)
    ];
    expect(keepAgreement(rows)).toBeCloseTo(0.5);
  });

  it('is 1 for a perfectly-agreeing set and 0 for a fully-disagreeing set', () => {
    expect(keepAgreement([row(true, 80, true, 80), row(false, 10, false, 10)])).toBe(1);
    expect(keepAgreement([row(true, 80, false, 10), row(false, 10, true, 80)])).toBe(0);
  });
});

describe('confusionCounts', () => {
  it('counts falseKeep (output keeps, expected replaces) and falseReplace', () => {
    const rows = [
      row(true, 80, true, 85),
      row(true, 60, false, 40),  // falseKeep
      row(true, 55, false, 30),  // falseKeep
      row(false, 30, true, 70),  // falseReplace
    ];
    expect(confusionCounts(rows)).toEqual({ falseKeep: 2, falseReplace: 1 });
  });
});

describe('scoreMAE', () => {
  it('is the mean absolute difference of the quality scores', () => {
    const rows = [
      row(true, 80, true, 70),  // |80-70| = 10
      row(false, 20, false, 50), // |20-50| = 30
    ];
    // mean(10, 30) = 20
    expect(scoreMAE(rows)).toBeCloseTo(20);
  });
});

describe('auc', () => {
  // AUC = P(a random keep-positive outranks a random keep-negative) by the
  // output score. Use Opus `keep` as the positive label, Gemini score as rank.
  it('is 1.0 when the output score perfectly separates the keep classes', () => {
    const rows = [
      row(true, 90, true, 0),   // positive (Opus keep), high score
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
  // Sweep a score threshold t: predict keep iff outputScore >= t, then measure
  // boolean agreement against Opus keep. Report the best agreement + winning t.
  it('finds the threshold maximizing boolean agreement against Opus keep', () => {
    // Opus keeps the two high-Gemini-score rows, replaces the two low ones.
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
    // Interleaved: keep at 30, replace at 80 — no monotone score split works.
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
});

describe('ambiguityBand', () => {
  // Count disagreements whose Opus (expected) score sits inside [lo, hi].
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
  // Route any row whose Gemini score lands in the mid-band [lo, hi] to Opus
  // (auto-correct). Outside the band, keep Gemini's decision.
  it('routes mid-band rows to Opus, leaving the rest on Gemini', () => {
    const rows = [
      row(true, 55, false, 30),  // in band → routed → auto-correct (was falseKeep)
      row(false, 60, true, 70),  // in band → routed → auto-correct (was falseReplace)
      row(true, 90, true, 85),   // out of band, Gemini agrees
      row(true, 95, false, 20),  // out of band, Gemini WRONG (residual falseKeep)
      row(false, 10, false, 15), // out of band, Gemini agrees
    ];
    const res = hybridRouting(rows, 50, 70);
    expect(res.routed).toBe(2);
    expect(res.routedFraction).toBeCloseTo(2 / 5);
    // After routing: the 2 routed become correct; out-of-band keep Gemini's
    // call. Agreement = (2 routed-correct + agrees) / total.
    // out-of-band: row3 agree, row4 disagree, row5 agree → 2 correct of 3.
    // total correct = 2 + 2 = 4 of 5.
    expect(res.autoSetAgreement).toBeCloseTo(4 / 5);
    // residual falseKeep: out-of-band rows where Gemini keeps but Opus replaces.
    expect(res.residualFalseKeep).toBe(1); // row4 (score 95, Gemini keep, Opus replace)
  });
});

describe('analyze + formatReport', () => {
  const rows = [
    row(true, 90, true, 85),
    row(false, 20, false, 15),
    row(true, 60, false, 40),  // falseKeep
    row(false, 30, true, 70),  // falseReplace
  ];

  it('analyze aggregates every diagnostic from the injected rows', () => {
    const a = analyze(rows, { bandLo: 40, bandHi: 70 });
    expect(a.n).toBe(4);
    expect(a.keepAgreement).toBeCloseTo(0.5);
    expect(a.confusion).toEqual({ falseKeep: 1, falseReplace: 1 });
    expect(typeof a.scoreMAE).toBe('number');
    expect(a.auc).not.toBeNull();
    expect(a.calibrated.bestAgreement).toBeGreaterThanOrEqual(a.keepAgreement);
    expect(a.band.lo).toBe(40);
    expect(a.band.hi).toBe(70);
    expect(a.hybrid.routedFraction).toBeGreaterThanOrEqual(0);
  });

  it('formatReport renders every required metric label', () => {
    const a = analyze(rows, { bandLo: 40, bandHi: 70 });
    const text = formatReport('exp-name', a);
    for (const label of [
      'keep agreement',
      'falseKeep',
      'falseReplace',
      'score MAE',
      'AUC',
      'calibrated',
      'threshold',
      'band',
      'hybrid',
      'routed',
    ]) {
      expect(text.toLowerCase()).toContain(label.toLowerCase());
    }
  });
});

describe('projectRows', () => {
  it('keeps only rows with both keep flags and both numeric scores', () => {
    const raw = [
      { output: { keep: true, qualityScore: 80 }, expected: { keep: false, qualityScore: 40 } }, // ok
      { output: { keep: true, qualityScore: 80 }, expected: null },                               // no expected (nested span)
      { output: { keep: true }, expected: { keep: false, qualityScore: 40 } },                     // missing output score
      { output: { keep: 'yes', qualityScore: 80 }, expected: { keep: false, qualityScore: 40 } },  // keep not boolean
    ];
    const rows = projectRows(raw);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ outputKeep: true, outputScore: 80, expectedKeep: false, expectedScore: 40 });
  });
});

describe('summarizeCost', () => {
  // #1088: sum metrics.estimated_cost across judgment spans, report total + mean
  // + the unpriced count so a known-partial total is flagged, not hidden.
  function costRow(estimatedCost: number | undefined): CostRow {
    return { estimatedCost };
  }

  it('sums priced rows and counts unpriced ones', () => {
    const rows = [costRow(0.5), costRow(1.5), costRow(undefined), costRow(2.0)];
    const s = summarizeCost(rows);
    expect(s.totalUsd).toBeCloseTo(4.0);
    expect(s.pricedCount).toBe(3);
    expect(s.unpricedCount).toBe(1);
    // mean is over the PRICED rows (the unpriced have no known cost to average).
    expect(s.meanUsd).toBeCloseTo(4.0 / 3);
  });

  it('is all-zero when there are no rows', () => {
    expect(summarizeCost([])).toEqual({ totalUsd: 0, meanUsd: 0, pricedCount: 0, unpricedCount: 0 });
  });

  it('reports total 0 / mean 0 when every row is unpriced', () => {
    const s = summarizeCost([costRow(undefined), costRow(undefined)]);
    expect(s.totalUsd).toBe(0);
    expect(s.meanUsd).toBe(0);
    expect(s.pricedCount).toBe(0);
    expect(s.unpricedCount).toBe(2);
  });
});

describe('projectCostRows', () => {
  // Project loosely-typed bt-sql rows onto CostRow: a span carrying token
  // metrics is one judgment; estimated_cost is present (priced) or absent
  // (unpriced). Rows with no token metrics (root spans) are not judgments → dropped.
  it('keeps judgment spans (token metrics present); cost present=priced, absent=unpriced', () => {
    const raw = [
      { metrics: { prompt_tokens: 1000, completion_tokens: 200, estimated_cost: 0.42 } }, // priced
      { metrics: { prompt_tokens: 800, completion_tokens: 100 } },                          // unpriced (no cost key)
      { metrics: { latency: 1.2 } },                                                        // root span, no tokens → dropped
      { metrics: null },                                                                    // no metrics → dropped
      {},                                                                                    // no metrics → dropped
    ];
    const rows = projectCostRows(raw);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ estimatedCost: 0.42 });
    expect(rows[1]).toEqual({ estimatedCost: undefined });
  });
});

describe('formatReport includes cost', () => {
  it('prints total + mean cost and the unpriced count', () => {
    const rows = [row(true, 90, true, 85), row(false, 20, false, 15)];
    const a = analyze(rows, { bandLo: 40, bandHi: 70 });
    const cost = summarizeCost([{ estimatedCost: 0.5 }, { estimatedCost: undefined }]);
    const text = formatReport('exp-name', a, cost);
    expect(text.toLowerCase()).toContain('cost');
    expect(text).toContain('$0.50'); // total
    expect(text.toLowerCase()).toContain('unpriced');
    expect(text).toContain('1'); // unpriced count
  });

  it('omits the cost block when cost summary is absent (back-compat)', () => {
    const rows = [row(true, 90, true, 85)];
    const a = analyze(rows, { bandLo: 40, bandHi: 70 });
    const text = formatReport('exp-name', a);
    expect(text.toLowerCase()).not.toContain('total cost');
  });
});

describe('main (injected reader, no network)', () => {
  it('returns 2 and prints usage when no experiment is given', async () => {
    const reader = async () => [];
    const code = await main([], reader);
    expect(code).toBe(2);
  });

  it('returns 1 when the experiment has no usable rows', async () => {
    const reader = async () => [] as AnalysisRow[];
    const code = await main(['exp-empty'], reader);
    expect(code).toBe(1);
  });

  it('returns 0 and reads via the injected reader for a populated experiment', async () => {
    let asked: string | undefined;
    const reader = async (exp: string): Promise<AnalysisRow[]> => {
      asked = exp;
      return [row(true, 90, true, 85), row(false, 20, false, 15)];
    };
    const code = await main(['exp-real', '--band', '45:65'], reader);
    expect(code).toBe(0);
    expect(asked).toBe('exp-real');
  });
});

describe('sqlite readers (#1094 — local store repoint)', () => {
  let db: Database.Database | undefined;
  afterEach(() => {
    db?.close();
    db = undefined;
  });

  /** Seed one eval_result row for a run. */
  function seed(d: Database.Database, runId: string, over: Partial<Parameters<typeof insertEvalResult>[1]>): void {
    insertEvalResult(d, {
      runId,
      speciesCode: over.speciesCode ?? 'amerob',
      comName: 'American Robin',
      contentHash: 'h',
      sourceUrl: 'u',
      geminiKeep: over.geminiKeep ?? true,
      geminiQuality: over.geminiQuality ?? 80,
      geminiCriteriaJson: null,
      opusKeep: over.opusKeep ?? true,
      opusQuality: over.opusQuality ?? 85,
      cost: over.cost,
      promptTokens: over.promptTokens,
      completionTokens: over.completionTokens,
    });
  }

  it('makeSqliteReader yields AnalysisRow[] from eval_result for the run', async () => {
    db = openDb(':memory:');
    seed(db, 'run-1', { speciesCode: 'a', geminiKeep: true, geminiQuality: 90, opusKeep: true, opusQuality: 85 });
    seed(db, 'run-1', { speciesCode: 'b', geminiKeep: false, geminiQuality: 20, opusKeep: false, opusQuality: 15 });
    seed(db, 'run-2', { speciesCode: 'c', geminiKeep: true, geminiQuality: 99, opusKeep: false, opusQuality: 10 });

    const reader = makeSqliteReader(db);
    const rows = await reader('run-1');
    expect(rows).toHaveLength(2); // only run-1's rows
    expect(rows).toEqual(
      expect.arrayContaining([
        { outputKeep: true, outputScore: 90, expectedKeep: true, expectedScore: 85 },
        { outputKeep: false, outputScore: 20, expectedKeep: false, expectedScore: 15 },
      ]),
    );
  });

  it('makeSqliteCostReader yields CostRow[]; priced rows carry cost, unpriced → undefined', async () => {
    db = openDb(':memory:');
    seed(db, 'run-1', { speciesCode: 'a', cost: 0.42, promptTokens: 1000, completionTokens: 100 });
    seed(db, 'run-1', { speciesCode: 'b', cost: undefined, promptTokens: 800, completionTokens: 50 }); // unpriced
    seed(db, 'run-2', { speciesCode: 'c', cost: 9.99, promptTokens: 1, completionTokens: 1 });

    const costReader = makeSqliteCostReader(db);
    const rows = await costReader('run-1');
    expect(rows).toHaveLength(2);
    const costs = rows.map((r) => r.estimatedCost);
    // one priced (0.42), one unpriced (undefined) — order-independent.
    expect(costs).toContain(0.42);
    expect(costs).toContain(undefined);
  });

  it('makeSqliteReader returns [] for an unknown run id', async () => {
    db = openDb(':memory:');
    const reader = makeSqliteReader(db);
    expect(await reader('nope')).toEqual([]);
  });
});

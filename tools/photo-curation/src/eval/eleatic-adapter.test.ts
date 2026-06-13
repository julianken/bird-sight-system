import { describe, it, expect } from 'vitest';
import {
  PHOTO_JUDGE_GATE,
  makeReader,
  openStore,
  toEleaticRow,
  toEleaticRun,
  fromEleaticRow,
  costFromEleaticRow,
  type EvalResultRecord,
  type EvalRunRecord,
} from './eleatic-adapter.js';

/** A photo-judge result record with controllable keep/score/criteria fields. */
function result(over: Partial<EvalResultRecord> = {}): EvalResultRecord {
  return {
    runId: 'run-1',
    speciesCode: 'amerob',
    comName: 'American Robin',
    contentHash: 'hash-amerob',
    sourceUrl: 'https://photos.bird-maps.com/amerob.jpeg',
    geminiKeep: true,
    geminiQuality: 80,
    geminiCriteriaJson: JSON.stringify({ framing: 8, subjectClarity: 9 }),
    opusKeep: true,
    opusQuality: 85,
    cost: 0.0042,
    promptTokens: 1000,
    completionTokens: 100,
    ...over,
  };
}

/** A photo-judge run record. */
function run(over: Partial<EvalRunRecord> = {}): EvalRunRecord {
  return {
    id: 'run-1',
    model: 'gemini-2.5-flash',
    baselineModel: 'claude-opus-4-8',
    baselineRubric: '0.2.1',
    sampleSize: 150,
    startedAt: '2026-06-12T00:00:00.000Z',
    agreement: 0.8,
    falseKeep: 5,
    falseReplace: 27,
    scoreMae: 0.92,
    totalCost: 12.34,
    ...over,
  };
}

describe('toEleaticRow', () => {
  it('maps identity, label, image_url, content_hash from the photo-judge record', () => {
    const row = toEleaticRow(result());
    expect(row.runId).toBe('run-1');
    expect(row.rowKey).toBe('amerob');
    expect(row.label).toBe('American Robin');
    expect(row.imageUrl).toBe('https://photos.bird-maps.com/amerob.jpeg');
    expect(row.contentHash).toBe('hash-amerob');
  });

  it('embeds output_json = {keep, qualityScore, criteria} with criteria PARSED (not double-encoded)', () => {
    const row = toEleaticRow(result());
    expect(row.output).toEqual({
      keep: true,
      qualityScore: 80,
      // the criteria string was JSON.parsed into a clean object, NOT left as a string.
      criteria: { framing: 8, subjectClarity: 9 },
    });
    // load-bearing: the criteria value is an object, never the raw JSON string.
    expect(typeof (row.output as { criteria: unknown }).criteria).toBe('object');
  });

  it('omits criteria when geminiCriteriaJson is null (null-guarded → absent, not undefined)', () => {
    const row = toEleaticRow(result({ geminiCriteriaJson: null }));
    expect(row.output).toEqual({ keep: true, qualityScore: 80 });
    expect('criteria' in (row.output as object)).toBe(false);
  });

  it('embeds expected_json = {keep, qualityScore} from the opus baseline (no opus criteria source → absent)', () => {
    const row = toEleaticRow(result({ opusKeep: false, opusQuality: 30 }));
    expect(row.expected).toEqual({ keep: false, qualityScore: 30 });
    expect('criteria' in (row.expected as object)).toBe(false);
  });

  it('puts numeric axes in scores_json = {outputQuality, expectedQuality, cost} when priced', () => {
    const row = toEleaticRow(result({ geminiQuality: 70, opusQuality: 90, cost: 0.0042 }));
    expect(row.scores).toEqual({ outputQuality: 70, expectedQuality: 90, cost: 0.0042 });
  });

  it('omits the cost axis when the judgment is unpriced (cost undefined → absent key)', () => {
    const row = toEleaticRow(result({ geminiQuality: 70, opusQuality: 90, cost: undefined }));
    expect(row.scores).toEqual({ outputQuality: 70, expectedQuality: 90 });
    expect('cost' in row.scores!).toBe(false);
  });

  describe('disagreement matrix (metadata.disagreement) — all 4 cells', () => {
    it('agree when both keep', () => {
      expect(toEleaticRow(result({ geminiKeep: true, opusKeep: true })).metadata).toEqual({
        disagreement: 'agree',
      });
    });
    it('agree when both replace', () => {
      expect(toEleaticRow(result({ geminiKeep: false, opusKeep: false })).metadata).toEqual({
        disagreement: 'agree',
      });
    });
    it('falseKeep when gemini keep ∧ ¬opus keep', () => {
      expect(toEleaticRow(result({ geminiKeep: true, opusKeep: false })).metadata).toEqual({
        disagreement: 'falseKeep',
      });
    });
    it('falseReplace when ¬gemini keep ∧ opus keep', () => {
      expect(toEleaticRow(result({ geminiKeep: false, opusKeep: true })).metadata).toEqual({
        disagreement: 'falseReplace',
      });
    });
  });

  it('omits image_url when sourceUrl is empty (exactOptional — absent key, not undefined)', () => {
    const row = toEleaticRow(result({ sourceUrl: '' }));
    expect('imageUrl' in row).toBe(false);
  });

  it('omits content_hash when contentHash is empty', () => {
    const row = toEleaticRow(result({ contentHash: '' }));
    expect('contentHash' in row).toBe(false);
  });
});

describe('toEleaticRun', () => {
  it('maps id, label=model, baseline=baselineModel, startedAt, sampleSize→config', () => {
    const r = toEleaticRun(run());
    expect(r.id).toBe('run-1');
    expect(r.label).toBe('gemini-2.5-flash');
    expect(r.baseline).toBe('claude-opus-4-8');
    expect(r.startedAt).toBe('2026-06-12T00:00:00.000Z');
    expect(r.config).toEqual({
      baselineModel: 'claude-opus-4-8',
      baselineRubric: '0.2.1',
      sampleSize: 150,
    });
  });

  it('stores metrics as the SAME 0–1 fractions (0.8 must NOT become 80)', () => {
    const r = toEleaticRun(run({ agreement: 0.8, scoreMae: 0.92 }));
    expect(r.metrics).toEqual({
      agreement: 0.8,
      falseKeep: 5,
      falseReplace: 27,
      scoreMae: 0.92,
      totalCost: 12.34,
    });
    // explicit fraction guard — agreement is the fraction, not a percent.
    expect(r.metrics!.agreement).toBe(0.8);
    expect(r.metrics!.agreement).not.toBe(80);
    expect(r.metrics!.scoreMae).toBe(0.92);
    expect(r.metrics!.scoreMae).not.toBe(92);
  });
});

describe('PHOTO_JUDGE_GATE', () => {
  it('is agreement >= 0.90', () => {
    expect(PHOTO_JUDGE_GATE).toEqual({ metric: 'agreement', op: 'gte', threshold: 0.9 });
  });
});

describe('fromEleaticRow', () => {
  it('round-trips a stored row back to an AnalysisRow', () => {
    const store = openStore(':memory:');
    store.recordRun(toEleaticRun(run()));
    store.recordRow(
      toEleaticRow(
        result({ geminiKeep: true, geminiQuality: 77, opusKeep: false, opusQuality: 33 }),
      ),
    );
    const reader = makeReader(store.db);
    const [stored] = reader.getRows('run-1');
    expect(stored).toBeDefined();

    const analysis = fromEleaticRow(stored!);
    expect(analysis).toEqual({
      outputKeep: true,
      outputScore: 77,
      expectedKeep: false,
      expectedScore: 33,
    });
    store.close();
  });
});

describe('costFromEleaticRow', () => {
  it('round-trips a priced row back to {estimatedCost: number}', () => {
    const store = openStore(':memory:');
    store.recordRun(toEleaticRun(run()));
    store.recordRow(toEleaticRow(result({ cost: 0.0042 })));
    const reader = makeReader(store.db);
    const [stored] = reader.getRows('run-1');
    expect(costFromEleaticRow(stored!)).toEqual({ estimatedCost: 0.0042 });
    store.close();
  });

  it('round-trips an unpriced row (no cost axis) back to {estimatedCost: undefined}', () => {
    const store = openStore(':memory:');
    store.recordRun(toEleaticRun(run()));
    store.recordRow(toEleaticRow(result({ cost: undefined })));
    const reader = makeReader(store.db);
    const [stored] = reader.getRows('run-1');
    expect(costFromEleaticRow(stored!)).toEqual({ estimatedCost: undefined });
    store.close();
  });
});

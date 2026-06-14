import { describe, it, expect } from 'vitest';
import {
  PHOTO_JUDGE_GATE,
  makeReader,
  openStore,
  toEleaticRow,
  toEleaticRun,
  buildTrace,
  buildTraceSpan,
  fromEleaticRow,
  costFromEleaticRow,
  type EvalResultRecord,
  type EvalRunRecord,
  type JudgeTraceInput,
  type ScorerSpanInput,
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
    rationale: 'sharp eye, clean perch',
    fieldMarks: ['rufous breast', 'yellow bill'],
    flags: [],
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
    // why-fields absent so this test isolates the criteria mapping (their own
    // round-trip is covered below).
    const row = toEleaticRow(result({ rationale: undefined, fieldMarks: undefined, flags: undefined }));
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
    const row = toEleaticRow(
      result({ geminiCriteriaJson: null, rationale: undefined, fieldMarks: undefined, flags: undefined }),
    );
    expect(row.output).toEqual({ keep: true, qualityScore: 80 });
    expect('criteria' in (row.output as object)).toBe(false);
  });

  it('copies the judge "why" — rationale/fieldMarks/flags — into output_json when present', () => {
    const row = toEleaticRow(
      result({
        rationale: 'sharp eye, clean perch',
        fieldMarks: ['rufous breast', 'yellow bill'],
        flags: ['watermark'],
      }),
    );
    const output = row.output as {
      rationale?: string;
      fieldMarks?: string[];
      flags?: string[];
    };
    expect(output.rationale).toBe('sharp eye, clean perch');
    expect(output.fieldMarks).toEqual(['rufous breast', 'yellow bill']);
    expect(output.flags).toEqual(['watermark']);
  });

  it('carries an EMPTY fieldMarks/flags array through (empty ≠ absent — the judge ran but named none)', () => {
    const row = toEleaticRow(result({ fieldMarks: [], flags: [] }));
    const output = row.output as { fieldMarks?: string[]; flags?: string[] };
    expect(output.fieldMarks).toEqual([]);
    expect(output.flags).toEqual([]);
    // present-but-empty: the keys exist (the judge produced them), the arrays are empty.
    expect('fieldMarks' in output).toBe(true);
    expect('flags' in output).toBe(true);
  });

  it('omits each why-field when the source output lacked it (exactOptional — absent key, not undefined)', () => {
    const row = toEleaticRow(
      result({ rationale: undefined, fieldMarks: undefined, flags: undefined }),
    );
    const output = row.output as object;
    expect('rationale' in output).toBe(false);
    expect('fieldMarks' in output).toBe(false);
    expect('flags' in output).toBe(false);
    // the unrelated keep/qualityScore/criteria mapping is untouched.
    expect(row.output).toEqual({
      keep: true,
      qualityScore: 80,
      criteria: { framing: 8, subjectClarity: 9 },
    });
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

/** A full trace-span input the runner assembles from record.input + prompt + record. */
function traceInput(over: Partial<JudgeTraceInput> = {}): JudgeTraceInput {
  return {
    prompt: 'rubric prompt v0.2.1',
    imageUrl: 'https://photos.bird-maps.com/amerob.jpeg',
    comName: 'American Robin',
    sciName: 'Turdus migratorius',
    family: 'Turdidae',
    rubricVersion: '0.2.1',
    model: 'gemini-2.5-flash',
    parsed: {
      fieldMarks: ['rufous breast'],
      criteria: { framing: 8, subjectClarity: 9, liveness: 10, naturalness: 9, pose: 7, background: 8, lighting: 8 },
      flags: [],
      keep: true,
      qualityScore: 85,
      rationale: 'sharp wild adult',
    },
    raw: { candidates: [{ content: { parts: [{ text: '{...}' }] } }], usageMetadata: { promptTokenCount: 1000 } },
    promptTokens: 1000,
    completionTokens: 100,
    latencyMs: 350,
    costUsd: 0.0042,
    ...over,
  };
}

/** One span as emitted in the trace envelope (every field producer-optional). */
interface TraceSpan {
  id: string;
  parentId: string | null;
  name: string;
  kind: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  usage?: Record<string, number>;
  scores?: Record<string, number>;
}

/** Pull the spans array out of a buildTrace/buildTraceSpan return blob. */
function spansOf(blob: unknown): TraceSpan[] {
  return (blob as { spans: TraceSpan[] }).spans;
}

/** Locate a span by its row-local id. */
function spanById(spans: TraceSpan[], id: string): TraceSpan {
  const s = spans.find((sp) => sp.id === id);
  if (s === undefined) throw new Error(`no span with id ${id}`);
  return s;
}

describe('buildTrace — eval→task→judge + scorer-child tree (T2, #1187)', () => {
  /** The three structural scorer inputs the runner assembles for a real row. */
  const scorers: ScorerSpanInput[] = [
    { name: 'keep_agreement', score: 1 },
    { name: 'score_mae', score: 0.92 },
    { name: 'keep_confusion', detail: { falseKeep: 0, falseReplace: 1 } },
    { name: 'criteria_mae_framing', score: 0.8 },
  ];

  it('emits the eval→task→judge spine plus one child span per scorer', () => {
    const spans = spansOf(buildTrace(traceInput(), scorers));
    // 3 structural (eval/task/judge) + 4 scorer leaves.
    expect(spans).toHaveLength(7);
    expect(spans.map((s) => s.id)).toEqual([
      'eval',
      'task',
      'judge',
      'scorer:keep_agreement',
      'scorer:score_mae',
      'scorer:keep_confusion',
      'scorer:criteria_mae_framing',
    ]);
  });

  it('wires the structural spine: eval(root)→task→judge with the right kinds', () => {
    const spans = spansOf(buildTrace(traceInput(), scorers));
    const evalSpan = spanById(spans, 'eval');
    expect(evalSpan).toMatchObject({ id: 'eval', parentId: null, name: 'eval', kind: 'eval' });
    const task = spanById(spans, 'task');
    expect(task).toMatchObject({ id: 'task', parentId: 'eval', name: 'task', kind: 'task' });
    const judge = spanById(spans, 'judge');
    expect(judge).toMatchObject({ id: 'judge', parentId: 'task', name: 'judge', kind: 'llm' });
  });

  it('parents every scorer leaf on the task span with kind:scorer', () => {
    const spans = spansOf(buildTrace(traceInput(), scorers));
    for (const name of ['keep_agreement', 'score_mae', 'keep_confusion', 'criteria_mae_framing']) {
      const leaf = spanById(spans, `scorer:${name}`);
      expect(leaf.parentId).toBe('task');
      expect(leaf.kind).toBe('scorer');
      expect(leaf.name).toBe(name);
    }
  });

  it('carries TODAY’S judge content VERBATIM (nested input.species, output.{parsed,raw}, usage)', () => {
    const judge = spanById(spansOf(buildTrace(traceInput(), scorers)), 'judge');
    expect(judge.input).toEqual({
      prompt: 'rubric prompt v0.2.1',
      imageUrl: 'https://photos.bird-maps.com/amerob.jpeg',
      species: { comName: 'American Robin', sciName: 'Turdus migratorius', family: 'Turdidae' },
      rubricVersion: '0.2.1',
      model: 'gemini-2.5-flash',
    });
    expect(judge.output).toEqual({
      raw: { candidates: [{ content: { parts: [{ text: '{...}' }] } }], usageMetadata: { promptTokenCount: 1000 } },
      parsed: traceInput().parsed,
    });
    expect(judge.usage).toEqual({
      promptTokens: 1000,
      completionTokens: 100,
      latencyMs: 350,
      costUsd: 0.0042,
    });
  });

  it('keeps the judge leaf the ONLY span carrying usage (eval/task/scorer carry none)', () => {
    const spans = spansOf(buildTrace(traceInput(), scorers));
    for (const id of ['eval', 'task', 'scorer:keep_agreement', 'scorer:score_mae', 'scorer:keep_confusion', 'scorer:criteria_mae_framing']) {
      expect('usage' in spanById(spans, id)).toBe(false);
    }
    // exactly one span has usage, and it is the judge leaf.
    expect(spans.filter((s) => 'usage' in s).map((s) => s.id)).toEqual(['judge']);
  });

  it('maps a score-bearing scorer to span.scores[name] with no output', () => {
    const spans = spansOf(buildTrace(traceInput(), scorers));
    const keepAgreement = spanById(spans, 'scorer:keep_agreement');
    expect(keepAgreement.scores).toEqual({ keep_agreement: 1 });
    expect('output' in keepAgreement).toBe(false);
    const scoreMae = spanById(spans, 'scorer:score_mae');
    expect(scoreMae.scores).toEqual({ score_mae: 0.92 });
    const criteria = spanById(spans, 'scorer:criteria_mae_framing');
    expect(criteria.scores).toEqual({ criteria_mae_framing: 0.8 });
  });

  it('renders keep_confusion as DETAIL-ONLY (output, no scores bar — Decision 1 locked)', () => {
    const confusion = spanById(spansOf(buildTrace(traceInput(), scorers)), 'scorer:keep_confusion');
    expect(confusion.output).toEqual({ falseKeep: 0, falseReplace: 1 });
    // the keepConfusion 0/1 score is NOT carried as a scores bar.
    expect('scores' in confusion).toBe(false);
  });

  it('still emits the full spine for a single judge call with NO scorers (Decision 3)', () => {
    const spans = spansOf(buildTrace(traceInput(), []));
    expect(spans.map((s) => s.id)).toEqual(['eval', 'task', 'judge']);
  });

  it('preserves the judge leaf’s exactOptional usage/output guards (absent fields omitted)', () => {
    const spans = spansOf(
      buildTrace(traceInput({ promptTokens: undefined, completionTokens: undefined, costUsd: undefined, raw: undefined, imageUrl: undefined }), []),
    );
    const judge = spanById(spans, 'judge');
    expect(judge.usage).toEqual({ latencyMs: 350 });
    expect('promptTokens' in judge.usage!).toBe(false);
    expect('raw' in judge.output!).toBe(false);
    expect('imageUrl' in judge.input!).toBe(false);
  });
});

describe('buildTraceSpan — thin alias yielding the eval→task→judge spine (Decision 3)', () => {
  it('deep-equals buildTrace(t, []) — the 3-node spine, NOT a lone span', () => {
    const t = traceInput();
    expect(buildTraceSpan(t)).toEqual(buildTrace(t, []));
    expect(spansOf(buildTraceSpan(t)).map((s) => s.id)).toEqual(['eval', 'task', 'judge']);
  });

  it('builds the judge leaf content VERBATIM (nested input.species/output/usage)', () => {
    const judge = spanById(spansOf(buildTraceSpan(traceInput())), 'judge');
    expect(judge.name).toBe('judge');
    expect(judge.input).toEqual({
      prompt: 'rubric prompt v0.2.1',
      imageUrl: 'https://photos.bird-maps.com/amerob.jpeg',
      species: { comName: 'American Robin', sciName: 'Turdus migratorius', family: 'Turdidae' },
      rubricVersion: '0.2.1',
      model: 'gemini-2.5-flash',
    });
    expect(judge.output).toEqual({
      raw: { candidates: [{ content: { parts: [{ text: '{...}' }] } }], usageMetadata: { promptTokenCount: 1000 } },
      parsed: traceInput().parsed,
    });
    expect(judge.usage).toEqual({
      promptTokens: 1000,
      completionTokens: 100,
      latencyMs: 350,
      costUsd: 0.0042,
    });
  });

  it('omits absent usage fields on the judge leaf (exactOptional)', () => {
    const judge = spanById(
      spansOf(buildTraceSpan(traceInput({ promptTokens: undefined, completionTokens: undefined, costUsd: undefined }))),
      'judge',
    );
    expect(judge.usage).toEqual({ latencyMs: 350 });
    expect('promptTokens' in judge.usage!).toBe(false);
    expect('completionTokens' in judge.usage!).toBe(false);
    expect('costUsd' in judge.usage!).toBe(false);
  });

  it('omits the raw output field on the judge leaf when no raw response was captured', () => {
    const judge = spanById(spansOf(buildTraceSpan(traceInput({ raw: undefined }))), 'judge');
    expect('raw' in judge.output!).toBe(false);
    expect(judge.output!.parsed).toEqual(traceInput().parsed);
  });

  it('omits the imageUrl input field on the judge leaf when the image has no portable URL', () => {
    const judge = spanById(spansOf(buildTraceSpan(traceInput({ imageUrl: undefined }))), 'judge');
    expect('imageUrl' in judge.input!).toBe(false);
  });
});

describe('toEleaticRow — trace threading (T3, #1168)', () => {
  it('omits row.trace when no trace is passed (T1/T2 callers unchanged)', () => {
    const row = toEleaticRow(result());
    expect('trace' in row).toBe(false);
  });

  it('threads a passed trace onto row.trace verbatim', () => {
    const trace = buildTraceSpan(traceInput());
    const row = toEleaticRow(result(), trace);
    expect(row.trace).toEqual(trace);
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

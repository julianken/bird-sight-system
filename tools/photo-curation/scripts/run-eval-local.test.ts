import { describe, it, expect, afterEach } from 'vitest';
import { makeReader, openStore, type EleaticStore } from '../src/eval/eleatic-adapter.js';
import { instrumentedJudge, type JudgmentSink } from '../src/judges/instrumented.js';
import { runEvalLocal, type RunEvalDeps } from './run-eval-local.js';
import type { EvalRow } from '../src/eval/build-dataset.js';
import type { ImageInput, SpeciesContext, JudgeOutput, VisionJudge } from '@bird-watch/photo-quality';

let eleatic: EleaticStore | undefined;
afterEach(() => {
  eleatic?.close();
  eleatic = undefined;
});

/** Build one eval row with a controllable Opus baseline + species fields. */
function evalRow(opts: {
  speciesCode: string;
  expectedKeep: boolean;
  expectedQuality: number;
}): EvalRow {
  return {
    input: {
      readPath: `/thumbs/${opts.speciesCode}.jpg`,
      imageUrl: `https://photos.bird-maps.com/${opts.speciesCode}.jpeg`,
      speciesCode: opts.speciesCode,
      comName: `Common ${opts.speciesCode}`,
      sciName: `Sci ${opts.speciesCode}`,
      family: 'Testidae',
    },
    expected: { keep: opts.expectedKeep, qualityScore: opts.expectedQuality },
    metadata: { contentHash: `hash-${opts.speciesCode}`, expectedRubricVersion: '0.2.1' },
  };
}

/**
 * A fake judge whose keep/quality is a function of the species code, so a test
 * can dial in exactly how many rows agree with the baseline. Returns a fixed
 * criteria object. The injected `usage` is read by the instrumented wrapper.
 */
function fakeJudge(sink: JudgmentSink, decide: (code: string) => { keep: boolean; quality: number }): VisionJudge {
  const inner: VisionJudge = {
    async judge(_img: ImageInput, ctx: SpeciesContext): Promise<JudgeOutput> {
      const d = decide(ctx.speciesCode);
      return {
        fieldMarks: ['mark'],
        criteria: { framing: 8, subjectClarity: 8, liveness: 8, naturalness: 8, pose: 8, background: 8, lighting: 8 },
        flags: [],
        keep: d.keep,
        qualityScore: d.quality,
        rationale: 'r',
      };
    },
  };
  return instrumentedJudge(inner, {
    model: 'gemini-2.5-flash',
    rubricVersion: '0.2.1',
    sink,
    // a fixed, priced usage so every judgment carries a known cost.
    usage: () => ({ promptTokenCount: 1000, candidatesTokenCount: 100, totalTokenCount: 1100 }),
    // a deterministic latency clock (before/after) → latencyMs = 250 per call.
    now: makeStepClock(1000, 250),
    // a fixed raw envelope so the trace span's output.raw round-trips.
    rawResponse: () => FAKE_RAW,
  });
}

/** The raw model envelope the fakeJudge reports — flows into the trace span. */
const FAKE_RAW = { candidates: [{ content: { parts: [{ text: '{...}' }] } }], usageMetadata: { promptTokenCount: 1000 } };

/** A monotonic clock that returns `start, start+step, start+2*step, …` on each call. */
function makeStepClock(start: number, step: number): () => number {
  let i = 0;
  return () => start + step * i++;
}

/** One span as emitted in the trace TREE envelope (every field producer-optional). */
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

/** Decode the opaque trace_json blob into its spans array. */
function traceSpans(trace: unknown): TraceSpan[] {
  return (trace as { spans: TraceSpan[] }).spans;
}

/** Locate a span by its row-local id. */
function spanById(spans: TraceSpan[], id: string): TraceSpan {
  const s = spans.find((sp) => sp.id === id);
  if (s === undefined) throw new Error(`no span with id ${id}`);
  return s;
}

/** Deps with a fake readImage (no fs) and a judge factory closing over `decide`. */
function makeDeps(decide: (code: string) => { keep: boolean; quality: number }): Omit<RunEvalDeps, 'rows' | 'eleatic'> {
  return {
    runId: 'run-test-1',
    model: 'gemini-2.5-flash',
    baselineModel: 'claude-opus-4-8',
    baselineRubric: '0.2.1',
    sampleSize: 5,
    startedAt: '2026-06-12T00:00:00.000Z',
    prompt: 'rubric prompt',
    readImage: (p: string): ImageInput => ({ buffer: Buffer.from(`bytes:${p}`), mime: 'image/jpeg' }),
    makeJudge: (sink) => fakeJudge(sink, decide),
  };
}

describe('runEvalLocal', () => {
  it('writes one eleatic eval row per row + one run header with FRACTION-form aggregates', async () => {
    eleatic = openStore(':memory:');
    // 5 rows. Baseline keeps the first 4, replaces the 5th. The judge AGREES on
    // 4 of 5 (it flips only the last). Per the #1094 unit contract, agreement
    // must be stored as the 0–1 fraction 0.8, NOT 80.
    const rows: EvalRow[] = [
      evalRow({ speciesCode: 'sp1', expectedKeep: true, expectedQuality: 80 }),
      evalRow({ speciesCode: 'sp2', expectedKeep: true, expectedQuality: 80 }),
      evalRow({ speciesCode: 'sp3', expectedKeep: true, expectedQuality: 80 }),
      evalRow({ speciesCode: 'sp4', expectedKeep: false, expectedQuality: 20 }),
      evalRow({ speciesCode: 'sp5', expectedKeep: true, expectedQuality: 80 }),
    ];
    // Judge agrees on sp1–sp4, disagrees on sp5 (baseline keep=true, judge=false).
    const decide = (code: string) =>
      code === 'sp4'
        ? { keep: false, quality: 20 } // agrees (both replace)
        : code === 'sp5'
        ? { keep: false, quality: 80 } // DISAGREES (baseline keeps, judge replaces) → falseReplace
        : { keep: true, quality: 80 }; // agrees (both keep), exact score

    await runEvalLocal({ eleatic, rows, ...makeDeps(decide) });

    const reader = makeReader(eleatic.db);
    expect(reader.getRows('run-test-1')).toHaveLength(5);

    const run = reader.getRun('run-test-1');
    expect(run).toBeDefined();
    // FRACTION form — 4/5 agree → 0.8, NOT 80.
    expect(run!.metrics!.agreement).toBe(0.8);
    expect(run!.metrics!.agreement).not.toBe(80);
    // sp5: baseline keep, judge replace → falseReplace; no falseKeep here.
    expect(run!.metrics!.falseKeep).toBe(0);
    expect(run!.metrics!.falseReplace).toBe(1);
    // scoreMae is a 0–1 fraction (mean of per-row scoreMAE, each clamped [0,1]).
    // sp1–sp4 exact (1.0 each); sp5 |80-80|=0 → scoreMAE 1.0. All exact → mae 1.0.
    expect(run!.metrics!.scoreMae).toBe(1);
    expect(run!.label).toBe('gemini-2.5-flash');
    expect(run!.baseline).toBe('claude-opus-4-8');
    expect(run!.config!.sampleSize).toBe(5);
  });

  it('writes the eleatic store: run metrics as FRACTIONS + per-row disagreement', async () => {
    eleatic = openStore(':memory:');
    const rows: EvalRow[] = [
      evalRow({ speciesCode: 'sp1', expectedKeep: true, expectedQuality: 80 }),
      evalRow({ speciesCode: 'sp2', expectedKeep: true, expectedQuality: 80 }),
      evalRow({ speciesCode: 'sp3', expectedKeep: true, expectedQuality: 80 }),
      evalRow({ speciesCode: 'sp4', expectedKeep: false, expectedQuality: 20 }),
      evalRow({ speciesCode: 'sp5', expectedKeep: false, expectedQuality: 20 }),
    ];
    // sp1–sp3 agree (keep). sp4: baseline replace, judge KEEPS → falseKeep.
    // sp5: baseline replace, judge replaces → agree. 4/5 keep-agreement → 0.8.
    const decide = (code: string) =>
      code === 'sp4'
        ? { keep: true, quality: 90 } // DISAGREES → falseKeep
        : code === 'sp5'
        ? { keep: false, quality: 20 } // agrees (both replace)
        : { keep: true, quality: 80 }; // agrees (both keep)

    await runEvalLocal({ eleatic, rows, ...makeDeps(decide) });

    // The eleatic store holds the rows + run header. Read it back via the reader.
    const reader = makeReader(eleatic.db);
    const eleaticRun = reader.getRun('run-test-1');
    expect(eleaticRun).toBeDefined();
    expect(eleaticRun!.label).toBe('gemini-2.5-flash');
    expect(eleaticRun!.baseline).toBe('claude-opus-4-8');
    // metrics stored as 0–1 FRACTIONS — 4/5 → 0.8, NOT 80.
    expect(eleaticRun!.metrics!.agreement).toBe(0.8);
    expect(eleaticRun!.metrics!.agreement).not.toBe(80);
    expect(eleaticRun!.metrics!.falseKeep).toBe(1);
    expect(eleaticRun!.config!.sampleSize).toBe(5);

    const eleaticRows = reader.getRows('run-test-1');
    expect(eleaticRows).toHaveLength(5);
    // per-row categorical facet axis: the sp4 row is a falseKeep.
    const sp4 = reader.getRow('run-test-1', 'sp4');
    expect(sp4!.metadata!.disagreement).toBe('falseKeep');
    const sp1 = reader.getRow('run-test-1', 'sp1');
    expect(sp1!.metadata!.disagreement).toBe('agree');
  });

  it('joins each row with the Opus baseline + the judge output + cost/tokens', async () => {
    eleatic = openStore(':memory:');
    const rows: EvalRow[] = [evalRow({ speciesCode: 'amerob', expectedKeep: true, expectedQuality: 85 })];
    const decide = () => ({ keep: false, quality: 60 });

    await runEvalLocal({ eleatic, rows, ...makeDeps(decide) });

    const r = makeReader(eleatic.db).getRow('run-test-1', 'amerob');
    expect(r).toBeDefined();
    expect(r!.rowKey).toBe('amerob');
    // expected_json carries the Opus baseline; output_json the Gemini decision.
    const expected = r!.expected as { keep: boolean; qualityScore: number };
    const output = r!.output as {
      keep: boolean;
      qualityScore: number;
      criteria?: Record<string, number>;
      rationale?: string;
      fieldMarks?: string[];
      flags?: string[];
    };
    expect(expected.keep).toBe(true);
    expect(expected.qualityScore).toBe(85);
    expect(output.keep).toBe(false);
    expect(output.qualityScore).toBe(60);
    expect(r!.imageUrl).toBe('https://photos.bird-maps.com/amerob.jpeg');
    expect(r!.contentHash).toBe('hash-amerob');
    // priced usage (1000 prompt + 100 completion) → gemini-2.5-flash cost,
    // recorded on the row's `cost` numeric axis.
    expect(r!.scores!.cost).toBeGreaterThan(0);
    // criteria persisted (parsed, not double-encoded).
    expect(output.criteria).toMatchObject({ framing: 8 });
  });

  it('threads the judge "why" — rationale/fieldMarks/flags — from JudgmentRecord.output into output_json', async () => {
    // The runner half-fix guard (T2): the adapter unit test proves the SEAM, but
    // only a real run proves the RUNNER builds the EvalResultRecord from the full
    // JudgeOutput. If the runner threads only keep/qualityScore/criteria, the
    // read-back row.output lacks rationale even with a correct adapter.
    eleatic = openStore(':memory:');
    const rows: EvalRow[] = [evalRow({ speciesCode: 'amerob', expectedKeep: true, expectedQuality: 85 })];
    const decide = () => ({ keep: true, quality: 80 });

    await runEvalLocal({ eleatic, rows, ...makeDeps(decide) });

    const r = makeReader(eleatic.db).getRow('run-test-1', 'amerob');
    const output = r!.output as { rationale?: string; fieldMarks?: string[]; flags?: string[] };
    // the fakeJudge emits rationale 'r', fieldMarks ['mark'], flags [] — all must
    // survive the runner→adapter→eleatic round-trip.
    expect(output.rationale).toBe('r');
    expect(output.fieldMarks).toEqual(['mark']);
    expect(output.flags).toEqual([]);
  });

  it('writes the per-judgment trace TREE (T2) into trace_json: judge leaf carries today’s span content', async () => {
    // End-to-end T2 guard: only a real run proves the RUNNER builds the tree from
    // record.input + the in-scope prompt + record.latencyMs/rawResponse/usage and
    // threads it via toEleaticRow(result, trace) → recordRow. getRow is the ONLY
    // eleatic read path that surfaces trace_json (T1); getRows omits it.
    eleatic = openStore(':memory:');
    const rows: EvalRow[] = [evalRow({ speciesCode: 'amerob', expectedKeep: true, expectedQuality: 85 })];
    const decide = () => ({ keep: true, quality: 80 });

    await runEvalLocal({ eleatic, rows, ...makeDeps(decide) });

    const reader = makeReader(eleatic.db);
    const r = reader.getRow('run-test-1', 'amerob');
    const spans = traceSpans(r!.trace);
    // The eval→task→judge spine is always present (Decision 3).
    const judge = spanById(spans, 'judge');
    expect(judge.parentId).toBe('task');
    expect(judge.name).toBe('judge');
    expect(spanById(spans, 'eval').parentId).toBe(null);
    expect(spanById(spans, 'task').parentId).toBe('eval');
    // input: prompt is runner-scope; species/model/rubricVersion from record.input;
    // imageUrl is the PORTABLE R2 sourceUrl (the row's imageUrl), not the readPath.
    expect(judge.input!.prompt).toBe('rubric prompt');
    expect(judge.input!.imageUrl).toBe('https://photos.bird-maps.com/amerob.jpeg');
    expect(judge.input!.species).toEqual({ comName: 'Common amerob', sciName: 'Sci amerob', family: 'Testidae' });
    expect(judge.input!.rubricVersion).toBe('0.2.1');
    expect(judge.input!.model).toBe('gemini-2.5-flash');
    // output: the raw envelope + the full parsed JudgeOutput.
    expect(judge.output!.raw).toEqual(FAKE_RAW);
    expect((judge.output!.parsed as { keep: boolean }).keep).toBe(true);
    expect((judge.output!.parsed as { rationale: string }).rationale).toBe('r');
    // usage: latency (clock delta 250) + tokens + cost — the judge leaf is the ONLY span with usage.
    expect(judge.usage!.latencyMs).toBe(250);
    expect(judge.usage!.promptTokens).toBe(1000);
    expect(judge.usage!.completionTokens).toBe(100);
    expect(judge.usage!.costUsd).toBeGreaterThan(0);
    expect(spans.filter((s) => 'usage' in s).map((s) => s.id)).toEqual(['judge']);
  });

  it('assembles the scorer child spans (T2): keep_agreement/score_mae scored, keep_confusion detail-only, criteria axes', async () => {
    // The runner must call buildTrace(traceInput, scorerSpans) with the SAME three
    // scorer results it already computed for the accumulators (keep_agreement,
    // score_mae, keep_confusion) PLUS the per-axis criteria_mae_<axis> leaves.
    eleatic = openStore(':memory:');
    // amerob: baseline keep@85, judge replace@60 → keep_agreement 0 (falseReplace),
    // score_mae 1-|60-85|/100 = 0.75. The fakeJudge emits a full criteria object,
    // and the baseline carries criteria here so the criteria axes are non-null.
    const rows: EvalRow[] = [
      {
        ...evalRow({ speciesCode: 'amerob', expectedKeep: true, expectedQuality: 85 }),
        expected: {
          keep: true,
          qualityScore: 85,
          criteria: { framing: 8, subjectClarity: 8, liveness: 8, naturalness: 8, pose: 8, background: 8, lighting: 8 },
        },
      },
    ];
    const decide = () => ({ keep: false, quality: 60 });

    await runEvalLocal({ eleatic, rows, ...makeDeps(decide) });

    const r = makeReader(eleatic.db).getRow('run-test-1', 'amerob');
    const spans = traceSpans(r!.trace);
    const scorerSpans = spans.filter((s) => s.kind === 'scorer');
    const scorerIds = scorerSpans.map((s) => s.id);
    // The three accumulator scorers are present as child spans of `task`.
    expect(scorerIds).toContain('scorer:keep_agreement');
    expect(scorerIds).toContain('scorer:score_mae');
    expect(scorerIds).toContain('scorer:keep_confusion');
    for (const s of scorerSpans) expect(s.parentId).toBe('task');
    // keep_agreement: judge replace vs baseline keep → 0, carried as a scores bar.
    expect(spanById(spans, 'scorer:keep_agreement').scores).toEqual({ keep_agreement: 0 });
    // score_mae: 1 - |60-85|/100 = 0.75.
    expect(spanById(spans, 'scorer:score_mae').scores).toEqual({ score_mae: 0.75 });
    // keep_confusion: DETAIL-ONLY (no scores bar) — falseReplace 1 here.
    const confusion = spanById(spans, 'scorer:keep_confusion');
    expect(confusion.output).toEqual({ falseKeep: 0, falseReplace: 1 });
    expect('scores' in confusion).toBe(false);
    // criteria axes: each present axis carries a criteria_mae_<axis> score bar.
    // framing 8 vs 8 → 1 - 0/10 = 1.
    expect(spanById(spans, 'scorer:criteria_mae_framing').scores).toEqual({ criteria_mae_framing: 1 });
    // every emitted criteria-axis leaf carries exactly one scores bar (none null).
    const axisLeaves = scorerSpans.filter((s) => s.name.startsWith('criteria_mae_'));
    expect(axisLeaves).toHaveLength(7); // all 7 axes non-null in this row
    for (const a of axisLeaves) {
      expect(a.scores).toBeDefined();
      expect(Object.values(a.scores!)[0]).not.toBeNull();
    }
  });

  it('OMITS a criteria axis whose criteriaAxisMAE score is null (axis-skip, never a phantom-0 leaf)', async () => {
    // The expected baseline carries NO criteria → every criteria_mae_<axis> scores
    // null → all 7 axis leaves are omitted (axis-skip). The three structural
    // scorers stay.
    eleatic = openStore(':memory:');
    const rows: EvalRow[] = [evalRow({ speciesCode: 'amerob', expectedKeep: true, expectedQuality: 85 })];
    const decide = () => ({ keep: true, quality: 80 });

    await runEvalLocal({ eleatic, rows, ...makeDeps(decide) });

    const r = makeReader(eleatic.db).getRow('run-test-1', 'amerob');
    const spans = traceSpans(r!.trace);
    const axisLeaves = spans.filter((s) => s.name.startsWith('criteria_mae_'));
    expect(axisLeaves).toHaveLength(0);
    // the three accumulator scorers are still emitted.
    expect(spans.filter((s) => s.kind === 'scorer').map((s) => s.id).sort()).toEqual([
      'scorer:keep_agreement',
      'scorer:keep_confusion',
      'scorer:score_mae',
    ]);
  });

  it('omits trace_json from the lean list payload (getRows stays trace-free)', async () => {
    eleatic = openStore(':memory:');
    const rows: EvalRow[] = [evalRow({ speciesCode: 'amerob', expectedKeep: true, expectedQuality: 85 })];

    await runEvalLocal({ eleatic, rows, ...makeDeps(() => ({ keep: true, quality: 80 })) });

    const listed = makeReader(eleatic.db).getRows('run-test-1');
    expect(listed).toHaveLength(1);
    expect('trace' in listed[0]!).toBe(false);
  });

  it('computes falseKeep (judge keeps what baseline replaces) and total cost', async () => {
    eleatic = openStore(':memory:');
    const rows: EvalRow[] = [
      evalRow({ speciesCode: 'a', expectedKeep: false, expectedQuality: 20 }),
      evalRow({ speciesCode: 'b', expectedKeep: false, expectedQuality: 20 }),
    ];
    // Judge keeps BOTH → 2 falseKeep, 0 agreement.
    const decide = () => ({ keep: true, quality: 90 });

    await runEvalLocal({ eleatic, rows, ...makeDeps(decide) });

    const reader = makeReader(eleatic.db);
    const run = reader.getRun('run-test-1')!;
    expect(run.metrics!.agreement).toBe(0);
    expect(run.metrics!.falseKeep).toBe(2);
    expect(run.metrics!.falseReplace).toBe(0);
    // total cost is the sum of the two priced judgments' cost axes.
    const sum = reader.getRows('run-test-1').reduce((acc, r) => acc + (r.scores?.cost ?? 0), 0);
    expect(run.metrics!.totalCost).toBeCloseTo(sum, 9);
    expect(run.metrics!.totalCost).toBeGreaterThan(0);
  });

  it('runs rows SERIALLY (never concurrently)', async () => {
    eleatic = openStore(':memory:');
    const rows: EvalRow[] = [
      evalRow({ speciesCode: 's1', expectedKeep: true, expectedQuality: 80 }),
      evalRow({ speciesCode: 's2', expectedKeep: true, expectedQuality: 80 }),
      evalRow({ speciesCode: 's3', expectedKeep: true, expectedQuality: 80 }),
    ];
    let inFlight = 0;
    let maxInFlight = 0;
    const deps = makeDeps(() => ({ keep: true, quality: 80 }));
    const slowJudge: RunEvalDeps['makeJudge'] = (sink) => {
      const base = fakeJudge(sink, () => ({ keep: true, quality: 80 }));
      return {
        async judge(img, ctx, prompt) {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((res) => setTimeout(res, 5));
          const out = await base.judge(img, ctx, prompt);
          inFlight--;
          return out;
        },
      };
    };

    await runEvalLocal({ eleatic, rows, ...deps, makeJudge: slowJudge });

    // Serial execution never has more than one judgment in flight at a time.
    expect(maxInFlight).toBe(1);
    expect(makeReader(eleatic.db).getRows('run-test-1')).toHaveLength(3);
  });
});

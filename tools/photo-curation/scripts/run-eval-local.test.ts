import { describe, it, expect, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { readEvalRun, readEvalResults } from '../src/eval/store.js';
import { instrumentedJudge, type JudgmentSink } from '../src/judges/instrumented.js';
import { runEvalLocal, type RunEvalDeps } from './run-eval-local.js';
import type { EvalRow } from '../src/eval/build-dataset.js';
import type { ImageInput, SpeciesContext, JudgeOutput, VisionJudge } from '@bird-watch/photo-quality';

let db: Database.Database | undefined;
afterEach(() => {
  db?.close();
  db = undefined;
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
  });
}

/** Deps with a fake readImage (no fs) and a judge factory closing over `decide`. */
function makeDeps(decide: (code: string) => { keep: boolean; quality: number }): Omit<RunEvalDeps, 'db' | 'rows'> {
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
  it('writes one eval_result per row + one eval_run with FRACTION-form aggregates', async () => {
    db = openDb(':memory:');
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

    await runEvalLocal({ db, rows, ...makeDeps(decide) });

    const results = readEvalResults(db, 'run-test-1');
    expect(results).toHaveLength(5);

    const run = readEvalRun(db, 'run-test-1');
    expect(run).toBeDefined();
    // FRACTION form — 4/5 agree → 0.8, NOT 80.
    expect(run!.agreement).toBe(0.8);
    expect(run!.agreement).not.toBe(80);
    // sp5: baseline keep, judge replace → falseReplace; no falseKeep here.
    expect(run!.falseKeep).toBe(0);
    expect(run!.falseReplace).toBe(1);
    // score_mae is a 0–1 fraction (mean of per-row scoreMAE, each clamped [0,1]).
    // sp1–sp4 exact (1.0 each); sp5 |80-80|=0 → scoreMAE 1.0. All exact → mae 1.0.
    expect(run!.scoreMae).toBe(1);
    expect(run!.model).toBe('gemini-2.5-flash');
    expect(run!.baselineModel).toBe('claude-opus-4-8');
    expect(run!.sampleSize).toBe(5);
  });

  it('joins each result with the Opus baseline + the judge output + cost/tokens', async () => {
    db = openDb(':memory:');
    const rows: EvalRow[] = [evalRow({ speciesCode: 'amerob', expectedKeep: true, expectedQuality: 85 })];
    const decide = () => ({ keep: false, quality: 60 });

    await runEvalLocal({ db, rows, ...makeDeps(decide) });

    const [r] = readEvalResults(db, 'run-test-1');
    expect(r!.speciesCode).toBe('amerob');
    expect(r!.opusKeep).toBe(true);
    expect(r!.opusQuality).toBe(85);
    expect(r!.geminiKeep).toBe(false);
    expect(r!.geminiQuality).toBe(60);
    expect(r!.sourceUrl).toBe('https://photos.bird-maps.com/amerob.jpeg');
    expect(r!.contentHash).toBe('hash-amerob');
    // priced usage (1000 prompt + 100 completion) → gemini-2.5-flash cost.
    expect(r!.promptTokens).toBe(1000);
    expect(r!.completionTokens).toBe(100);
    expect(r!.cost).toBeGreaterThan(0);
    // criteria persisted as JSON.
    expect(JSON.parse(r!.geminiCriteriaJson!)).toMatchObject({ framing: 8 });
  });

  it('computes falseKeep (judge keeps what baseline replaces) and total_cost', async () => {
    db = openDb(':memory:');
    const rows: EvalRow[] = [
      evalRow({ speciesCode: 'a', expectedKeep: false, expectedQuality: 20 }),
      evalRow({ speciesCode: 'b', expectedKeep: false, expectedQuality: 20 }),
    ];
    // Judge keeps BOTH → 2 falseKeep, 0 agreement.
    const decide = () => ({ keep: true, quality: 90 });

    await runEvalLocal({ db, rows, ...makeDeps(decide) });

    const run = readEvalRun(db, 'run-test-1')!;
    expect(run.agreement).toBe(0);
    expect(run.falseKeep).toBe(2);
    expect(run.falseReplace).toBe(0);
    // total_cost is the sum of the two priced judgments.
    const results = readEvalResults(db, 'run-test-1');
    const sum = results.reduce((acc, r) => acc + (r.cost ?? 0), 0);
    expect(run.totalCost).toBeCloseTo(sum, 9);
    expect(run.totalCost).toBeGreaterThan(0);
  });

  it('runs rows SERIALLY (never concurrently)', async () => {
    db = openDb(':memory:');
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

    await runEvalLocal({ db, rows, ...deps, makeJudge: slowJudge });

    // Serial execution never has more than one judgment in flight at a time.
    expect(maxInFlight).toBe(1);
    expect(readEvalResults(db, 'run-test-1')).toHaveLength(3);
  });
});

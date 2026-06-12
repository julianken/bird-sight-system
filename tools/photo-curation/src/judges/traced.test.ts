import { describe, it, expect } from 'vitest';
import {
  tracedJudge,
  resolveTracedJudge,
  MissingBraintrustKey,
  MissingGeminiKey,
  type BraintrustLoggerSeam,
} from './traced.js';
import type { GeminiUsage } from './gemini.js';
import type { ImageInput, SpeciesContext, JudgeOutput, VisionJudge } from '@bird-watch/photo-quality';

const img: ImageInput = {
  buffer: Buffer.from('fake-jpeg-bytes'),
  mime: 'image/jpeg',
  sourceUrl: 'https://example.test/amerob.jpg',
};
const ctx: SpeciesContext = {
  speciesCode: 'amerob',
  comName: 'American Robin',
  sciName: 'Turdus migratorius',
  family: 'Turdidae',
};
const PROMPT = 'rubric prompt v3';

/** A canned JudgeOutput the inner judge returns. */
const VALID_OUTPUT: JudgeOutput = {
  fieldMarks: ['rufous breast', 'gray head'],
  criteria: { framing: 8, subjectClarity: 9, liveness: 10, naturalness: 9, pose: 7, background: 8, lighting: 8 },
  flags: [],
  keep: true,
  qualityScore: 85,
  rationale: 'sharp wild adult',
};

/** A trivial inner VisionJudge that returns a fixed output. */
class FakeJudge implements VisionJudge {
  async judge(): Promise<JudgeOutput> {
    return VALID_OUTPUT;
  }
}

/** An inner VisionJudge that always throws — used to assert error propagation. */
class ThrowingJudge implements VisionJudge {
  async judge(): Promise<JudgeOutput> {
    throw new Error('inner boom');
  }
}

/** Records every `span.log({...})` payload and whether the span body completed. */
interface RecordingLogger extends BraintrustLoggerSeam {
  spans: Array<{ logs: object[]; closed: boolean }>;
}

/**
 * A fake logger seam. `traced` opens one virtual span, hands a recording
 * `span` to the body, and marks the span closed once the body settles
 * (resolve OR reject) — mirroring the real SDK's finally-close semantics.
 * `clock()` is consulted for a deterministic latency measurement.
 */
function makeRecordingLogger(clock?: () => number): RecordingLogger {
  const spans: RecordingLogger['spans'] = [];
  return {
    spans,
    async traced<T>(fn: (span: { log: (f: object) => void }) => Promise<T>): Promise<T> {
      const record = { logs: [] as object[], closed: false };
      spans.push(record);
      const span = { log: (f: object) => record.logs.push(f) };
      try {
        return await fn(span);
      } finally {
        record.closed = true;
      }
    },
    nowMs: clock,
  };
}

describe('tracedJudge', () => {
  it('returns the inner output and records one span with input/output/metadata', async () => {
    const logger = makeRecordingLogger();
    const judge = tracedJudge(new FakeJudge(), { project: 'bird-maps', model: 'gemini-2.5-flash', rubricVersion: '0.2.1', logger });

    const out = await judge.judge(img, ctx, PROMPT);

    expect(out).toEqual(VALID_OUTPUT);
    expect(logger.spans).toHaveLength(1);
    const span = logger.spans[0]!;
    expect(span.closed).toBe(true);

    // input span-log: species framing + rubric/model/sourceUrl.
    const inputLog = span.logs.find((l) => 'input' in l) as { input: Record<string, unknown> } | undefined;
    expect(inputLog).toBeTruthy();
    expect(inputLog!.input).toMatchObject({
      speciesCode: 'amerob',
      comName: 'American Robin',
      sciName: 'Turdus migratorius',
      family: 'Turdidae',
      model: 'gemini-2.5-flash',
      sourceUrl: 'https://example.test/amerob.jpg',
    });
    // judgedRubricVersion is the version the judge was INVOKED with (#1037: a
    // stable tag from the caller, not defaultRubricConfig and not the prompt
    // body) — alongside the dataset row's expectedRubricVersion it makes any
    // future pin mismatch visible in Braintrust instead of silent.
    expect(inputLog!.input.judgedRubricVersion).toBe('0.2.1');
    expect(inputLog!.input.judgedRubricVersion).not.toBe(PROMPT);

    // image_url nests the SAME R2 URL in Braintrust's recognized render shape
    // (#1086) so the tree viewer force-renders the thumbnail inline. It rides
    // ALONGSIDE the unchanged sourceUrl string (the queryable provenance field).
    expect(inputLog!.input.image_url).toEqual({ url: 'https://example.test/amerob.jpg' });

    // output span-log: the full JudgeOutput.
    const outputLog = span.logs.find((l) => 'output' in l) as { output: JudgeOutput } | undefined;
    expect(outputLog).toBeTruthy();
    expect(outputLog!.output).toEqual(VALID_OUTPUT);

    // metadata span-log: latencyMs + model, plus aggregated metrics.latency (s).
    const metaLog = span.logs.find((l) => 'metadata' in l) as
      | { metadata: { latencyMs: number; model: string }; metrics: { latency: number } }
      | undefined;
    expect(metaLog).toBeTruthy();
    expect(metaLog!.metadata.model).toBe('gemini-2.5-flash');
    expect(typeof metaLog!.metadata.latencyMs).toBe('number');
    // metrics.latency is the same measurement in SECONDS (Braintrust aggregation).
    expect(metaLog!.metrics.latency).toBeCloseTo(metaLog!.metadata.latencyMs / 1000);
  });

  it('omits image_url (no {url: undefined}) when the image has no sourceUrl', async () => {
    // A judgment whose image carries no public URL (sourceUrl absent) must NOT
    // log image_url at all — logging { url: undefined } would surface a broken
    // render hint in Braintrust (#1086). sourceUrl itself is allowed to be
    // undefined; it stays a queryable field, image_url is the render-only hint.
    const noUrlImg: ImageInput = { buffer: Buffer.from('bytes'), mime: 'image/jpeg' };
    const logger = makeRecordingLogger();
    const judge = tracedJudge(new FakeJudge(), { project: 'bird-maps', model: 'gemini-2.5-flash', rubricVersion: '0.2.1', logger });

    await judge.judge(noUrlImg, ctx, PROMPT);

    const inputLog = logger.spans[0]!.logs.find((l) => 'input' in l) as { input: Record<string, unknown> } | undefined;
    expect(inputLog).toBeTruthy();
    expect(inputLog!.input).not.toHaveProperty('image_url');
  });

  it('propagates an inner error and still closes the span', async () => {
    const logger = makeRecordingLogger();
    const judge = tracedJudge(new ThrowingJudge(), { project: 'bird-maps', model: 'opus', rubricVersion: '0.2.1', logger });

    await expect(judge.judge(img, ctx, PROMPT)).rejects.toThrow('inner boom');
    expect(logger.spans).toHaveLength(1);
    expect(logger.spans[0]!.closed).toBe(true);
  });

  it('records an exact latencyMs from an injected clock (1000 → 1250 = 250)', async () => {
    const ticks = [1000, 1250];
    let i = 0;
    const clock = () => ticks[Math.min(i++, ticks.length - 1)]!;
    const logger = makeRecordingLogger(clock);
    const judge = tracedJudge(new FakeJudge(), { project: 'bird-maps', model: 'gemini-2.5-flash', rubricVersion: '0.2.1', logger });

    await judge.judge(img, ctx, PROMPT);

    const metaLog = logger.spans[0]!.logs.find((l) => 'metadata' in l) as
      | { metadata: { latencyMs: number } }
      | undefined;
    expect(metaLog!.metadata.latencyMs).toBe(250);
  });

  // #1037 decision 5: the usage accessor feeds Braintrust's STANDARD token
  // metric names. completion_tokens includes thinking tokens (they are output
  // we pay for); total_tokens prefers the response's own totalTokenCount.
  it('logs prompt/completion/total token metrics from the usage accessor', async () => {
    const usage: GeminiUsage = { promptTokenCount: 1234, candidatesTokenCount: 56, thoughtsTokenCount: 10, totalTokenCount: 1300 };
    const logger = makeRecordingLogger();
    const judge = tracedJudge(new FakeJudge(), {
      project: 'bird-maps', model: 'gemini-2.5-flash', rubricVersion: '0.2.1', logger,
      usage: () => usage,
    });

    await judge.judge(img, ctx, PROMPT);

    const metaLog = logger.spans[0]!.logs.find((l) => 'metrics' in l) as
      | { metrics: Record<string, number> }
      | undefined;
    expect(metaLog!.metrics).toMatchObject({
      prompt_tokens: 1234,
      completion_tokens: 66, // candidates 56 + thoughts 10
      total_tokens: 1300,
    });
    expect(typeof metaLog!.metrics.latency).toBe('number'); // latency still present
  });

  it('falls back to prompt+completion for total_tokens when totalTokenCount is absent', async () => {
    const logger = makeRecordingLogger();
    const judge = tracedJudge(new FakeJudge(), {
      project: 'bird-maps', model: 'gemini-2.5-flash', rubricVersion: '0.2.1', logger,
      usage: () => ({ promptTokenCount: 100, candidatesTokenCount: 20 }),
    });

    await judge.judge(img, ctx, PROMPT);

    const metaLog = logger.spans[0]!.logs.find((l) => 'metrics' in l) as
      | { metrics: Record<string, number> }
      | undefined;
    expect(metaLog!.metrics).toMatchObject({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 });
  });

  it('omits token metrics (keeping latency) when no usage is available', async () => {
    const logger = makeRecordingLogger();
    const judge = tracedJudge(new FakeJudge(), {
      project: 'bird-maps', model: 'gemini-2.5-flash', rubricVersion: '0.2.1', logger,
      usage: () => undefined,
    });

    await judge.judge(img, ctx, PROMPT);

    const metaLog = logger.spans[0]!.logs.find((l) => 'metrics' in l) as
      | { metrics: Record<string, number> }
      | undefined;
    expect(typeof metaLog!.metrics.latency).toBe('number');
    expect(metaLog!.metrics).not.toHaveProperty('prompt_tokens');
    expect(metaLog!.metrics).not.toHaveProperty('completion_tokens');
    expect(metaLog!.metrics).not.toHaveProperty('total_tokens');
  });

  // #1088: a PRICED model logs metrics.estimated_cost (USD) computed from the
  // faked usageMetadata; the existing token metrics are unaffected.
  it('logs metrics.estimated_cost for a priced model from the usage accessor', async () => {
    // gemini-2.5-flash: $0.30/1M in, $2.50/1M out. 1M prompt + 1M completion
    // (candidates 999_990 + thoughts 10) → $0.30 + $2.50 = $2.80.
    const usage: GeminiUsage = {
      promptTokenCount: 1_000_000,
      candidatesTokenCount: 999_990,
      thoughtsTokenCount: 10,
      totalTokenCount: 2_000_000,
    };
    const logger = makeRecordingLogger();
    const judge = tracedJudge(new FakeJudge(), {
      project: 'bird-maps', model: 'gemini-2.5-flash', rubricVersion: '0.2.1', logger,
      usage: () => usage,
    });

    await judge.judge(img, ctx, PROMPT);

    const metaLog = logger.spans[0]!.logs.find((l) => 'metrics' in l) as
      | { metrics: Record<string, number> }
      | undefined;
    expect(metaLog!.metrics.estimated_cost).toBeCloseTo(2.8, 6);
    // existing token + latency metrics unaffected.
    expect(metaLog!.metrics).toMatchObject({ prompt_tokens: 1_000_000, completion_tokens: 1_000_000 });
    expect(typeof metaLog!.metrics.latency).toBe('number');
  });

  // #1088: an UNPRICED model OMITS the key (no $0, no undefined) and warns once,
  // naming the model, so an unpriced run is visible rather than silently free.
  it('omits estimated_cost and warns once (naming the model) for an unpriced model', async () => {
    const warnings: string[] = [];
    const usage: GeminiUsage = { promptTokenCount: 1000, candidatesTokenCount: 200, totalTokenCount: 1200 };
    const logger = makeRecordingLogger();
    const judge = tracedJudge(new FakeJudge(), {
      project: 'bird-maps', model: 'gemini-3-flash-preview', rubricVersion: '0.2.1', logger,
      usage: () => usage,
      warn: (line) => warnings.push(line),
    });

    await judge.judge(img, ctx, PROMPT);

    const metaLog = logger.spans[0]!.logs.find((l) => 'metrics' in l) as
      | { metrics: Record<string, number> }
      | undefined;
    expect(metaLog!.metrics).not.toHaveProperty('estimated_cost');
    // token metrics still logged — only cost is omitted.
    expect(metaLog!.metrics).toMatchObject({ prompt_tokens: 1000, completion_tokens: 200 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('gemini-3-flash-preview');
  });

  // No usage → no token counts → no cost either, and no warning (the unpriced
  // warning is for a PRICED-table miss, not an absent-usage case).
  it('omits estimated_cost without warning when no usage is available', async () => {
    const warnings: string[] = [];
    const logger = makeRecordingLogger();
    const judge = tracedJudge(new FakeJudge(), {
      project: 'bird-maps', model: 'gemini-2.5-flash', rubricVersion: '0.2.1', logger,
      usage: () => undefined,
      warn: (line) => warnings.push(line),
    });

    await judge.judge(img, ctx, PROMPT);

    const metaLog = logger.spans[0]!.logs.find((l) => 'metrics' in l) as
      | { metrics: Record<string, number> }
      | undefined;
    expect(metaLog!.metrics).not.toHaveProperty('estimated_cost');
    expect(warnings).toHaveLength(0);
  });
});

describe('resolveTracedJudge', () => {
  it('throws MissingGeminiKey when GEMINI_API_KEY is absent', () => {
    expect(() =>
      resolveTracedJudge({}, { project: 'bird-maps', model: 'gemini-2.5-flash', rubricVersion: '0.2.1' }),
    ).toThrow(MissingGeminiKey);
  });

  it('throws MissingBraintrustKey when only GEMINI_API_KEY is present', () => {
    expect(() =>
      resolveTracedJudge(
        { GEMINI_API_KEY: 'g' },
        { project: 'bird-maps', model: 'gemini-2.5-flash', rubricVersion: '0.2.1' },
      ),
    ).toThrow(MissingBraintrustKey);
  });

  it('returns a traced VisionJudge when both keys are present', () => {
    const judge = resolveTracedJudge(
      { GEMINI_API_KEY: 'g', BRAINTRUST_API_KEY: 'b' },
      { project: 'bird-maps', model: 'gemini-2.5-flash', rubricVersion: '0.2.1' },
    );
    expect(typeof judge.judge).toBe('function');
  });
});

describe('judges barrel — construction-boundary guarantee', () => {
  it('exports resolveTracedJudge but NOT the raw GeminiVisionJudge ctor', async () => {
    const barrel = await import('./index.js');
    expect(typeof barrel.resolveTracedJudge).toBe('function');
    expect((barrel as Record<string, unknown>).GeminiVisionJudge).toBeUndefined();
  });
});

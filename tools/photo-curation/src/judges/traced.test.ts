import { describe, it, expect } from 'vitest';
import {
  tracedJudge,
  resolveTracedJudge,
  MissingBraintrustKey,
  MissingGeminiKey,
  type BraintrustLoggerSeam,
} from './traced.js';
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
    const judge = tracedJudge(new FakeJudge(), { project: 'bird-maps', model: 'gemini-2.5-flash', logger });

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
    expect(inputLog!.input.rubricVersion).toBe(PROMPT);

    // output span-log: the full JudgeOutput.
    const outputLog = span.logs.find((l) => 'output' in l) as { output: JudgeOutput } | undefined;
    expect(outputLog).toBeTruthy();
    expect(outputLog!.output).toEqual(VALID_OUTPUT);

    // metadata span-log: latencyMs + model.
    const metaLog = span.logs.find((l) => 'metadata' in l) as
      | { metadata: { latencyMs: number; model: string } }
      | undefined;
    expect(metaLog).toBeTruthy();
    expect(metaLog!.metadata.model).toBe('gemini-2.5-flash');
    expect(typeof metaLog!.metadata.latencyMs).toBe('number');
  });

  it('propagates an inner error and still closes the span', async () => {
    const logger = makeRecordingLogger();
    const judge = tracedJudge(new ThrowingJudge(), { project: 'bird-maps', model: 'opus', logger });

    await expect(judge.judge(img, ctx, PROMPT)).rejects.toThrow('inner boom');
    expect(logger.spans).toHaveLength(1);
    expect(logger.spans[0]!.closed).toBe(true);
  });

  it('records an exact latencyMs from an injected clock (1000 → 1250 = 250)', async () => {
    const ticks = [1000, 1250];
    let i = 0;
    const clock = () => ticks[Math.min(i++, ticks.length - 1)]!;
    const logger = makeRecordingLogger(clock);
    const judge = tracedJudge(new FakeJudge(), { project: 'bird-maps', model: 'gemini-2.5-flash', logger });

    await judge.judge(img, ctx, PROMPT);

    const metaLog = logger.spans[0]!.logs.find((l) => 'metadata' in l) as
      | { metadata: { latencyMs: number } }
      | undefined;
    expect(metaLog!.metadata.latencyMs).toBe(250);
  });
});

describe('resolveTracedJudge', () => {
  it('throws MissingGeminiKey when GEMINI_API_KEY is absent', () => {
    expect(() => resolveTracedJudge({}, { project: 'bird-maps', model: 'gemini-2.5-flash' })).toThrow(
      MissingGeminiKey,
    );
  });

  it('throws MissingBraintrustKey when only GEMINI_API_KEY is present', () => {
    expect(() =>
      resolveTracedJudge({ GEMINI_API_KEY: 'g' }, { project: 'bird-maps', model: 'gemini-2.5-flash' }),
    ).toThrow(MissingBraintrustKey);
  });

  it('returns a traced VisionJudge when both keys are present', () => {
    const judge = resolveTracedJudge(
      { GEMINI_API_KEY: 'g', BRAINTRUST_API_KEY: 'b' },
      { project: 'bird-maps', model: 'gemini-2.5-flash' },
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

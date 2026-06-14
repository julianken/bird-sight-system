import { describe, it, expect } from 'vitest';
import {
  instrumentedJudge,
  resolveJudge,
  MissingGeminiKey,
  type JudgmentRecord,
} from './instrumented.js';
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

/** A recording sink: collects every JudgmentRecord emitted. */
function makeSink(): { records: JudgmentRecord[]; sink: (r: JudgmentRecord) => void } {
  const records: JudgmentRecord[] = [];
  return { records, sink: (r) => records.push(r) };
}

describe('instrumentedJudge', () => {
  it('returns the inner output and emits one sink record with input + output', async () => {
    const { records, sink } = makeSink();
    const judge = instrumentedJudge(new FakeJudge(), { model: 'gemini-2.5-flash', rubricVersion: '0.2.1', sink });

    const out = await judge.judge(img, ctx, PROMPT);

    expect(out).toEqual(VALID_OUTPUT);
    expect(records).toHaveLength(1);
    const rec = records[0]!;
    expect(rec.input).toMatchObject({
      speciesCode: 'amerob',
      comName: 'American Robin',
      sciName: 'Turdus migratorius',
      family: 'Turdidae',
      model: 'gemini-2.5-flash',
      sourceUrl: 'https://example.test/amerob.jpg',
    });
    // judgedRubricVersion is the version the judge was INVOKED with (a stable
    // tag from the caller, not the prompt body).
    expect(rec.input.judgedRubricVersion).toBe('0.2.1');
    expect(rec.input.judgedRubricVersion).not.toBe(PROMPT);
    expect(rec.output).toEqual(VALID_OUTPUT);
  });

  it('propagates an inner error and emits NO record (the judgment never completed)', async () => {
    const { records, sink } = makeSink();
    const judge = instrumentedJudge(new ThrowingJudge(), { model: 'opus', rubricVersion: '0.2.1', sink });

    await expect(judge.judge(img, ctx, PROMPT)).rejects.toThrow('inner boom');
    expect(records).toHaveLength(0);
  });

  // #1168 (trace T3): per-call latency is measured via an INJECTABLE monotonic
  // clock (the Clock-injection precedent), so the recorded value is the
  // deterministic clock delta around the inner judge call — not a real timer.
  it('records latencyMs as the injected clock delta around the inner judge call', async () => {
    const ticks = [1000, 1350]; // before, after → 350 ms elapsed.
    let i = 0;
    const now = () => ticks[i++]!;
    const { records, sink } = makeSink();
    const judge = instrumentedJudge(new FakeJudge(), {
      model: 'gemini-2.5-flash', rubricVersion: '0.2.1', sink, now,
    });

    await judge.judge(img, ctx, PROMPT);

    expect(records[0]!.latencyMs).toBe(350);
  });

  it('defaults to a real monotonic clock — latencyMs is a finite, non-negative number', async () => {
    const { records, sink } = makeSink();
    const judge = instrumentedJudge(new FakeJudge(), { model: 'gemini-2.5-flash', rubricVersion: '0.2.1', sink });

    await judge.judge(img, ctx, PROMPT);

    const ms = records[0]!.latencyMs;
    expect(Number.isFinite(ms)).toBe(true);
    expect(ms).toBeGreaterThanOrEqual(0);
  });

  // The raw model response is surfaced via the injectable accessor (mirroring
  // the usage accessor), read AFTER the judgment resolves. No VisionJudge change.
  it('records rawResponse from the rawResponse accessor', async () => {
    const raw = { candidates: [{ content: { parts: [{ text: '{}' }] } }], usageMetadata: { promptTokenCount: 5 } };
    const { records, sink } = makeSink();
    const judge = instrumentedJudge(new FakeJudge(), {
      model: 'gemini-2.5-flash', rubricVersion: '0.2.1', sink, rawResponse: () => raw,
    });

    await judge.judge(img, ctx, PROMPT);

    expect(records[0]!.rawResponse).toEqual(raw);
  });

  it('leaves rawResponse ABSENT (not undefined) when no accessor is provided', async () => {
    const { records, sink } = makeSink();
    const judge = instrumentedJudge(new FakeJudge(), { model: 'gemini-2.5-flash', rubricVersion: '0.2.1', sink });

    await judge.judge(img, ctx, PROMPT);

    // exactOptionalPropertyTypes: the key is omitted entirely, never `undefined`.
    expect('rawResponse' in records[0]!).toBe(false);
  });

  it('a throwing judge emits no record even with the latency clock + raw accessor wired', async () => {
    const { records, sink } = makeSink();
    const judge = instrumentedJudge(new ThrowingJudge(), {
      model: 'opus', rubricVersion: '0.2.1', sink,
      now: () => 0,
      rawResponse: () => ({ never: 'read' }),
    });

    await expect(judge.judge(img, ctx, PROMPT)).rejects.toThrow('inner boom');
    expect(records).toHaveLength(0);
  });

  // Token extraction (ported from traced.ts): completion_tokens includes
  // thinking tokens; total is implicit. The sink surfaces prompt/completion.
  it('emits prompt/completion tokens from the usage accessor', async () => {
    const usage: GeminiUsage = { promptTokenCount: 1234, candidatesTokenCount: 56, thoughtsTokenCount: 10, totalTokenCount: 1300 };
    const { records, sink } = makeSink();
    const judge = instrumentedJudge(new FakeJudge(), {
      model: 'gemini-2.5-flash', rubricVersion: '0.2.1', sink, usage: () => usage,
    });

    await judge.judge(img, ctx, PROMPT);

    const rec = records[0]!;
    expect(rec.promptTokens).toBe(1234);
    expect(rec.completionTokens).toBe(66); // candidates 56 + thoughts 10
  });

  it('emits undefined token counts when no usage is available', async () => {
    const { records, sink } = makeSink();
    const judge = instrumentedJudge(new FakeJudge(), {
      model: 'gemini-2.5-flash', rubricVersion: '0.2.1', sink, usage: () => undefined,
    });

    await judge.judge(img, ctx, PROMPT);

    const rec = records[0]!;
    expect(rec.promptTokens).toBeUndefined();
    expect(rec.completionTokens).toBeUndefined();
    expect(rec.estimatedCost).toBeUndefined();
  });

  // #1088 cost port: a PRICED model emits estimatedCost (USD) from token usage.
  it('emits estimatedCost for a priced model from the usage accessor', async () => {
    // gemini-2.5-flash: $0.30/1M in, $2.50/1M out. 1M prompt + 1M completion → $2.80.
    const usage: GeminiUsage = {
      promptTokenCount: 1_000_000,
      candidatesTokenCount: 999_990,
      thoughtsTokenCount: 10,
      totalTokenCount: 2_000_000,
    };
    const { records, sink } = makeSink();
    const judge = instrumentedJudge(new FakeJudge(), {
      model: 'gemini-2.5-flash', rubricVersion: '0.2.1', sink, usage: () => usage,
    });

    await judge.judge(img, ctx, PROMPT);

    expect(records[0]!.estimatedCost).toBeCloseTo(2.8, 6);
    expect(records[0]!.promptTokens).toBe(1_000_000);
    expect(records[0]!.completionTokens).toBe(1_000_000);
  });

  // #1088 port: an UNPRICED model emits no cost (undefined) and warns, naming it.
  it('omits estimatedCost and warns (naming the model) for an unpriced model', async () => {
    const warnings: string[] = [];
    const usage: GeminiUsage = { promptTokenCount: 1000, candidatesTokenCount: 200, totalTokenCount: 1200 };
    const { records, sink } = makeSink();
    const judge = instrumentedJudge(new FakeJudge(), {
      model: 'gemini-3-pro-preview', rubricVersion: '0.2.1', sink, usage: () => usage,
      warn: (line) => warnings.push(line),
    });

    await judge.judge(img, ctx, PROMPT);

    expect(records[0]!.estimatedCost).toBeUndefined();
    // token counts still emitted — only cost is omitted.
    expect(records[0]!.promptTokens).toBe(1000);
    expect(records[0]!.completionTokens).toBe(200);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('gemini-3-pro-preview');
  });

  // #1088 warn-once dedupe port: the unpriced warning fires once per model id
  // for the lifetime of the wrapped judge, NOT once per judgment.
  it('warns only ONCE per unpriced model across repeated judgments', async () => {
    const warnings: string[] = [];
    const usage: GeminiUsage = { promptTokenCount: 1000, candidatesTokenCount: 200, totalTokenCount: 1200 };
    const { records, sink } = makeSink();
    const judge = instrumentedJudge(new FakeJudge(), {
      model: 'gemini-3-pro-preview', rubricVersion: '0.2.1', sink, usage: () => usage,
      warn: (line) => warnings.push(line),
    });

    await judge.judge(img, ctx, PROMPT);
    await judge.judge(img, ctx, PROMPT);
    await judge.judge(img, ctx, PROMPT);

    expect(warnings).toHaveLength(1);
    for (const rec of records) {
      expect(rec.estimatedCost).toBeUndefined();
    }
  });

  // No usage → no token counts → no cost, and NO warning (the unpriced warning
  // is for a price-table miss, not an absent-usage case).
  it('omits estimatedCost without warning when no usage is available', async () => {
    const warnings: string[] = [];
    const { records, sink } = makeSink();
    const judge = instrumentedJudge(new FakeJudge(), {
      model: 'gemini-2.5-flash', rubricVersion: '0.2.1', sink, usage: () => undefined,
      warn: (line) => warnings.push(line),
    });

    await judge.judge(img, ctx, PROMPT);

    expect(records[0]!.estimatedCost).toBeUndefined();
    expect(warnings).toHaveLength(0);
  });
});

describe('resolveJudge', () => {
  it('throws MissingGeminiKey when GEMINI_API_KEY is absent', () => {
    const { sink } = makeSink();
    expect(() =>
      resolveJudge({}, { model: 'gemini-2.5-flash', rubricVersion: '0.2.1', sink }),
    ).toThrow(MissingGeminiKey);
  });

  it('returns an instrumented VisionJudge when GEMINI_API_KEY is present (no Braintrust key needed)', () => {
    const { sink } = makeSink();
    const judge = resolveJudge(
      { GEMINI_API_KEY: 'g' },
      { model: 'gemini-2.5-flash', rubricVersion: '0.2.1', sink },
    );
    expect(typeof judge.judge).toBe('function');
  });
});

describe('judges barrel — construction-boundary guarantee', () => {
  it('exports resolveJudge but NOT the raw GeminiVisionJudge ctor', async () => {
    const barrel = await import('./index.js');
    expect(typeof barrel.resolveJudge).toBe('function');
    expect((barrel as Record<string, unknown>).GeminiVisionJudge).toBeUndefined();
  });
});

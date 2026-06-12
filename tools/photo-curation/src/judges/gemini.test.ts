import { describe, it, expect, vi } from 'vitest';
import { GeminiVisionJudge, GeminiJudgeError, GeminiDailyQuotaError, GEMINI_PACE_MS } from './gemini.js';
import { makeFakeClock } from '../test-clock.js';
import type { ImageInput, SpeciesContext, JudgeOutput } from '@bird-watch/photo-quality';

const img: ImageInput = { buffer: Buffer.from('fake-jpeg-bytes'), mime: 'image/jpeg' };
const ctx: SpeciesContext = {
  speciesCode: 'amerob',
  comName: 'American Robin',
  sciName: 'Turdus migratorius',
  family: 'Turdidae',
};

/** A valid JudgeOutput shape the model would return as the `text` part. */
const VALID_OUTPUT: JudgeOutput = {
  fieldMarks: ['rufous breast', 'gray head', 'white eye-arc'],
  criteria: { framing: 8, subjectClarity: 9, liveness: 10, naturalness: 9, pose: 7, background: 8, lighting: 8 },
  flags: [],
  keep: true,
  qualityScore: 85,
  rationale: 'sharp wild adult, diagnostic marks visible',
};

/** Build a Response-like object whose JSON body wraps `text` in the Gemini envelope. */
function geminiOk(text: string, usageMetadata?: object): Response {
  const body = {
    candidates: [{ content: { parts: [{ text }] } }],
    ...(usageMetadata === undefined ? {} : { usageMetadata }),
  };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

/** A 429 (transient) Response with an UNPARSEABLE body — withBackoff should retry past it. */
function gemini429(): Response {
  return new Response('rate limited', { status: 429 });
}

/** The quotaIds measured on the free tier 2026-06-11 (#1036). */
const PER_MINUTE_QUOTA_ID = 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier';
const PER_DAY_QUOTA_ID = 'GenerateRequestsPerDayPerProjectPerModel-FreeTier';

/** Google's structured 429: `error.details[]` carries QuotaFailure violations + RetryInfo. */
function gemini429Quota(quotaId: string, retryDelay?: string): Response {
  const details: unknown[] = [
    {
      '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
      violations: [
        {
          quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
          quotaId,
          quotaValue: '5',
        },
      ],
    },
  ];
  if (retryDelay !== undefined) {
    details.push({ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay });
  }
  const body = {
    error: { code: 429, message: 'Resource has been exhausted', status: 'RESOURCE_EXHAUSTED', details },
  };
  return new Response(JSON.stringify(body), {
    status: 429,
    headers: { 'content-type': 'application/json' },
  });
}

/** A 500 (transient 5xx) Response — withBackoff should retry past it too. */
function gemini500(): Response {
  return new Response('internal error', { status: 500 });
}

describe('GeminiVisionJudge', () => {
  it('maps a valid candidates[0].content.parts[0].text JSON into a JudgeOutput', async () => {
    const fetchImpl = async () => geminiOk(JSON.stringify(VALID_OUTPUT));
    const judge = new GeminiVisionJudge({ apiKey: 'k', clock: makeFakeClock(), fetchImpl });

    const out = await judge.judge(img, ctx, 'rubric prompt');

    expect(out.fieldMarks).toEqual(['rufous breast', 'gray head', 'white eye-arc']);
    expect(out.criteria).toEqual({
      framing: 8, subjectClarity: 9, liveness: 10, naturalness: 9, pose: 7, background: 8, lighting: 8,
    });
    expect(out.flags).toEqual([]);
    expect(out.keep).toBe(true);
    expect(out.qualityScore).toBe(85);
    expect(out.rationale).toBe('sharp wild adult, diagnostic marks visible');
  });

  it('posts inlineData base64 + responseSchema to the v1beta generateContent endpoint', async () => {
    let seenUrl = '';
    let seenBody: any;
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      seenUrl = String(url);
      seenBody = JSON.parse(String(init?.body));
      return geminiOk(JSON.stringify(VALID_OUTPUT));
    };
    const judge = new GeminiVisionJudge({ apiKey: 'secret', model: 'gemini-2.5-flash', clock: makeFakeClock(), fetchImpl });

    await judge.judge(img, ctx, 'rubric prompt');

    expect(seenUrl).toContain('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    expect(seenUrl).toContain('key=secret');
    const parts = seenBody.contents[0].parts;
    expect(parts[1].inlineData.mimeType).toBe('image/jpeg');
    expect(parts[1].inlineData.data).toBe(img.buffer.toString('base64'));
    expect(seenBody.generationConfig.responseMimeType).toBe('application/json');
    expect(seenBody.generationConfig.responseSchema).toBeTruthy();
    // species framing is woven into the text part alongside the rubric prompt.
    expect(parts[0].text).toContain('American Robin');
    expect(parts[0].text).toContain('Turdus migratorius');
  });

  it('spaces consecutive calls by ≥ GEMINI_PACE_MS via the injected Pacer/Clock', async () => {
    const clock = makeFakeClock();
    const fetchImpl = async () => geminiOk(JSON.stringify(VALID_OUTPUT));
    const judge = new GeminiVisionJudge({ apiKey: 'k', clock, fetchImpl });

    await judge.judge(img, ctx, 'p');
    await judge.judge(img, ctx, 'p');

    // The second gate must have slept exactly the full pace (no time elapsed between calls).
    expect(clock.sleeps).toContain(GEMINI_PACE_MS);
  });

  it('recovers from a transient 429 then 200 via withBackoff', async () => {
    let n = 0;
    const fetchImpl = async () => {
      n += 1;
      return n === 1 ? gemini429() : geminiOk(JSON.stringify(VALID_OUTPUT));
    };
    const judge = new GeminiVisionJudge({ apiKey: 'k', clock: makeFakeClock(), fetchImpl });

    const out = await judge.judge(img, ctx, 'p');

    expect(n).toBe(2);
    expect(out.keep).toBe(true);
  });

  it('recovers from a transient 500 then 200 via withBackoff', async () => {
    // The 5xx leg of isTransient/withBackoff: a one-off server error must be
    // retried, not surfaced as a GeminiJudgeError (only a non-2xx that survives
    // every backoff attempt is terminal).
    let n = 0;
    const fetchImpl = async () => {
      n += 1;
      return n === 1 ? gemini500() : geminiOk(JSON.stringify(VALID_OUTPUT));
    };
    const judge = new GeminiVisionJudge({ apiKey: 'k', clock: makeFakeClock(), fetchImpl });

    const out = await judge.judge(img, ctx, 'p');

    expect(n).toBe(2);
    expect(out.keep).toBe(true);
  });

  it('waits at least the RetryInfo retryDelay before retrying a minute-cap 429', async () => {
    const clock = makeFakeClock();
    let n = 0;
    const fetchImpl = async () => {
      n += 1;
      return n === 1 ? gemini429Quota(PER_MINUTE_QUOTA_ID, '13s') : geminiOk(JSON.stringify(VALID_OUTPUT));
    };
    const judge = new GeminiVisionJudge({ apiKey: 'k', clock, fetchImpl });

    const out = await judge.judge(img, ctx, 'p');

    expect(n).toBe(2);
    expect(out.keep).toBe(true);
    // The backoff sleep honors the server hint: max(13 000, jittered ≤ 500) = 13 000.
    expect(clock.sleeps).toContain(13_000);
  });

  it('latches on a daily-cap 429: GeminiDailyQuotaError on the FIRST trip, one fetch total', async () => {
    let n = 0;
    const fetchImpl = async () => {
      n += 1;
      return gemini429Quota(PER_DAY_QUOTA_ID, '38s');
    };
    const judge = new GeminiVisionJudge({ apiKey: 'k', clock: makeFakeClock(), fetchImpl });

    // The FIRST trip surfaces as GeminiDailyQuotaError (not a wrapped GeminiJudgeError) …
    await expect(judge.judge(img, ctx, 'p')).rejects.toBeInstanceOf(GeminiDailyQuotaError);
    // … after exactly ONE network call: a drained daily cap is non-transient, no retries.
    expect(n).toBe(1);

    // The latch: every subsequent judge() call throws with ZERO additional fetches.
    await expect(judge.judge(img, ctx, 'p')).rejects.toBeInstanceOf(GeminiDailyQuotaError);
    expect(n).toBe(1);
  });

  it('names the tripped quotaId in the error message (RPM vs RPD trips distinguishable)', async () => {
    // RPD: the daily error names the quotaId and the reset.
    const daily = new GeminiVisionJudge({
      apiKey: 'k',
      clock: makeFakeClock(),
      fetchImpl: async () => gemini429Quota(PER_DAY_QUOTA_ID),
    });
    await expect(daily.judge(img, ctx, 'p')).rejects.toThrow(new RegExp(PER_DAY_QUOTA_ID));

    // RPM: a minute-cap 429 that survives every backoff attempt still carries its quotaId
    // (this is the Braintrust span error text — a bare "Gemini 429" is undiagnosable).
    const minute = new GeminiVisionJudge({
      apiKey: 'k',
      clock: makeFakeClock(),
      fetchImpl: async () => gemini429Quota(PER_MINUTE_QUOTA_ID),
    });
    await expect(minute.judge(img, ctx, 'p')).rejects.toThrow(new RegExp(PER_MINUTE_QUOTA_ID));
  });

  it('preserves plain transient handling for a 429 with an unparseable body (4 attempts)', async () => {
    let n = 0;
    const fetchImpl = async () => {
      n += 1;
      return gemini429(); // text body — no quota signals to parse
    };
    const judge = new GeminiVisionJudge({ apiKey: 'k', clock: makeFakeClock(), fetchImpl });

    await expect(judge.judge(img, ctx, 'p')).rejects.toBeInstanceOf(GeminiJudgeError);
    expect(n).toBe(4); // initial + withBackoff's default 3 retries — the pre-#1036 behavior
  });

  it('defaults GEMINI_PACE_MS to 12_000 ms (≤5 RPM — the measured free-tier cap)', () => {
    expect(GEMINI_PACE_MS).toBe(12_000);
  });

  it('honors a GEMINI_PACE_MS env override without a rebuild', async () => {
    vi.stubEnv('GEMINI_PACE_MS', '30000');
    vi.resetModules();
    try {
      const mod = await import('./gemini.js');
      expect(mod.GEMINI_PACE_MS).toBe(30_000);

      // And the override actually drives the judge's Pacer.
      const clock = makeFakeClock();
      const fetchImpl = async () => geminiOk(JSON.stringify(VALID_OUTPUT));
      const judge = new mod.GeminiVisionJudge({ apiKey: 'k', clock, fetchImpl });
      await judge.judge(img, ctx, 'p');
      await judge.judge(img, ctx, 'p');
      expect(clock.sleeps).toContain(30_000);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  // #1037 decision 5: token usage is captured INTERNALLY (JudgeOutput is
  // unchanged and @bird-watch/photo-quality stays SDK-free); the tracing seam
  // reads it via this accessor after each judgment.
  it('captures the response usageMetadata, readable via lastUsage()', async () => {
    const usage = { promptTokenCount: 1234, candidatesTokenCount: 56, thoughtsTokenCount: 10, totalTokenCount: 1300 };
    const fetchImpl = async () => geminiOk(JSON.stringify(VALID_OUTPUT), usage);
    const judge = new GeminiVisionJudge({ apiKey: 'k', clock: makeFakeClock(), fetchImpl });

    expect(judge.lastUsage()).toBeUndefined(); // nothing judged yet
    await judge.judge(img, ctx, 'p');
    expect(judge.lastUsage()).toEqual(usage);
  });

  it('lastUsage() reflects the LATEST response and clears when usageMetadata is absent', async () => {
    let n = 0;
    const fetchImpl = async () => {
      n += 1;
      return n === 1
        ? geminiOk(JSON.stringify(VALID_OUTPUT), { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 120 })
        : geminiOk(JSON.stringify(VALID_OUTPUT)); // no usageMetadata
    };
    const judge = new GeminiVisionJudge({ apiKey: 'k', clock: makeFakeClock(), fetchImpl });

    await judge.judge(img, ctx, 'p');
    expect(judge.lastUsage()).toEqual({ promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 120 });

    // A second judgment without usageMetadata must not leak the first row's
    // numbers onto the second row's span.
    await judge.judge(img, ctx, 'p');
    expect(judge.lastUsage()).toBeUndefined();
  });

  it('re-asks once on a non-JSON body then throws GeminiJudgeError', async () => {
    let n = 0;
    const fetchImpl = async () => {
      n += 1;
      return geminiOk('this is not json at all');
    };
    const judge = new GeminiVisionJudge({ apiKey: 'k', clock: makeFakeClock(), fetchImpl });

    await expect(judge.judge(img, ctx, 'p')).rejects.toBeInstanceOf(GeminiJudgeError);
    // one initial ask + one re-ask = two fetches.
    expect(n).toBe(2);
  });

  it('throws on a missing apiKey', () => {
    expect(() => new GeminiVisionJudge({ apiKey: '' })).toThrow();
  });
});

import { describe, it, expect } from 'vitest';
import { GeminiVisionJudge, GeminiJudgeError, GEMINI_PACE_MS } from './gemini.js';
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
function geminiOk(text: string): Response {
  const body = {
    candidates: [{ content: { parts: [{ text }] } }],
  };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

/** A 429 (transient) Response — withBackoff should retry past it. */
function gemini429(): Response {
  return new Response('rate limited', { status: 429 });
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

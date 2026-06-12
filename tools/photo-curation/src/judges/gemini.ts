// ─────────────────────────────────────────────────────────────────────────────
// Gemini vision judge (#1011, part of #1010). A SECOND backend behind the pure
// `VisionJudge` seam (packages/photo-quality), so gemini-2.5-flash can be
// measured against the Opus judge with ZERO change to the scoring core.
//
// Design notes (deliberate):
//   • RAW built-in `fetch` against the v1beta REST endpoint — `@google/genai` is
//     intentionally NOT a dependency. Adding an unimported SDK would trip knip;
//     the one method we need (generateContent with inlineData + responseSchema)
//     is a single POST. The REST shape was verified against the current
//     googleapis/js-genai docs (context7, 2026-06-11): `generationConfig`
//     carries `responseMimeType: 'application/json'` + `responseSchema` (the
//     OpenAPI-3.0 subset with UPPERCASE `type` enums), and the JSON answer is at
//     `candidates[0].content.parts[0].text`.
//   • Pacing + retry REUSE `Pacer.gate()` + `withBackoff` from ../pacing.ts —
//     never hand-rolled. `GEMINI_PACE_MS = 6_000` → ≤10 RPM, comfortably under
//     the free-tier per-minute cap.
//   • Everything is injectable (clock, fetchImpl) so the unit tests assert
//     pacing/parse/retry deterministically with no real network and no real
//     wall-clock wait.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ImageInput,
  SpeciesContext,
  VisionJudge,
  JudgeOutput,
  CriteriaScores,
} from '@bird-watch/photo-quality';
import { CRITERIA_KEYS } from '@bird-watch/photo-quality';
import { Pacer, withBackoff, realClock, type Clock } from '../pacing.js';

/** Min ms between Gemini calls → ≤10 RPM (well under the free-tier per-minute cap). */
export const GEMINI_PACE_MS = 6_000;

/** Thrown when the model's reply cannot be parsed into a JudgeOutput, even after one re-ask. */
export class GeminiJudgeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GeminiJudgeError';
  }
}

/** A status-carrying error so ../pacing.ts `isTransient` retries 429/5xx via withBackoff. */
class GeminiHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GeminiHttpError';
  }
}

/** The subset of `fetch` we use (so tests can inject a typed fake). */
export type FetchImpl = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface GeminiVisionJudgeOptions {
  apiKey: string;
  /** Defaults to the issue-pinned model. */
  model?: string;
  /** Injected clock so unit tests assert pacing WITHOUT a real wall-clock wait. */
  clock?: Clock;
  /** Injected fetch so unit tests never hit the real network. */
  fetchImpl?: FetchImpl;
}

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * The OpenAPI-3.0-subset response schema mapping `JudgeOutput`. Gemini's
 * `responseSchema` uses UPPERCASE `type` enums (OBJECT/STRING/NUMBER/ARRAY/
 * BOOLEAN). `propertyOrdering` keeps the model's keys in our canonical order.
 */
const CRITERIA_PROPS: Record<keyof CriteriaScores, { type: 'NUMBER' }> = Object.fromEntries(
  CRITERIA_KEYS.map(k => [k, { type: 'NUMBER' as const }]),
) as Record<keyof CriteriaScores, { type: 'NUMBER' }>;

export const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    fieldMarks: { type: 'ARRAY', items: { type: 'STRING' } },
    criteria: {
      type: 'OBJECT',
      properties: CRITERIA_PROPS,
      required: [...CRITERIA_KEYS],
      propertyOrdering: [...CRITERIA_KEYS],
    },
    flags: { type: 'ARRAY', items: { type: 'STRING' } },
    keep: { type: 'BOOLEAN' },
    qualityScore: { type: 'NUMBER' },
    rationale: { type: 'STRING' },
  },
  required: ['fieldMarks', 'criteria', 'flags', 'keep', 'qualityScore', 'rationale'],
  propertyOrdering: ['fieldMarks', 'criteria', 'flags', 'keep', 'qualityScore', 'rationale'],
} as const;

/** One-line species framing woven into the text part alongside the rubric prompt. */
function speciesFraming(ctx: SpeciesContext): string {
  return `Species under review: ${ctx.comName} (${ctx.sciName}), family ${ctx.family} [${ctx.speciesCode}].`;
}

/** Build the v1beta generateContent request body for one image. */
function buildRequestBody(img: ImageInput, ctx: SpeciesContext, prompt: string) {
  return {
    contents: [
      {
        parts: [
          { text: `${prompt}\n\n${speciesFraming(ctx)}` },
          { inlineData: { mimeType: img.mime, data: img.buffer.toString('base64') } },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: GEMINI_RESPONSE_SCHEMA,
    },
  };
}

/** Pull the model's JSON text out of the v1beta response envelope. */
function extractText(json: unknown): string {
  const text = (json as { candidates?: { content?: { parts?: { text?: unknown }[] } }[] })
    ?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') {
    throw new GeminiJudgeError('Gemini response missing candidates[0].content.parts[0].text');
  }
  return text;
}

/** Coerce a parsed object into a JudgeOutput, throwing GeminiJudgeError on a bad shape. */
function toJudgeOutput(raw: unknown): JudgeOutput {
  if (typeof raw !== 'object' || raw === null) {
    throw new GeminiJudgeError('Gemini JSON answer is not an object');
  }
  const o = raw as Record<string, unknown>;
  const criteriaIn = o.criteria;
  if (typeof criteriaIn !== 'object' || criteriaIn === null) {
    throw new GeminiJudgeError('Gemini answer missing criteria object');
  }
  const cIn = criteriaIn as Record<string, unknown>;
  const criteria = {} as CriteriaScores;
  for (const key of CRITERIA_KEYS) {
    const v = cIn[key];
    if (typeof v !== 'number') {
      throw new GeminiJudgeError(`Gemini answer criteria.${key} is not a number`);
    }
    criteria[key] = v;
  }
  if (typeof o.keep !== 'boolean') {
    throw new GeminiJudgeError('Gemini answer keep is not a boolean');
  }
  if (typeof o.qualityScore !== 'number') {
    throw new GeminiJudgeError('Gemini answer qualityScore is not a number');
  }
  const fieldMarks = Array.isArray(o.fieldMarks) ? o.fieldMarks.map(String) : [];
  const flags = Array.isArray(o.flags) ? o.flags.map(String) : [];
  const rationale = typeof o.rationale === 'string' ? o.rationale : '';
  return { fieldMarks, criteria, flags, keep: o.keep, qualityScore: o.qualityScore, rationale };
}

/**
 * Gemini-backed `VisionJudge`. Paces calls (≤10 RPM), retries transient
 * 429/5xx via `withBackoff`, and on an unparseable body re-asks ONCE before
 * throwing `GeminiJudgeError`.
 */
export class GeminiVisionJudge implements VisionJudge {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: FetchImpl;
  private readonly pacer: Pacer;
  private readonly clock: Clock;

  constructor(opts: GeminiVisionJudgeOptions) {
    if (!opts.apiKey) {
      throw new GeminiJudgeError('GeminiVisionJudge requires an apiKey');
    }
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? 'gemini-2.5-flash';
    this.clock = opts.clock ?? realClock;
    this.fetchImpl = opts.fetchImpl ?? (fetch as FetchImpl);
    this.pacer = new Pacer(GEMINI_PACE_MS, this.clock);
  }

  /** POST once and return the model's JSON text (throws GeminiHttpError on a non-2xx). */
  private async callOnce(img: ImageInput, ctx: SpeciesContext, prompt: string): Promise<string> {
    const url = `${GEMINI_ENDPOINT}/${this.model}:generateContent?key=${this.apiKey}`;
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildRequestBody(img, ctx, prompt)),
    });
    if (!res.ok) {
      throw new GeminiHttpError(res.status, `Gemini ${res.status} for ${this.model}:generateContent`);
    }
    const json: unknown = await res.json();
    return extractText(json);
  }

  /** One paced, backoff-wrapped ask → parsed JudgeOutput. */
  private async ask(img: ImageInput, ctx: SpeciesContext, prompt: string): Promise<JudgeOutput> {
    await this.pacer.gate();
    const text = await withBackoff(() => this.callOnce(img, ctx, prompt), { clock: this.clock });
    return toJudgeOutput(JSON.parse(text));
  }

  async judge(img: ImageInput, ctx: SpeciesContext, prompt: string): Promise<JudgeOutput> {
    try {
      return await this.ask(img, ctx, prompt);
    } catch (err) {
      // A transport/HTTP failure that survived withBackoff is unrecoverable —
      // surface it. Only a PARSE failure earns a single re-ask.
      if (err instanceof GeminiHttpError) {
        throw new GeminiJudgeError(err.message, { cause: err });
      }
      if (!(err instanceof GeminiJudgeError) && !(err instanceof SyntaxError)) {
        throw err;
      }
    }
    // Single re-ask on a parse failure.
    try {
      return await this.ask(img, ctx, prompt);
    } catch (err) {
      throw new GeminiJudgeError(
        `Gemini returned an unparseable answer after one re-ask: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }
}

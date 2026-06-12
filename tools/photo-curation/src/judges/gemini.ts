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
//     never hand-rolled. `GEMINI_PACE_MS` (default 12_000 → ≤5 RPM, the
//     free-tier per-minute cap measured 2026-06-11, #1036) gates every call and
//     is env-overridable for paid tiers.
//   • Quota signals are PARSED from the 429 body (#1036) — `error.details[]`
//     is the only quota ground truth Google exposes (no remaining-quota API).
//     A `PerDay` quotaId latches the judge: the daily cap resets ~midnight
//     Pacific, far outside any backoff window, so further calls are pointless.
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

/**
 * Resolve the pacing env knob. A presence check — NOT `Number(...) || default`
 * — so an explicit `GEMINI_PACE_MS=0` (pacing off, e.g. a paid tier with its
 * own quota ceiling) is honored rather than silently swallowed (#1038 review).
 * An EMPTY value falls back to the default (`Number('')` is 0, which is not
 * intent), and an unparseable or negative value throws at import: the old
 * `|| 12_000` masked NaN by falling back, and a bare presence check would
 * instead feed NaN to the Pacer and disable pacing silently — bursting the
 * API is worse than failing loud.
 */
function resolvePaceMs(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 12_000;
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error(`GEMINI_PACE_MS must be a non-negative number of ms, got '${raw}'`);
  }
  return ms;
}

/**
 * Min ms between Gemini calls. Default 12_000 → ≤5 RPM, the free-tier
 * per-minute cap measured 2026-06-11 (#1036; the previous, faster default
 * targeted a since-halved tier). Env-overridable via `GEMINI_PACE_MS` — the same
 * no-rebuild tuning-knob pattern as the ingestor's `--pace-ms` — so a paid
 * tier with a self-imposed quota cap can loosen it (down to an explicit `0` =
 * no pacing) without a code change.
 */
export const GEMINI_PACE_MS = resolvePaceMs(process.env.GEMINI_PACE_MS);

/** Thrown when the model's reply cannot be parsed into a JudgeOutput, even after one re-ask. */
export class GeminiJudgeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GeminiJudgeError';
  }
}

/**
 * Thrown when Gemini's DAILY quota is exhausted (#1036). The first `PerDay`
 * 429 latches the judge instance: this same type is thrown on that first trip
 * AND on every subsequent `judge()` call — without another network request.
 * Rationale: the eval shares ONE judge across serially-run rows
 * (maxConcurrency: 1, #1015); without the latch a mid-run cap trip burns every
 * remaining row × (maxRetries + 1) pointless requests.
 */
export class GeminiDailyQuotaError extends Error {
  /** Honored FIRST by ../pacing.ts `isTransient` — never retried. */
  readonly nonTransient = true;
  constructor(
    readonly quotaId: string,
    options?: { cause?: unknown },
  ) {
    super(
      `Gemini free-tier daily cap exhausted (${quotaId}) — resume after midnight Pacific`,
      options,
    );
    this.name = 'GeminiDailyQuotaError';
  }
}

/**
 * Token usage from a v1beta response's `usageMetadata` (#1037). Captured
 * internally so the tracing seam can log Braintrust token metrics WITHOUT
 * touching the SDK-free `JudgeOutput` contract in @bird-watch/photo-quality.
 * `thoughtsTokenCount` appears only when the model spent thinking tokens;
 * `totalTokenCount` includes them when present.
 */
export interface GeminiUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
}

/** Read the optional `usageMetadata` numbers out of a 200 response envelope. */
function extractUsage(json: unknown): GeminiUsage | undefined {
  const raw = (json as { usageMetadata?: unknown } | null)?.usageMetadata;
  if (typeof raw !== 'object' || raw === null) return undefined;
  const u = raw as Record<string, unknown>;
  const usage: GeminiUsage = {};
  for (const key of ['promptTokenCount', 'candidatesTokenCount', 'thoughtsTokenCount', 'totalTokenCount'] as const) {
    if (typeof u[key] === 'number') usage[key] = u[key];
  }
  return Object.keys(usage).length > 0 ? usage : undefined;
}

/** Quota signals parsed from a Google 429 body's `error.details[]` (#1036). */
interface QuotaSignals {
  quotaId?: string;
  retryDelayMs?: number;
}

/** Parse a proto-JSON Duration like `"13s"` / `"3.5s"` into ms (undefined if unparseable). */
function parseRetryDelayMs(retryDelay: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)s$/.exec(retryDelay.trim());
  return m ? Math.round(Number(m[1]) * 1000) : undefined;
}

/**
 * Read quota signals out of a non-2xx response body. Google's 429 carries
 * `error.details[]` with `QuotaFailure.violations[].quotaId` and
 * `RetryInfo.retryDelay`. A non-JSON or differently-shaped body yields `{}`,
 * preserving the plain-transient (jittered backoff) behavior.
 *
 * The quotaId scan covers EVERY violation across every QuotaFailure detail and
 * prefers a `/PerDay/` one (#1038 review): Google can pack PerMinute + PerDay
 * into one `violations[]` with PerMinute first, and a first-violation-wins
 * read would never latch the drained daily cap — the run would retry a quota
 * that resets at midnight, not in seconds.
 */
async function readQuotaSignals(res: Response): Promise<QuotaSignals> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return {};
  }
  const details = (body as { error?: { details?: unknown } } | null)?.error?.details;
  if (!Array.isArray(details)) return {};
  const signals: QuotaSignals = {};
  const quotaIds: string[] = [];
  for (const detail of details) {
    if (typeof detail !== 'object' || detail === null) continue;
    const d = detail as { violations?: unknown; retryDelay?: unknown };
    if (Array.isArray(d.violations)) {
      for (const violation of d.violations) {
        const quotaId = (violation as { quotaId?: unknown } | null)?.quotaId;
        if (typeof quotaId === 'string') quotaIds.push(quotaId);
      }
    }
    if (typeof d.retryDelay === 'string') {
      const ms = parseRetryDelayMs(d.retryDelay);
      if (ms !== undefined) signals.retryDelayMs = ms;
    }
  }
  const preferred = quotaIds.find((id) => /PerDay/.test(id)) ?? quotaIds[0];
  if (preferred !== undefined) signals.quotaId = preferred;
  return signals;
}

/**
 * A status-carrying error so ../pacing.ts `isTransient`/`withBackoff` can act
 * on it. Enriched (#1036) with the 429 body's quota signals: `quotaId` (also
 * woven into the message — that string is what lands in the Braintrust span's
 * `error` field, where a bare "Gemini 429" is undiagnosable), `retryDelayMs`
 * (server RetryInfo hint; `withBackoff` sleeps at least this long), and
 * `nonTransient` for `/PerDay/` quotaIds (a drained daily cap is not flake).
 */
class GeminiHttpError extends Error {
  readonly quotaId?: string;
  readonly retryDelayMs?: number;
  readonly nonTransient?: boolean;
  constructor(
    readonly status: number,
    message: string,
    signals: QuotaSignals = {},
  ) {
    super(message);
    this.name = 'GeminiHttpError';
    if (signals.quotaId !== undefined) {
      this.quotaId = signals.quotaId;
      if (/PerDay/.test(signals.quotaId)) this.nonTransient = true;
    }
    if (signals.retryDelayMs !== undefined) this.retryDelayMs = signals.retryDelayMs;
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
 * Gemini-backed `VisionJudge`. Paces calls (`GEMINI_PACE_MS`, default ≤5 RPM),
 * retries transient 429/5xx via `withBackoff` honoring the server's RetryInfo
 * hint, fails fast (latched) once the daily quota trips, and on an unparseable
 * body re-asks ONCE before throwing `GeminiJudgeError`.
 */
export class GeminiVisionJudge implements VisionJudge {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: FetchImpl;
  private readonly pacer: Pacer;
  private readonly clock: Clock;
  /** quotaId of the tripped daily cap; once set, judge() fails fast forever (#1036). */
  private dailyExhaustedQuotaId: string | null = null;
  /** usageMetadata of the LATEST 200 response — overwritten (or cleared) per response (#1037). */
  private _lastUsage: GeminiUsage | undefined;

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
      const signals = await readQuotaSignals(res);
      const quota = signals.quotaId === undefined ? '' : ` (quotaId: ${signals.quotaId})`;
      throw new GeminiHttpError(
        res.status,
        `Gemini ${res.status} for ${this.model}:generateContent${quota}`,
        signals,
      );
    }
    const json: unknown = await res.json();
    // Overwrite (or clear) per response so a row's span never inherits a
    // PREVIOUS row's token counts. On a parse re-ask the second response wins:
    // lastUsage() is per-output, not a per-row cost accumulator.
    this._lastUsage = extractUsage(json);
    return extractText(json);
  }

  /**
   * Token usage of the latest 200 response, or `undefined` when none has been
   * seen (or the latest carried no `usageMetadata`). The tracing seam reads
   * this right after a judgment resolves to surface Braintrust token metrics
   * (#1037 decision 5) — `JudgeOutput` itself stays unchanged.
   */
  lastUsage(): GeminiUsage | undefined {
    return this._lastUsage;
  }

  /** One paced, backoff-wrapped ask → parsed JudgeOutput. */
  private async ask(img: ImageInput, ctx: SpeciesContext, prompt: string): Promise<JudgeOutput> {
    await this.pacer.gate();
    let text: string;
    try {
      text = await withBackoff(() => this.callOnce(img, ctx, prompt), { clock: this.clock });
    } catch (err) {
      // First daily-cap trip: latch the judge and surface the dedicated type.
      // (withBackoff never retried it — `nonTransient` short-circuits isTransient.)
      if (err instanceof GeminiHttpError && err.nonTransient === true && err.quotaId !== undefined) {
        this.dailyExhaustedQuotaId = err.quotaId;
        throw new GeminiDailyQuotaError(err.quotaId, { cause: err });
      }
      throw err;
    }
    return toJudgeOutput(JSON.parse(text));
  }

  async judge(img: ImageInput, ctx: SpeciesContext, prompt: string): Promise<JudgeOutput> {
    // Latched daily exhaustion: fail fast with ZERO pacing and ZERO network.
    if (this.dailyExhaustedQuotaId !== null) {
      throw new GeminiDailyQuotaError(this.dailyExhaustedQuotaId);
    }
    try {
      return await this.ask(img, ctx, prompt);
    } catch (err) {
      // The daily-cap classification must NOT be swallowed into the generic
      // wrap: the FIRST PerDay trip throws the same type latched trips do.
      if (err instanceof GeminiDailyQuotaError) {
        throw err;
      }
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
      if (err instanceof GeminiDailyQuotaError) {
        throw err;
      }
      throw new GeminiJudgeError(
        `Gemini returned an unparseable answer after one re-ask: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }
}

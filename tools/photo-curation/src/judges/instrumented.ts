// ─────────────────────────────────────────────────────────────────────────────
// Sink instrumentation wrapper + construction choke point (#1094 — replaces the
// Braintrust traced.ts seam).
//
// The load-bearing requirement (carried over from #1012): NOTHING scores
// uninstrumented. Every judgment must emit one record to the injected `sink`.
// We enforce that structurally at the *public construction boundary*: the judges
// barrel (./index.ts) exports ONLY `resolveJudge`, which constructs a
// `GeminiVisionJudge` and wraps it with `instrumentedJudge`. `GeminiVisionJudge`
// is exported from ./gemini.ts for its own unit test, but is absent from the
// barrel — so a consumer importing from the package surface cannot obtain an
// uninstrumented judge. This is an export-surface guarantee, not a claim the
// class is unreachable.
//
// Replaces the Braintrust span seam (initLogger/traced) with a plain `sink`
// callback the runner backs with a local eleatic-store eval-row write (E8,
// #1151). The token-extraction + estimateCostUsd + warn-once-on-unpriced logic
// is PORTED verbatim from traced.ts (it was never Braintrust-specific — only the
// span transport was).
//
// Design notes (deliberate):
//   • `sink` is the injectable record boundary. Tests pass a recording array;
//     the runner passes a closure that records one eleatic eval row. A judgment
//     that THROWS emits NO record (it never produced an output to record) — the
//     inner error propagates unchanged, and the runner skips that row.
//   • Key absence FAILS LOUD (`MissingGeminiKey`) — we never score blind. There
//     is no `MissingBraintrustKey` anymore: the store is local, no BT key.
// ─────────────────────────────────────────────────────────────────────────────

import type { ImageInput, JudgeOutput, SpeciesContext, VisionJudge } from '@bird-watch/photo-quality';
import { GeminiVisionJudge, type GeminiUsage } from './gemini.js';
import { estimateCostUsd } from './pricing.js';

/** Thrown at construction when `GEMINI_API_KEY` is absent. */
export class MissingGeminiKey extends Error {
  constructor(message = 'GEMINI_API_KEY is required to construct the Gemini judge') {
    super(message);
    this.name = 'MissingGeminiKey';
  }
}

/**
 * The span-shaped input framing recorded for each judgment (mirrors what the
 * old Braintrust span logged as `input`). `judgedRubricVersion` is the version
 * the judge was INVOKED with (a stable caller-supplied tag, not the prompt
 * body); `sourceUrl` is the portable provenance URL.
 */
export interface JudgmentInput {
  speciesCode: string;
  comName: string;
  sciName: string;
  family: string;
  judgedRubricVersion: string;
  model: string;
  sourceUrl?: string;
}

/**
 * One judgment's emitted record. The runner joins this with the dataset row's
 * Opus baseline + run id and records one eleatic eval row. `promptTokens` /
 * `completionTokens` are `undefined` when no usage was reported;
 * `estimatedCost` is `undefined` for an unpriced model OR an absent-usage
 * judgment (the unpriced warning fires only for a price-table miss).
 *
 * `latencyMs` (#1168, trace T3) is the wall time the inner `judge()` took,
 * measured with an INJECTABLE monotonic clock (deterministic in tests). It is
 * always present — every recorded judgment completed, so a duration exists.
 * `rawResponse` is the model's raw reply (the Gemini judge's `await res.json()`
 * envelope), surfaced via an injectable accessor; the key is ABSENT when no
 * accessor is wired or it returned `undefined` (exactOptionalPropertyTypes).
 */
export interface JudgmentRecord {
  input: JudgmentInput;
  output: JudgeOutput;
  promptTokens: number | undefined;
  completionTokens: number | undefined;
  estimatedCost: number | undefined;
  latencyMs: number;
  rawResponse?: unknown;
}

/** The injectable record boundary — every judgment emits exactly one record. */
export type JudgmentSink = (record: JudgmentRecord) => void;

export interface InstrumentedJudgeOptions {
  /** The judge model name recorded on each record (e.g. `gemini-2.5-flash`). */
  model: string;
  /**
   * The rubric version the judge is INVOKED with (#1037) — recorded as
   * `judgedRubricVersion`. A stable tag (e.g. `0.2.1`), not the prompt body.
   */
  rubricVersion: string;
  /** The record boundary — injectable so tests need no DB. */
  sink: JudgmentSink;
  /**
   * Optional accessor for the inner judge's latest-call token usage (#1037
   * decision 5). Read AFTER each judgment resolves; keeps the usage hand-off
   * internal to this package so `JudgeOutput` stays SDK-free and unchanged.
   */
  usage?: () => GeminiUsage | undefined;
  /**
   * Optional accessor for the inner judge's latest-call RAW response (#1168,
   * trace T3) — the Gemini judge's `await res.json()` envelope, read AFTER each
   * judgment resolves (mirroring `usage`). Kept on the concrete judge + read
   * here so `VisionJudge`/`JudgeOutput` stay unchanged. When absent or it
   * returns `undefined`, the record's `rawResponse` key is omitted entirely.
   */
  rawResponse?: () => unknown;
  /**
   * Injectable monotonic clock (#1168) — read immediately before and after the
   * inner `judge()` call; the delta is recorded as `latencyMs`. Defaults to a
   * real monotonic clock (`performance.now`). Injected so the latency assertion
   * is deterministic (the Clock-injection precedent in gemini.ts / pacing.ts).
   */
  now?: () => number;
  /**
   * One-line warning sink (#1088). Surfaces an UNPRICED model — exactly ONCE
   * per unpriced model id for the lifetime of this wrapped judge (a per-judgment
   * warning would fire ~150×/run = log noise) — so an unpriced run is visible
   * (not silently $0) without spamming. Defaults to `console.warn`.
   */
  warn?: (line: string) => void;
}

/**
 * Token + cost for one judgment (#1088, ported from traced.ts). Given the model
 * and the already-mapped token counts, returns the estimated USD cost for a
 * PRICED model — or `undefined` plus a one-line warning (naming the model) for
 * an UNPRICED one. When token counts are absent there is nothing to price:
 * returns `undefined` and does NOT warn. The warning is DEDUPED to once per
 * unpriced model id via the per-wrapped-judge `warned` set.
 */
function costFor(
  model: string,
  promptTokens: number | undefined,
  completionTokens: number | undefined,
  warn: (line: string) => void,
  warned: Set<string>,
): number | undefined {
  if (promptTokens === undefined || completionTokens === undefined) return undefined;
  const cost = estimateCostUsd(model, promptTokens, completionTokens);
  if (cost === undefined) {
    if (!warned.has(model)) {
      warned.add(model);
      warn(`[pricing] no price for model "${model}" — omitting estimated_cost (run cost is partial). Add it to MODEL_PRICING in src/judges/pricing.ts.`);
    }
    return undefined;
  }
  return cost;
}

/**
 * Map a `GeminiUsage` onto the two token counts the store records.
 * `completionTokens` includes thinking tokens (output we pay for, mirroring the
 * OpenAI-style convention). Each is `undefined` when not computable — never a
 * fabricated 0.
 */
function tokensFor(usage: GeminiUsage | undefined): { promptTokens: number | undefined; completionTokens: number | undefined } {
  if (usage === undefined) return { promptTokens: undefined, completionTokens: undefined };
  const { promptTokenCount, candidatesTokenCount, thoughtsTokenCount } = usage;
  return {
    promptTokens: promptTokenCount,
    completionTokens:
      candidatesTokenCount === undefined ? undefined : candidatesTokenCount + (thoughtsTokenCount ?? 0),
  };
}

/**
 * Decorate any `VisionJudge` so each `judge()` emits ONE `JudgmentRecord` to
 * `opts.sink` after the inner judge resolves: the species framing + judged
 * rubric version + model + source URL (`input`), the full `JudgeOutput`
 * (`output`), and the per-call `promptTokens` / `completionTokens` / `estimatedCost`
 * from `opts.usage` (#1088) when available. A judgment that THROWS emits no
 * record (it produced no output to record) and the inner error propagates
 * unchanged.
 *
 * `judgedRubricVersion` records `opts.rubricVersion` (a stable tag like `0.2.1`),
 * NOT the prompt body — the durable knob to compare runs by. It comes from the
 * CALLER (the judge may run a snapshot prompt older than the live config, #1037).
 */
export function instrumentedJudge(inner: VisionJudge, opts: InstrumentedJudgeOptions): VisionJudge {
  const { model, rubricVersion, sink, usage } = opts;
  const warn = opts.warn ?? ((line: string) => console.warn(line));
  // Default to a real monotonic clock (#1168). `performance.now()` is monotonic
  // (immune to wall-clock adjustments) and millisecond-fractional; an injected
  // `now` makes the latency delta deterministic in tests.
  const now = opts.now ?? (() => performance.now());
  // Per-wrapped-judge set of unpriced model ids already warned about, so the
  // unpriced-model warning fires once per model for this judge's lifetime — not
  // once per judgment (#1088 review). Lives OUTSIDE the per-call closure.
  const warnedUnpriced = new Set<string>();
  return {
    async judge(img: ImageInput, ctx: SpeciesContext, prompt: string): Promise<JudgeOutput> {
      // Time the inner call with the injectable clock. A judgment that THROWS
      // never reaches the sink (no record), so latency is only ever recorded
      // for a completed judgment — `startedAt` read here, `latencyMs` below.
      const startedAt = now();
      const output = await inner.judge(img, ctx, prompt);
      const latencyMs = now() - startedAt;
      const { promptTokens, completionTokens } = tokensFor(usage?.());
      const estimatedCost = costFor(model, promptTokens, completionTokens, warn, warnedUnpriced);
      // Raw model reply (#1168), read AFTER the judgment resolves (mirrors
      // `usage`). Spread-guarded so the key is ABSENT when no accessor is wired
      // or it returns `undefined` (never `rawResponse: undefined`).
      const rawResponse = opts.rawResponse?.();
      sink({
        input: {
          speciesCode: ctx.speciesCode,
          comName: ctx.comName,
          sciName: ctx.sciName,
          family: ctx.family,
          judgedRubricVersion: rubricVersion,
          model,
          // `sourceUrl` stays the queryable provenance string. Spread-guard the
          // empty case so an image with no public URL omits the key entirely
          // (never `sourceUrl: undefined`).
          ...(img.sourceUrl ? { sourceUrl: img.sourceUrl } : {}),
        },
        output,
        promptTokens,
        completionTokens,
        estimatedCost,
        latencyMs,
        ...(rawResponse !== undefined ? { rawResponse } : {}),
      });
      return output;
    },
  };
}

/** The env subset the resolver reads. Only the Gemini key is required now. */
export interface JudgeEnv {
  GEMINI_API_KEY?: string;
}

export interface ResolveJudgeOptions {
  /** The Gemini model to construct (e.g. `gemini-2.5-flash`). */
  model: string;
  /**
   * The rubric version of the prompt this judge will be invoked with (#1037)
   * — recorded as `judgedRubricVersion` on every record. REQUIRED so the caller
   * cannot construct a judge without declaring which criteria it judges under.
   */
  rubricVersion: string;
  /** The record sink the wrapped judge emits to (mandatory — see barrel guarantee). */
  sink: JudgmentSink;
  /** Optional unpriced-model warning sink; defaults to `console.warn` in the wrapper. */
  warn?: (line: string) => void;
}

/**
 * The ONLY public way to build a production judge. Fails loud on a missing
 * Gemini key (`MissingGeminiKey`), constructs the Gemini judge, and returns it
 * wrapped so every judgment emits to `opts.sink`. Because the judges barrel
 * re-exports only this function, every judge a consumer can obtain is
 * instrumented — there is no path to an uninstrumented judge.
 */
export function resolveJudge(env: JudgeEnv, opts: ResolveJudgeOptions): VisionJudge {
  if (!env.GEMINI_API_KEY) {
    throw new MissingGeminiKey();
  }
  const inner = new GeminiVisionJudge({ apiKey: env.GEMINI_API_KEY, model: opts.model });
  return instrumentedJudge(inner, {
    model: opts.model,
    rubricVersion: opts.rubricVersion,
    sink: opts.sink,
    ...(opts.warn ? { warn: opts.warn } : {}),
    // Internal usage hand-off (#1037 decision 5): the wrapper reads the inner
    // judge's latest usageMetadata after each judgment to record token counts.
    usage: () => inner.lastUsage(),
    // Internal raw-response hand-off (#1168, trace T3): the wrapper reads the
    // inner judge's latest raw envelope after each judgment to record it on the
    // trace span. Kept here (not on VisionJudge) so the seam stays unchanged.
    rawResponse: () => inner.lastRawResponse(),
  });
}

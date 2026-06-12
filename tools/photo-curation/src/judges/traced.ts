// ─────────────────────────────────────────────────────────────────────────────
// Braintrust tracing wrapper + construction choke point (#1012, part of #1010).
//
// The load-bearing requirement (spec §Components.2): NOTHING scores un-traced.
// Every judgment must log one span to the hosted `bird-maps` Braintrust project.
// We enforce that structurally at the *public construction boundary*: the judges
// barrel (./index.ts) exports ONLY `resolveTracedJudge`, which constructs a
// `GeminiVisionJudge` and wraps it in a Braintrust span. `GeminiVisionJudge` is
// exported from ./gemini.ts for its own unit test, but is absent from the barrel
// — so a consumer importing from the package surface cannot obtain an un-traced
// judge. This is an export-surface guarantee, not a claim the class is unreachable.
//
// Design notes (deliberate):
//   • `BraintrustLoggerSeam` is the injectable span boundary. Tests pass a
//     recording fake (no network, no key); production passes an `initLogger`-
//     backed adapter built in `resolveTracedJudge`. The seam narrows the SDK to
//     the one method we use (`traced(fn)` → a span with `.log({...})`).
//   • Key absence FAILS LOUD (`MissingGeminiKey` / `MissingBraintrustKey`) —
//     we never score blind (spec §Error handling).
//   • The Braintrust SDK API was verified against the current docs (context7,
//     2026-06-11): `initLogger({projectName, apiKey})`, the bare module-level
//     `traced(async span => …)`, and `span.log({input})` /
//     `span.log({output, metadata, metrics})`.
//   • SPAN NESTING (#1015 review): `resolveTracedJudge`'s seam opens spans via
//     the BARE ambient `traced` (imported from `braintrust`), NOT
//     `initLogger(...).traced`. Per the SDK, `traced` parents to the currently
//     active span → experiment → logger, in that order. So inside a `bt eval`
//     task the per-judgment span nests UNDER the experiment trace; outside an
//     eval it falls back to the `initLogger`-registered project logger (so
//     production scoring still logs). `initLogger` is still called to establish
//     that fallback context — it is the active logger when no experiment is.
// ─────────────────────────────────────────────────────────────────────────────

import { initLogger, traced } from 'braintrust';
import type { ImageInput, JudgeOutput, SpeciesContext, VisionJudge } from '@bird-watch/photo-quality';
import { GeminiVisionJudge, type GeminiUsage } from './gemini.js';

/** Thrown at construction when `BRAINTRUST_API_KEY` is absent — never score blind. */
export class MissingBraintrustKey extends Error {
  constructor(message = 'BRAINTRUST_API_KEY is required — refusing to score un-traced') {
    super(message);
    this.name = 'MissingBraintrustKey';
  }
}

/** Thrown at construction when `GEMINI_API_KEY` is absent. */
export class MissingGeminiKey extends Error {
  constructor(message = 'GEMINI_API_KEY is required to construct the Gemini judge') {
    super(message);
    this.name = 'MissingGeminiKey';
  }
}

/** The one span method we use, narrowed so a test fake needs no SDK types. */
export interface BraintrustSpan {
  log(fields: object): void;
}

/**
 * The injectable Braintrust boundary. `traced(fn)` opens one span, runs `fn`
 * with it, and closes the span once `fn` settles (resolve OR reject) — exactly
 * the real SDK's `logger.traced` contract. `nowMs` is an optional clock so the
 * wrapper measures latency deterministically in tests; production omits it and
 * the wrapper falls back to `Date.now`.
 */
export interface BraintrustLoggerSeam {
  traced<T>(fn: (span: BraintrustSpan) => Promise<T>): Promise<T>;
  /** Optional injected clock (ms). Defaults to `Date.now` when absent. */
  nowMs?: () => number;
}

export interface TracedJudgeOptions {
  /** The Braintrust project these spans log to (e.g. `bird-maps`). */
  project: string;
  /** The judge model name recorded on each span (e.g. `gemini-2.5-flash`). */
  model: string;
  /**
   * The rubric version the judge is INVOKED with — i.e. the version whose
   * prompt text the caller hands to `judge()` (#1037). Logged on every span
   * input as `judgedRubricVersion` so it can be compared against the dataset
   * row's `expectedRubricVersion` in Braintrust: equal by construction under
   * the eval's pin, and any future mismatch is visible/sliceable, not silent.
   */
  rubricVersion: string;
  /** The span boundary — injectable so tests need no network or key. */
  logger: BraintrustLoggerSeam;
  /**
   * Optional accessor for the inner judge's latest-call token usage (#1037
   * decision 5). Read AFTER each judgment resolves; keeps the usage hand-off
   * internal to this package so `JudgeOutput` stays SDK-free and unchanged.
   */
  usage?: () => GeminiUsage | undefined;
}

/**
 * Map a `GeminiUsage` onto Braintrust's STANDARD token metric names.
 * `completion_tokens` includes thinking tokens (output we pay for, mirroring
 * the OpenAI-style convention); `total_tokens` prefers the response's own
 * `totalTokenCount` and falls back to prompt+completion. Each metric is
 * emitted only when computable — never a fabricated 0.
 */
function tokenMetrics(usage: GeminiUsage | undefined): Record<string, number> {
  if (usage === undefined) return {};
  const metrics: Record<string, number> = {};
  const { promptTokenCount, candidatesTokenCount, thoughtsTokenCount, totalTokenCount } = usage;
  if (promptTokenCount !== undefined) metrics.prompt_tokens = promptTokenCount;
  if (candidatesTokenCount !== undefined) {
    metrics.completion_tokens = candidatesTokenCount + (thoughtsTokenCount ?? 0);
  }
  if (totalTokenCount !== undefined) {
    metrics.total_tokens = totalTokenCount;
  } else if (metrics.prompt_tokens !== undefined && metrics.completion_tokens !== undefined) {
    metrics.total_tokens = metrics.prompt_tokens + metrics.completion_tokens;
  }
  return metrics;
}

/**
 * Decorate any `VisionJudge` with a Braintrust span. Each `judge()` runs the
 * inner judge inside `logger.traced`, logging `input` (species framing + the
 * judged rubric version + model + source URL), `output` (the full
 * `JudgeOutput`), `metadata` (`latencyMs`, `model`), and `metrics`
 * (`latency` in seconds — Braintrust's aggregated latency field, so the
 * experiment dashboard rolls up p50/p95 across judgments — plus the
 * `prompt_tokens`/`completion_tokens`/`total_tokens` from `opts.usage` when
 * available). The span closes on success AND on error (the inner error
 * propagates unchanged).
 *
 * `judgedRubricVersion` logs `opts.rubricVersion` (a stable tag like `0.2.1`),
 * NOT the full prompt body (#1015 review): the prompt text is large and noisy
 * on every span; the version is the durable knob that changes only on a
 * calibration tune, which is what we actually want to compare experiments by.
 * It comes from the CALLER — not `defaultRubricConfig` — because under the
 * #1037 pin the judge may run a snapshot prompt older than the live config.
 */
export function tracedJudge(inner: VisionJudge, opts: TracedJudgeOptions): VisionJudge {
  const { project, model, rubricVersion, logger, usage } = opts;
  const now = logger.nowMs ?? Date.now;
  return {
    async judge(img: ImageInput, ctx: SpeciesContext, prompt: string): Promise<JudgeOutput> {
      return logger.traced(async (span) => {
        span.log({
          input: {
            speciesCode: ctx.speciesCode,
            comName: ctx.comName,
            sciName: ctx.sciName,
            family: ctx.family,
            judgedRubricVersion: rubricVersion,
            model,
            // `sourceUrl` stays the queryable provenance string (`bt sql`, the
            // analysis script). `image_url` nests the SAME URL in Braintrust's
            // recognized render shape (#1086) — per the BT docs
            // (`instrument/attachments.md` → "Inline attachments → Simple URLs"),
            // `{ image_url: { url } }` FORCES the tree viewer to render the
            // thumbnail inline, independent of its image-extension heuristic, so
            // disagreement review happens in the BT UI instead of out-of-band.
            // Spread-guard the empty case: an image with no public URL logs NO
            // `image_url` key (never `{ url: undefined }`, which would surface a
            // broken render hint).
            sourceUrl: img.sourceUrl,
            ...(img.sourceUrl ? { image_url: { url: img.sourceUrl } } : {}),
            project,
          },
        });
        const start = now();
        const output = await inner.judge(img, ctx, prompt);
        const latencyMs = now() - start;
        span.log({
          output,
          metadata: { latencyMs, model },
          // Braintrust's aggregated `metrics.latency` is in SECONDS — divide ms.
          metrics: { latency: latencyMs / 1000, ...tokenMetrics(usage?.()) },
        });
        return output;
      });
    },
  };
}

/** The env subset the resolver reads. Both keys are required to construct. */
export interface JudgeEnv {
  GEMINI_API_KEY?: string;
  BRAINTRUST_API_KEY?: string;
}

export interface ResolveTracedJudgeOptions {
  /** The Braintrust project to log to (e.g. `bird-maps`). */
  project: string;
  /** The Gemini model to construct (e.g. `gemini-2.5-flash`). */
  model: string;
  /**
   * The rubric version of the prompt this judge will be invoked with (#1037)
   * — logged as `judgedRubricVersion` on every span. REQUIRED so the caller
   * cannot construct a judge without declaring which criteria it judges under.
   */
  rubricVersion: string;
}

/**
 * The ONLY public way to build a production judge. Fails loud on a missing key
 * (`MissingGeminiKey` / `MissingBraintrustKey`), builds an `initLogger`-backed
 * Braintrust seam, constructs the Gemini judge, and returns it wrapped in a
 * tracing span. Because the judges barrel re-exports only this function, every
 * judge a consumer can obtain is traced.
 */
export function resolveTracedJudge(env: JudgeEnv, opts: ResolveTracedJudgeOptions): VisionJudge {
  if (!env.GEMINI_API_KEY) {
    throw new MissingGeminiKey();
  }
  if (!env.BRAINTRUST_API_KEY) {
    throw new MissingBraintrustKey();
  }
  // `initLogger` registers the project logger as the fallback active context
  // (so production scoring — no experiment — still logs to bird-maps). The seam
  // itself opens spans via the BARE ambient `traced`, which parents to the
  // active span → experiment → logger: inside a `bt eval` task that is the
  // experiment, so the per-judgment span nests under the experiment trace
  // instead of the project Logs stream (#1015 review).
  initLogger({ projectName: opts.project, apiKey: env.BRAINTRUST_API_KEY });
  const logger: BraintrustLoggerSeam = {
    traced: (fn) => traced(fn),
  };
  const inner = new GeminiVisionJudge({ apiKey: env.GEMINI_API_KEY, model: opts.model });
  return tracedJudge(inner, {
    project: opts.project,
    model: opts.model,
    rubricVersion: opts.rubricVersion,
    logger,
    // Internal usage hand-off (#1037 decision 5): the wrapper reads the inner
    // judge's latest usageMetadata after each judgment and logs token metrics.
    usage: () => inner.lastUsage(),
  });
}

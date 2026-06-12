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
import { defaultRubricConfig } from '@bird-watch/photo-quality';
import type { ImageInput, JudgeOutput, SpeciesContext, VisionJudge } from '@bird-watch/photo-quality';
import { GeminiVisionJudge } from './gemini.js';

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
  /** The span boundary — injectable so tests need no network or key. */
  logger: BraintrustLoggerSeam;
}

/**
 * Decorate any `VisionJudge` with a Braintrust span. Each `judge()` runs the
 * inner judge inside `logger.traced`, logging `input` (species framing + a
 * STABLE rubric version + model + source URL), `output` (the full
 * `JudgeOutput`), `metadata` (`latencyMs`, `model`), and `metrics`
 * (`latency` in seconds — Braintrust's aggregated latency field, so the
 * experiment dashboard rolls up p50/p95 across judgments). The span closes on
 * success AND on error (the inner error propagates unchanged).
 *
 * `rubricVersion` logs `defaultRubricConfig.version` (a stable tag like
 * `0.2.2`), NOT the full prompt body (#1015 review): the prompt text is large
 * and noisy on every span; the version is the durable knob that changes only on
 * a calibration tune, which is what we actually want to compare experiments by.
 */
export function tracedJudge(inner: VisionJudge, opts: TracedJudgeOptions): VisionJudge {
  const { project, model, logger } = opts;
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
            rubricVersion: defaultRubricConfig.version,
            model,
            sourceUrl: img.sourceUrl,
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
          metrics: { latency: latencyMs / 1000 },
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
  return tracedJudge(inner, { project: opts.project, model: opts.model, logger });
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-model Gemini price table + a pure cost estimator (#1088).
//
// The photo-judge eval logs Gemini token counts (`prompt_tokens` /
// `completion_tokens`, #1037) on every judgment span, but Braintrust does not
// auto-price our spans — we log tokens as custom metrics, not via its LLM
// auto-instrumentation. As we compare candidate models across experiments (the
// `EVAL_MODEL` knob), cost is the other half of the quality tradeoff, so we
// price the tokens HERE and log `metrics.estimated_cost` per span (traced.ts),
// which Braintrust then aggregates (experiment total/mean) and `bt sql` can sum.
//
// This mirrors the convention of `src/token-ledger.ts`'s `PRICE_TABLE` (the
// Anthropic side): ONE dated constant, USD per **Million** tokens, updatable as
// prices move. We never call a model here — we only price token counts the
// judge already reported.
//
// ── PRICING SOURCE — re-verify, prices drift ────────────────────────────────
// Rates below are the Gemini **Developer API** standard / ≤200k-token tier from
// Google's official pricing page:
//   https://ai.google.dev/gemini-api/docs/pricing
// page "Last updated 2026-06-09 UTC"; transcribed 2026-06-12.
//
// The eval sends one image + the rubric prompt per judgment — a few-thousand-
// token prompt, far under the 200k tier boundary — so the standard (lower) tier
// is the correct rate for every row this eval produces. The audio input column
// (where some models charge a higher input rate for audio) does not apply: we
// only send image + text. Gemini 2.5+ thinking tokens already roll into
// `completion_tokens` (#1037), so the single output rate covers them.
//
// MAINTENANCE: Google changes these rates without notice. Re-verify against the
// page above whenever a new EVAL_MODEL is introduced or a run's cost looks off,
// and bump the dated comment when you do. A model with NO published paid
// per-token rate (free-tier-only or discontinued previews) is deliberately
// OMITTED below so it is treated as unpriced (estimateCostUsd → undefined,
// traced.ts warns) rather than charged a guessed/zero cost.
// ─────────────────────────────────────────────────────────────────────────────

/** Per-model rate in USD per **1 million** tokens (input vs. output). */
export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

/**
 * USD per 1M tokens, keyed by the exact Gemini model id (the value passed as
 * `EVAL_MODEL` / constructed in `resolveTracedJudge`). Standard / ≤200k tier.
 *
 * Deliberately ABSENT (→ unpriced, warns, never $0):
 *   • gemini-3-pro-preview   — discontinued 2026-03-26 (use gemini-3.1-pro-preview);
 *     absent from the pricing page, so no current rate to charge against.
 * Add it back the moment Google publishes a paid rate — do not guess one.
 */
export const MODEL_PRICING: Record<string, ModelPrice> = {
  'gemini-2.5-flash': { inputPerMTok: 0.3, outputPerMTok: 2.5 },
  'gemini-2.5-flash-lite': { inputPerMTok: 0.1, outputPerMTok: 0.4 },
  'gemini-2.5-pro': { inputPerMTok: 1.25, outputPerMTok: 10.0 },
  // Gemini 3 Flash Preview standard tier: image/text input (the audio-input
  // column charges $1.00/1M but we only send image+text — see header note).
  'gemini-3-flash-preview': { inputPerMTok: 0.5, outputPerMTok: 3.0 },
  'gemini-3.5-flash': { inputPerMTok: 1.5, outputPerMTok: 9.0 },
  'gemini-3.1-flash-lite': { inputPerMTok: 0.25, outputPerMTok: 1.5 },
  'gemini-3.1-pro-preview': { inputPerMTok: 2.0, outputPerMTok: 12.0 },
};

/**
 * Estimate the USD cost of one judgment from its token counts:
 *   inputPerMTok·prompt/1e6 + outputPerMTok·completion/1e6.
 *
 * Returns `undefined` for a model not in `MODEL_PRICING` (an unpriced run must
 * be visible, not silently $0 — callers warn + omit the metric). Zero tokens on
 * a priced model returns 0 (a real, known cost), distinct from `undefined`.
 */
export function estimateCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number | undefined {
  const price = MODEL_PRICING[model];
  if (price === undefined) return undefined;
  return (price.inputPerMTok * promptTokens + price.outputPerMTok * completionTokens) / 1e6;
}

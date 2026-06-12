// ─────────────────────────────────────────────────────────────────────────────
// Judges barrel — the PUBLIC construction surface (#1012).
//
// This barrel deliberately exports ONLY `resolveTracedJudge` (and the fail-loud
// error types it can throw). It does NOT re-export `GeminiVisionJudge`: the raw
// ctor lives in ./gemini.ts for its own unit test, but a consumer importing from
// the judges surface cannot obtain an un-traced judge. Every judge reachable
// here is wrapped in a Braintrust span. Do NOT add `export … from './gemini.js'`
// — that would breach the construction-boundary guarantee (and its test).
// ─────────────────────────────────────────────────────────────────────────────

export {
  resolveTracedJudge,
  MissingBraintrustKey,
  MissingGeminiKey,
} from './traced.js';
export type {
  BraintrustLoggerSeam,
  BraintrustSpan,
  JudgeEnv,
  ResolveTracedJudgeOptions,
  TracedJudgeOptions,
} from './traced.js';

// ─────────────────────────────────────────────────────────────────────────────
// Judges barrel — the PUBLIC construction surface (#1012, #1094).
//
// This barrel deliberately exports ONLY `resolveJudge` (and the fail-loud error
// type it can throw). It does NOT re-export `GeminiVisionJudge`: the raw ctor
// lives in ./gemini.ts for its own unit test, but a consumer importing from the
// judges surface cannot obtain an uninstrumented judge. Every judge reachable
// here emits one record per judgment to the mandatory `sink`. Do NOT add
// `export … from './gemini.js'` — that would breach the construction-boundary
// guarantee (and its test).
// ─────────────────────────────────────────────────────────────────────────────

export {
  resolveJudge,
  MissingGeminiKey,
} from './instrumented.js';
export type {
  JudgeEnv,
  JudgmentInput,
  JudgmentRecord,
  JudgmentSink,
  InstrumentedJudgeOptions,
  ResolveJudgeOptions,
} from './instrumented.js';

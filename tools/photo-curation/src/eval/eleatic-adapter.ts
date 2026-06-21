// ─────────────────────────────────────────────────────────────────────────────
// The SINGLE domain seam between photo-curation's photo-judge eval and the
// generic eleatic store (E7, #1150).
//
// This is the ONLY file in tools/photo-curation that imports @eleatic/eval.
// It owns the photo-judge's domain vocabulary (`EvalResultRecord` /
// `EvalRunRecord`, defined below) and maps it onto eleatic's generic three-table
// records, reading them back for the analyzer. Keeping both the vocabulary and
// the import here means eleatic stays zero-`@bird-watch`-coupled and the
// runner/analyzer only ever speak the photo-judge vocabulary. (The bespoke
// review-store these records once also fed — src/eval/store.ts — was retired in
// E8, #1151, when eleatic became the SOLE eval store; the eleatic `eval.sqlite`
// is now the only place a run is written or read.)
//
// UNIT CONTRACT (#1094, load-bearing for the #1095 gate): `agreement` and
// `scoreMae` are stored as the SAME 0–1 FRACTIONS the runner computes — 0.8 must
// NOT become 80. PHOTO_JUDGE_GATE reads `agreement` as a fraction (>= 0.90).
//
// exactOptionalPropertyTypes: every omittable eleatic field (imageUrl,
// contentHash, output.criteria) is left ABSENT when its source is missing —
// never assigned `undefined` on a required key.
// ─────────────────────────────────────────────────────────────────────────────

import { openStore, makeReader } from '@eleatic/eval';
import type { EvalRowRecord, EvalRunRecord as EleaticRunRecord, EleaticStore } from '@eleatic/eval';
import type { CriteriaScores, JudgeOutput } from '@bird-watch/photo-quality';

/**
 * One eval RUN's record — the photo-judge domain vocabulary the runner produces
 * and this seam maps onto an eleatic run header. `agreement` and `scoreMae` are
 * 0–1 FRACTIONS (the #1094 unit contract — the mean of the per-row scores, NOT a
 * percent), so the gate reads them directly. `totalCost` is the summed estimated
 * USD across priced judgments.
 */
export interface EvalRunRecord {
  id: string;
  model: string;
  baselineModel: string;
  baselineRubric: string;
  sampleSize: number;
  startedAt: string;
  agreement: number;
  falseKeep: number;
  falseReplace: number;
  scoreMae: number;
  totalCost: number;
}

/**
 * One JUDGMENT's record: the candidate (`gemini*`) decision joined with the
 * Opus baseline (`opus*`) and per-call token/cost metrics. `cost` /
 * `promptTokens` / `completionTokens` are `undefined` for an unpriced or
 * usage-less judgment; `geminiCriteriaJson` is `null` when the candidate carried
 * no per-axis sub-scores.
 *
 * The judge "why" (#1167, trace Tier 1) — `rationale` / `fieldMarks` / `flags`,
 * the candidate `JudgeOutput`'s reasoning — rides through to `output_json` so the
 * eleatic drawer can render it. All three are OPTIONAL: a deterministic-gate
 * pre-reject (no judge ran) carries none, and the runner omits a field entirely
 * when the source output lacked it (exactOptionalPropertyTypes — never
 * `undefined` on the key). An EMPTY `fieldMarks`/`flags` array (the judge ran but
 * named none) is distinct from ABSENT and is preserved.
 */
export interface EvalResultRecord {
  runId: string;
  speciesCode: string;
  comName: string;
  contentHash: string;
  sourceUrl: string;
  geminiKeep: boolean;
  geminiQuality: number;
  geminiCriteriaJson: string | null;
  rationale?: string;
  fieldMarks?: string[];
  flags?: string[];
  opusKeep: boolean;
  opusQuality: number;
  cost: number | undefined;
  promptTokens: number | undefined;
  completionTokens: number | undefined;
}

/**
 * The full per-judgment framing the runner assembles to build one trace span
 * (#1168, trace T3). It is the UNION of three sources that no single existing
 * record carries: the species/model/rubric framing (`JudgmentRecord.input`),
 * the runner-scope rubric `prompt` (on neither record), and the per-call
 * latency / raw response / parsed output / usage (`JudgmentRecord`). The runner
 * is the only place all three meet, so the span is built there from this input.
 *
 * exactOptionalPropertyTypes: every optional source is declared `?` and OMITTED
 * (never `undefined`) — `imageUrl` for an image with no portable URL, `raw` for
 * an absent raw response, and each of `promptTokens`/`completionTokens`/`costUsd`
 * for a usage-less or unpriced judgment. `latencyMs` is always present.
 */
export interface JudgeTraceInput {
  /** The rubric prompt the runner handed the judge (runner-scope only). */
  prompt: string;
  /** The portable R2 provenance URL (the row's `imageUrl`, NOT the local readPath). */
  imageUrl?: string;
  comName: string;
  sciName: string;
  family: string;
  /** The rubric version the judge was invoked with. */
  rubricVersion: string;
  /** The judge model id. */
  model: string;
  /** The full parsed JudgeOutput (fieldMarks/criteria/flags/keep/qualityScore/rationale). */
  parsed: JudgeOutput;
  /** The model's RAW reply (the Gemini envelope); absent when none was captured. */
  raw?: unknown;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs: number;
  costUsd?: number;
}

/**
 * One scorer rendered as a child span of the `task` span (T2, #1187). The name
 * is a scorers.ts column name ('keep_agreement'|'score_mae'|'keep_confusion'|
 * 'criteria_mae_<axis>'). A score-bearing scorer carries `score` → span.scores[
 * name]; a detail-only scorer (keep_confusion) carries `detail` → span.output
 * and NO scores bar (Decision 1 locked). This is the ONLY place the photo-judge
 * scorer vocabulary touches a trace — eleatic stays domain-agnostic.
 */
export interface ScorerSpanInput {
  /** A scorers.ts column name; becomes the span's `name` and (if scored) its scores key. */
  name: string;
  /** The scorer's numeric score → `span.scores[name]`; OMIT for a detail-only scorer. */
  score?: number;
  /** Free-form detail (e.g. {falseKeep,falseReplace}) → `span.output`; OMIT when none. */
  detail?: Record<string, number>;
}

/**
 * Build the generic eleatic trace blob for one judgment as a span TREE (T2,
 * #1187 — the producer side of Decision 1). Same `{ spans:[...] }` envelope as
 * before, now an eval→task→judge spine plus one child span per scorer:
 *
 *   eval   { id:'eval',  parentId:null,   name:'eval', kind:'eval' }   — NO usage/metrics
 *   task   { id:'task',  parentId:'eval', name:'task', kind:'task' }   — NO usage/metrics
 *   judge  { id:'judge', parentId:'task', name:'judge', kind:'llm', input, output, usage }
 *          ← TODAY's span content VERBATIM (nested input.species, output.{parsed,raw?},
 *            usage.{latencyMs,promptTokens?,…}); the ONLY span carrying usage.
 *   scorer { id:'scorer:'+name, parentId:'task', name, kind:'scorer',
 *            scores?:{[name]:score}, output?:detail }                  — NO usage/metrics
 *
 * CONVENTION PINNED (rollup correctness, T5): tokens/cost live ONLY on the judge
 * leaf so the future per-trace rollup can't double-count — eval/task/scorer
 * carry NO usage/metrics. ids are ROW-LOCAL string constants (each row's
 * trace_json is independent). Absent optional fields on the judge leaf are
 * omitted entirely (exactOptionalPropertyTypes); a scored scorer carries `scores`
 * and no `output`, a detail-only scorer carries `output` and no `scores`.
 * Returned as an OPAQUE blob (eleatic never destructures it).
 */
export function buildTrace(t: JudgeTraceInput, scorers?: ScorerSpanInput[]): unknown {
  const input: Record<string, unknown> = {
    prompt: t.prompt,
    species: { comName: t.comName, sciName: t.sciName, family: t.family },
    rubricVersion: t.rubricVersion,
    model: t.model,
  };
  if (t.imageUrl !== undefined) input.imageUrl = t.imageUrl;

  const output: Record<string, unknown> = { parsed: t.parsed };
  if (t.raw !== undefined) output.raw = t.raw;

  // latencyMs is always present; the token/cost fields are omitted when absent.
  // The judge leaf is the ONLY span carrying usage (pinned for rollup correctness).
  const usage: Record<string, number> = { latencyMs: t.latencyMs };
  if (t.promptTokens !== undefined) usage.promptTokens = t.promptTokens;
  if (t.completionTokens !== undefined) usage.completionTokens = t.completionTokens;
  if (t.costUsd !== undefined) usage.costUsd = t.costUsd;

  const spans: Record<string, unknown>[] = [
    { id: 'eval', parentId: null, name: 'eval', kind: 'eval' },
    { id: 'task', parentId: 'eval', name: 'task', kind: 'task' },
    { id: 'judge', parentId: 'task', name: 'judge', kind: 'llm', input, output, usage },
  ];

  for (const s of scorers ?? []) {
    const span: Record<string, unknown> = {
      id: `scorer:${s.name}`,
      parentId: 'task',
      name: s.name,
      kind: 'scorer',
    };
    // A scored scorer carries its score; a detail-only scorer (keep_confusion)
    // carries its detail as output and NO scores bar (Decision 1 locked).
    if (s.score !== undefined) span.scores = { [s.name]: s.score };
    if (s.detail !== undefined) span.output = s.detail;
    spans.push(span);
  }

  return { spans };
}

/**
 * Thin alias: the eval→task→judge spine with NO scorer leaves (T2, #1187,
 * Decision 3). A single judge call still renders the full spine — there is no
 * special-case for the trivial row. Callers that have no scorer vocabulary
 * (the adapter unit tests, any future producer) get the structural tree.
 */
export const buildTraceSpan = (t: JudgeTraceInput): unknown => buildTrace(t, []);

// Re-export the eleatic LIFECYCLE surface the runner + analyzer need, so this
// adapter stays the SINGLE file in tools/photo-curation that imports
// `@eleatic/eval` (#1150). The scripts open/read the store through here,
// never reaching into the package directly — the one-seam rule keeps the
// photo-judge↔eleatic coupling auditable in one place.
export { openStore, makeReader };
export type { EleaticStore };

/**
 * The eleatic gate for the photo-judge eval: keep-agreement at or above 0.90,
 * read as a 0–1 fraction (NOT a percent). Mirrors the #1095 `>= 0.90` gate; the
 * E4 server / E6 UI read this metric/op/threshold directly off the stored run.
 */
export const PHOTO_JUDGE_GATE = { metric: 'agreement', op: 'gte', threshold: 0.9 } as const;

/** The disagreement cell a row falls into, used as a categorical facet axis. */
export type Disagreement = 'agree' | 'falseKeep' | 'falseReplace';

/**
 * The candidate (Gemini) decision blob embedded as `output_json`. `criteria` is
 * the PARSED per-axis sub-scores object (the source `geminiCriteriaJson` is an
 * already-serialized string — it is `JSON.parse`d here, never double-encoded),
 * omitted entirely when the source was null.
 *
 * The judge "why" (#1167) — `rationale` / `fieldMarks` / `flags` — rides along so
 * the eleatic drawer's Output panel can show the candidate's reasoning. Each is
 * omitted entirely when its source field was absent (exactOptional); an EMPTY
 * `fieldMarks`/`flags` array is preserved (present-but-empty ≠ absent).
 */
interface OutputBlob {
  keep: boolean;
  qualityScore: number;
  criteria?: CriteriaScores;
  rationale?: string;
  fieldMarks?: string[];
  flags?: string[];
}

/** The Opus baseline decision blob embedded as `expected_json`. */
interface ExpectedBlob {
  keep: boolean;
  qualityScore: number;
  criteria?: CriteriaScores;
}

/**
 * The four values the analyzer's dataset-level diagnostics need, projected back
 * out of an eleatic row. Structurally identical to the analyzer's own
 * `AnalysisRow` (scripts/analyze-experiment.ts) — kept here so the adapter (a
 * `src/**` build target) does not import from `scripts/**` (outside rootDir).
 */
export interface AnalysisRow {
  outputKeep: boolean;
  outputScore: number;
  expectedKeep: boolean;
  expectedScore: number;
}

/** Classify a row into its keep-disagreement cell (gemini vs. opus). */
function disagreementOf(geminiKeep: boolean, opusKeep: boolean): Disagreement {
  if (geminiKeep && !opusKeep) return 'falseKeep';
  if (!geminiKeep && opusKeep) return 'falseReplace';
  return 'agree';
}

/** Parse the (already-serialized) criteria JSON, null-guarded → `undefined`. */
function parseCriteria(json: string | null): CriteriaScores | undefined {
  if (json === null) return undefined;
  return JSON.parse(json) as CriteriaScores;
}

/**
 * Map one photo-judge judgment onto an eleatic `EvalRowRecord`.
 *   - row_key = speciesCode, label = comName, image_url = sourceUrl (omitted
 *     when empty), content_hash = contentHash (omitted when empty).
 *   - output_json = {keep, qualityScore, criteria?, rationale?, fieldMarks?,
 *     flags?} — criteria PARSED, the judge "why" (#1167) copied through when the
 *     source carried it (absent key when it did not; empty arrays preserved).
 *   - expected_json = {keep, qualityScore} (the baseline carries no criteria).
 *   - scores_json = {outputQuality, expectedQuality} (numeric facet axes).
 *   - metadata_json = {disagreement} (the categorical facet axis).
 *   - trace_json = the optional per-judgment trace span (#1168, trace T3) when
 *     the caller passes one; the key is ABSENT otherwise (T1/T2 callers pass no
 *     trace and the row carries none). The trace is OPAQUE here — built by
 *     {@link buildTraceSpan} in the runner (the only scope with prompt + record)
 *     and forwarded to eleatic's `recordRow` verbatim.
 */
export function toEleaticRow(r: EvalResultRecord, trace?: unknown): EvalRowRecord {
  const output: OutputBlob = { keep: r.geminiKeep, qualityScore: r.geminiQuality };
  const criteria = parseCriteria(r.geminiCriteriaJson);
  if (criteria !== undefined) output.criteria = criteria;
  // The judge "why" (#1167) — copied through ONLY when present, so the key is
  // ABSENT (not `undefined`) for a deterministic-gate pre-reject or any output
  // that lacked it (exactOptionalPropertyTypes). An EMPTY array is present-but-
  // empty (the judge ran, named none) and is preserved verbatim.
  if (r.rationale !== undefined) output.rationale = r.rationale;
  if (r.fieldMarks !== undefined) output.fieldMarks = r.fieldMarks;
  if (r.flags !== undefined) output.flags = r.flags;

  const expected: ExpectedBlob = { keep: r.opusKeep, qualityScore: r.opusQuality };

  // Numeric facet axes. `cost` is an axis too (the analyzer's #1088 cost block
  // reads it back) — present for a priced judgment, ABSENT for an unpriced one
  // (cost `undefined` → omitted key, mirroring the review store's NULL).
  const scores: Record<string, number> = {
    outputQuality: r.geminiQuality,
    expectedQuality: r.opusQuality,
  };
  if (r.cost !== undefined) scores.cost = r.cost;

  const row: EvalRowRecord = {
    runId: r.runId,
    rowKey: r.speciesCode,
    label: r.comName,
    output,
    expected,
    scores,
    metadata: { disagreement: disagreementOf(r.geminiKeep, r.opusKeep) },
  };
  // exactOptionalPropertyTypes: leave the optional keys ABSENT (not `undefined`)
  // when their source is missing, so the store coerces them to a column NULL.
  if (r.sourceUrl !== '') row.imageUrl = r.sourceUrl;
  if (r.contentHash !== '') row.contentHash = r.contentHash;
  // The per-judgment trace (#1168, trace T3) rides through to trace_json when
  // the runner passes one — absent key otherwise (exactOptional), so the store
  // writes a column NULL and getRow reads it back as an absent `trace`.
  if (trace !== undefined) row.trace = trace;
  return row;
}

/**
 * Map the photo-judge run aggregate onto an eleatic `EvalRunRecord`.
 *   - label = model, baseline = baselineModel.
 *   - config = {baselineModel, baselineRubric, sampleSize}.
 *   - metrics = {agreement, falseKeep, falseReplace, scoreMae, totalCost} — the
 *     SAME 0–1 fractions the runner computed (agreement/scoreMae are NOT scaled
 *     to percents; #1094 unit contract).
 */
export function toEleaticRun(run: EvalRunRecord): EleaticRunRecord {
  return {
    id: run.id,
    label: run.model,
    baseline: run.baselineModel,
    startedAt: run.startedAt,
    config: {
      baselineModel: run.baselineModel,
      baselineRubric: run.baselineRubric,
      sampleSize: run.sampleSize,
    },
    metrics: {
      agreement: run.agreement,
      falseKeep: run.falseKeep,
      falseReplace: run.falseReplace,
      scoreMae: run.scoreMae,
      totalCost: run.totalCost,
    },
  };
}

/**
 * Project a stored eleatic row back to the analyzer's `AnalysisRow`. Reads the
 * candidate/baseline keep + qualityScore from the row's `output_json` /
 * `expected_json` blobs (written by {@link toEleaticRow}).
 */
export function fromEleaticRow(row: EvalRowRecord): AnalysisRow {
  const output = row.output as OutputBlob;
  const expected = row.expected as ExpectedBlob;
  return {
    outputKeep: output.keep,
    outputScore: output.qualityScore,
    expectedKeep: expected.keep,
    expectedScore: expected.qualityScore,
  };
}

/**
 * One judgment's cost, structurally identical to the analyzer's `CostRow`
 * (scripts/analyze-experiment.ts). `estimatedCost` is the priced USD figure or
 * `undefined` for an unpriced judgment — kept here so the adapter (a `src/**`
 * build target) does not import from `scripts/**`.
 */
export interface CostRow {
  estimatedCost: number | undefined;
}

/**
 * Project a stored eleatic row back to the analyzer's `CostRow` (#1088). Reads
 * the `cost` numeric axis from `scores_json` (written by {@link toEleaticRow}):
 * present → priced, absent → unpriced (`undefined`), mirroring the review
 * store's priced/NULL distinction.
 */
export function costFromEleaticRow(row: EvalRowRecord): CostRow {
  return { estimatedCost: row.scores?.cost };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dataset-level diagnostics for a completed photo-judge experiment (#1067).
//
// Braintrust scorers are strictly PER-ROW, so the threshold-free read (AUC) and
// the calibrated-threshold sweep — which need every row at once — cannot be
// expressed as scorers without lying about the contract. This is a committed,
// repeatable analysis SCRIPT instead: it reads a completed experiment back
// (via `bt sql`, injected so tests need no network), then prints
//
//   - keep agreement                  (boolean keep match rate)
//   - falseKeep / falseReplace counts  (the dangerous vs. cheap disagreements)
//   - score MAE                        (mean |Δ qualityScore|)
//   - AUC                              (Gemini qualityScore ranking Opus keep)
//   - calibrated-threshold ceiling     (best boolean agreement over a score
//                                        sweep + the winning threshold)
//   - ambiguity-band breakdown         (disagreements inside an Opus-score band)
//   - hybrid-routing preview           (route mid-band Gemini scores to Opus →
//                                        % routed, auto-set agreement, residual
//                                        falseKeep)
//
// It is READ-ONLY: no eval run, no Gemini calls, no judging. Run it after a run
// completes:  npm run analyze -w @bird-watch/photo-curation <run-id>.
//
// The math is PURE (the exported helpers below), unit-tested on a hand-built
// fixture with known answers (analyze-experiment.test.ts). The store read is
// injected via `ExperimentReader` / `CostReader` (#1094: both now read the
// local `eval_result` table, no longer `bt sql`), so the tests need no network
// and the CLI glue is the only un-unit-tested surface.
//
// Lives OUTSIDE src/ (the tsconfig rootDir) like the runner, so it is not a tsc
// build target; `tsx` runs it directly.
// ─────────────────────────────────────────────────────────────────────────────

import type Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { readEvalResults } from '../src/eval/store.js';

/**
 * One experiment row reduced to the four values the diagnostics need:
 *   - outputKeep   — the candidate (Gemini) keep decision.
 *   - outputScore  — the candidate qualityScore (0–100): the RANKING signal for
 *                    AUC, the sweep axis for the calibrated threshold, and the
 *                    routing axis for the hybrid preview.
 *   - expectedKeep — the Opus baseline keep (the proxy ground-truth label).
 *   - expectedScore— the Opus qualityScore: the AMBIGUITY-BAND axis (a
 *                    disagreement near Opus's own midpoint is a genuine close
 *                    call worth routing).
 */
export interface AnalysisRow {
  outputKeep: boolean;
  outputScore: number;
  expectedKeep: boolean;
  expectedScore: number;
}

// ── Pure helpers (unit-tested) ───────────────────────────────────────────────

/** Fraction of rows where the candidate and baseline keep decisions match. */
export function keepAgreement(rows: AnalysisRow[]): number {
  if (rows.length === 0) return 0;
  const agree = rows.filter((r) => r.outputKeep === r.expectedKeep).length;
  return agree / rows.length;
}

/**
 * falseKeep = candidate keeps a photo the baseline would replace (the DANGEROUS
 * direction — ships a bad photo). falseReplace = the cheap direction (re-source).
 */
export function confusionCounts(rows: AnalysisRow[]): { falseKeep: number; falseReplace: number } {
  let falseKeep = 0;
  let falseReplace = 0;
  for (const r of rows) {
    if (r.outputKeep && !r.expectedKeep) falseKeep++;
    else if (!r.outputKeep && r.expectedKeep) falseReplace++;
  }
  return { falseKeep, falseReplace };
}

/** Mean absolute error of the candidate vs. baseline qualityScore (0–100 points). */
export function scoreMAE(rows: AnalysisRow[]): number {
  if (rows.length === 0) return 0;
  const sum = rows.reduce((acc, r) => acc + Math.abs(r.outputScore - r.expectedScore), 0);
  return sum / rows.length;
}

/**
 * AUC of the candidate `outputScore` as a ranker of the Opus `keep` label:
 * P(a random Opus-keep row outranks a random Opus-replace row), ties counting
 * as 0.5. Computed by the exhaustive pairwise (Mann–Whitney) definition — O(n²),
 * fine for ≤902 rows and exactly matches the by-hand fixture expectations.
 * Returns `null` when either class is empty (AUC undefined).
 */
export function auc(rows: AnalysisRow[]): number | null {
  const pos = rows.filter((r) => r.expectedKeep).map((r) => r.outputScore);
  const neg = rows.filter((r) => !r.expectedKeep).map((r) => r.outputScore);
  if (pos.length === 0 || neg.length === 0) return null;
  let acc = 0;
  for (const p of pos) {
    for (const n of neg) {
      if (p > n) acc += 1;
      else if (p === n) acc += 0.5;
    }
  }
  return acc / (pos.length * neg.length);
}

/**
 * Calibrated-threshold ceiling: sweep a score threshold `t` and predict
 * keep iff `outputScore >= t`, then measure boolean agreement against the Opus
 * keep label. Returns the best agreement reachable and the winning `t`.
 *
 * Candidate thresholds are the distinct scores plus one just above the max (so
 * "keep nothing" is reachable). The best achievable agreement is the ceiling a
 * recalibrated Gemini-only gate could hit — when it sits well below 1.0 the
 * disagreement is genuine model divergence, not boundary noise.
 */
export function calibratedThreshold(rows: AnalysisRow[]): { bestAgreement: number; threshold: number } {
  if (rows.length === 0) return { bestAgreement: 0, threshold: 0 };
  const scores = rows.map((r) => r.outputScore);
  const max = Math.max(...scores);
  // Candidate cut points: each observed score (predict keep at >= score) plus a
  // sentinel above the max (predict keep for nothing).
  const candidates = Array.from(new Set([...scores, max + 1])).sort((a, b) => a - b);
  let best = { bestAgreement: -1, threshold: candidates[0]! };
  for (const t of candidates) {
    let agree = 0;
    for (const r of rows) {
      const predictedKeep = r.outputScore >= t;
      if (predictedKeep === r.expectedKeep) agree++;
    }
    const agreement = agree / rows.length;
    if (agreement > best.bestAgreement) best = { bestAgreement: agreement, threshold: t };
  }
  return best;
}

/**
 * Ambiguity-band breakdown: of all keep-disagreements, how many sit inside the
 * Opus-score band `[lo, hi]` (inclusive). A disagreement near Opus's own
 * midpoint is a genuine close call (the kind a hybrid would route); a
 * disagreement at the extremes is a real model miss.
 */
export function ambiguityBand(
  rows: AnalysisRow[],
  lo: number,
  hi: number,
): { inBandDisagreements: number; totalDisagreements: number } {
  let inBand = 0;
  let total = 0;
  for (const r of rows) {
    if (r.outputKeep === r.expectedKeep) continue;
    total++;
    if (r.expectedScore >= lo && r.expectedScore <= hi) inBand++;
  }
  return { inBandDisagreements: inBand, totalDisagreements: total };
}

/**
 * Hybrid-routing preview: route any row whose CANDIDATE score lands in the
 * mid-band `[lo, hi]` to Opus (which, being the baseline, decides correctly);
 * outside the band, keep the candidate's own decision. Reports:
 *   - routed / routedFraction — Opus-call budget the hybrid would spend.
 *   - autoSetAgreement        — keep-agreement after routing (routed rows are
 *                               auto-correct; out-of-band rows keep Gemini's call).
 *   - residualFalseKeep       — falseKeeps the hybrid still ships (a dangerous
 *                               Gemini keep whose score fell OUTSIDE the band, so
 *                               it was never re-judged).
 */
export function hybridRouting(
  rows: AnalysisRow[],
  lo: number,
  hi: number,
): { routed: number; routedFraction: number; autoSetAgreement: number; residualFalseKeep: number } {
  if (rows.length === 0) return { routed: 0, routedFraction: 0, autoSetAgreement: 0, residualFalseKeep: 0 };
  let routed = 0;
  let correct = 0;
  let residualFalseKeep = 0;
  for (const r of rows) {
    const inBand = r.outputScore >= lo && r.outputScore <= hi;
    if (inBand) {
      // Routed to Opus → decided correctly by construction (Opus is the label).
      routed++;
      correct++;
    } else {
      // Keep Gemini's decision.
      if (r.outputKeep === r.expectedKeep) correct++;
      else if (r.outputKeep && !r.expectedKeep) residualFalseKeep++;
    }
  }
  return {
    routed,
    routedFraction: routed / rows.length,
    autoSetAgreement: correct / rows.length,
    residualFalseKeep,
  };
}

// ── Cost summary (#1088) ─────────────────────────────────────────────────────

/**
 * One judgment's cost, read from its span's `metrics.estimated_cost` (#1088).
 * `estimatedCost` is the USD figure for a PRICED model, or `undefined` for an
 * UNPRICED one (the span carried token metrics but no `estimated_cost` key, so
 * the model is absent from `MODEL_PRICING`). Kept distinct from a $0 so the
 * total can be flagged known-partial.
 */
export interface CostRow {
  estimatedCost: number | undefined;
}

/**
 * Aggregate the per-judgment costs (#1088). `totalUsd` sums only the priced
 * rows; `meanUsd` averages over the priced rows (an unpriced row has no known
 * cost to average in); `unpricedCount` flags how many judgments are missing a
 * price so a reader knows the total is partial. Empty input → all zeros.
 */
export function summarizeCost(rows: CostRow[]): {
  totalUsd: number;
  meanUsd: number;
  pricedCount: number;
  unpricedCount: number;
} {
  let totalUsd = 0;
  let pricedCount = 0;
  let unpricedCount = 0;
  for (const r of rows) {
    if (r.estimatedCost === undefined) unpricedCount++;
    else {
      totalUsd += r.estimatedCost;
      pricedCount++;
    }
  }
  return { totalUsd, meanUsd: pricedCount === 0 ? 0 : totalUsd / pricedCount, pricedCount, unpricedCount };
}

export type CostSummary = ReturnType<typeof summarizeCost>;

/** Tunable band edges for the ambiguity + hybrid-routing analysis. */
export interface AnalysisOptions {
  /** Lower edge of the ambiguity / routing band (inclusive). */
  bandLo: number;
  /** Upper edge of the ambiguity / routing band (inclusive). */
  bandHi: number;
}

/** The full dataset-level diagnostic, aggregated from the experiment rows. */
export interface Analysis {
  n: number;
  keepAgreement: number;
  confusion: { falseKeep: number; falseReplace: number };
  scoreMAE: number;
  auc: number | null;
  calibrated: { bestAgreement: number; threshold: number };
  band: { lo: number; hi: number; inBandDisagreements: number; totalDisagreements: number };
  hybrid: { routed: number; routedFraction: number; autoSetAgreement: number; residualFalseKeep: number };
}

/** Compose every pure helper into one Analysis over the rows. */
export function analyze(rows: AnalysisRow[], opts: AnalysisOptions): Analysis {
  const band = ambiguityBand(rows, opts.bandLo, opts.bandHi);
  return {
    n: rows.length,
    keepAgreement: keepAgreement(rows),
    confusion: confusionCounts(rows),
    scoreMAE: scoreMAE(rows),
    auc: auc(rows),
    calibrated: calibratedThreshold(rows),
    band: { lo: opts.bandLo, hi: opts.bandHi, ...band },
    hybrid: hybridRouting(rows, opts.bandLo, opts.bandHi),
  };
}

const pct = (x: number): string => `${(x * 100).toFixed(2)}%`;
const usd = (x: number): string => `$${x.toFixed(2)}`;

/**
 * Render the cost block (#1088): total + mean estimated USD across judgment
 * spans, plus the unpriced count when any judgment lacked a price (so the total
 * is flagged known-partial, never silently understated).
 */
function formatCostBlock(c: CostSummary): string[] {
  const lines = [
    `estimated cost (#1088)`,
    `  total cost        ${usd(c.totalUsd)}  (sum of metrics.estimated_cost over ${c.pricedCount} priced judgments)`,
    `  mean / judgment   ${usd(c.meanUsd)}`,
  ];
  if (c.unpricedCount > 0) {
    lines.push(
      `  unpriced          ${c.unpricedCount}  (no price in MODEL_PRICING — TOTAL IS PARTIAL; add the model to src/judges/pricing.ts)`,
    );
  }
  return ['', ...lines];
}

/** Render the analysis as a human-readable report block. */
export function formatReport(experiment: string, a: Analysis, cost?: CostSummary): string {
  const aucStr = a.auc === null ? 'n/a (a keep class is empty)' : a.auc.toFixed(3);
  return [
    `Experiment: ${experiment}  (${a.n} rows)`,
    ``,
    `keep agreement      ${pct(a.keepAgreement)}`,
    `  falseKeep         ${a.confusion.falseKeep}   (Gemini keeps what Opus would replace — ships a bad photo)`,
    `  falseReplace      ${a.confusion.falseReplace}   (Gemini replaces what Opus would keep — cheap, re-source)`,
    `score MAE           ${a.scoreMAE.toFixed(2)} points`,
    `AUC                 ${aucStr}   (Gemini qualityScore ranking Opus keep)`,
    `calibrated ceiling  ${pct(a.calibrated.bestAgreement)} at score >= ${a.calibrated.threshold}`,
    `                    (best boolean agreement a recalibrated Gemini-only threshold could reach)`,
    ``,
    `ambiguity band [${a.band.lo}, ${a.band.hi}] (Opus score)`,
    `  in-band disagreements   ${a.band.inBandDisagreements} of ${a.band.totalDisagreements} total`,
    ``,
    `hybrid routing preview (route mid-band Gemini scores [${a.band.lo}, ${a.band.hi}] to Opus)`,
    `  routed            ${a.hybrid.routed}  (${pct(a.hybrid.routedFraction)} of rows → Opus re-judge)`,
    `  auto-set agreement ${pct(a.hybrid.autoSetAgreement)}  (keep agreement after routing)`,
    `  residual falseKeep ${a.hybrid.residualFalseKeep}  (dangerous keeps that fell outside the band)`,
    ...(cost ? formatCostBlock(cost) : []),
  ].join('\n');
}

// ── Store read (injected; not unit-tested at the CLI seam) ───────────────────

/**
 * Reads a completed run's rows back. A function TYPE, not a class interface —
 * the CLI injects `makeSqliteReader(db)` (#1094); tests inject a plain async
 * function returning fixture rows. `experiment` is the run id (eval_run.id).
 */
export type ExperimentReader = (experiment: string) => Promise<AnalysisRow[]>;

/** A `scores`/`output`/`expected` row as `bt sql` returns it (loosely typed). */
interface RawRow {
  output?: { keep?: unknown; qualityScore?: unknown } | null;
  expected?: { keep?: unknown; qualityScore?: unknown } | null;
}

/** A judgment span's `metrics` as `bt sql` returns it (#1088, loosely typed). */
interface RawMetricsRow {
  metrics?: { prompt_tokens?: unknown; completion_tokens?: unknown; estimated_cost?: unknown } | null;
}

function toNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Project the loosely-typed `bt sql` rows onto `AnalysisRow`, dropping any row
 * missing a keep flag or a numeric score on either side (root spans only carry
 * output/expected; nested judgment spans don't, so they are filtered out).
 * Exported for a focused unit test of the projection without a live read.
 */
export function projectRows(raw: RawRow[]): AnalysisRow[] {
  const out: AnalysisRow[] = [];
  for (const r of raw) {
    const outputKeep = r.output?.keep;
    const expectedKeep = r.expected?.keep;
    const outputScore = toNumber(r.output?.qualityScore);
    const expectedScore = toNumber(r.expected?.qualityScore);
    if (
      typeof outputKeep === 'boolean' &&
      typeof expectedKeep === 'boolean' &&
      outputScore !== undefined &&
      expectedScore !== undefined
    ) {
      out.push({ outputKeep, outputScore, expectedKeep, expectedScore });
    }
  }
  return out;
}

/**
 * Project loosely-typed `bt sql` metrics rows onto `CostRow` (#1088). A span
 * carrying token metrics (`prompt_tokens`) IS a judgment; its `estimated_cost`
 * is present (priced) or absent (unpriced → `undefined`). Spans with no token
 * metrics (the experiment root spans, which carry output/expected but no
 * per-call token counts) are NOT judgments and are dropped, so the cost total
 * counts each judgment once. Exported for a focused unit test without a read.
 */
export function projectCostRows(raw: RawMetricsRow[]): CostRow[] {
  const out: CostRow[] = [];
  for (const r of raw) {
    const m = r.metrics;
    if (m === null || m === undefined) continue;
    // A judgment span is identified by token metrics; without them the row is a
    // root span (or a non-judgment span) and carries no per-call cost.
    if (typeof m.prompt_tokens !== 'number') continue;
    out.push({ estimatedCost: toNumber(m.estimated_cost) });
  }
  return out;
}

/** Reads a completed run's judgment costs back (#1088). A function TYPE; injected. */
export type CostReader = (experiment: string) => Promise<CostRow[]>;

/**
 * Build the local-store reader (#1094): reads the run's `eval_result` rows from
 * SQLite and projects them onto `AnalysisRow` (the candidate `gemini_*` decision
 * vs. the Opus `opus_*` baseline). Replaces the old `bt sql` shell-out — the
 * store is local, so there is no network and no `bt` CLI dependency. A FACTORY
 * over the open db so the CLI wires `openDb(REVIEW_DB)` while tests inject an
 * in-memory db. Returns a plain `ExperimentReader` function (`experiment` = run id).
 */
export function makeSqliteReader(db: Database.Database): ExperimentReader {
  return async (runId) =>
    readEvalResults(db, runId).map((r) => ({
      outputKeep: r.geminiKeep,
      outputScore: r.geminiQuality,
      expectedKeep: r.opusKeep,
      expectedScore: r.opusQuality,
    }));
}

/**
 * Build the local-store cost reader (#1094): reads the run's `eval_result.cost`
 * back and projects each row onto `CostRow` — a priced judgment carries a number,
 * an unpriced one carries `undefined` (stored NULL). Replaces the old `bt sql`
 * metrics read; same FACTORY-over-db shape as {@link makeSqliteReader} so the
 * cost block + `eval_run.total_cost` have a local source. `summarizeCost` then
 * prints the total/mean/unpriced lines.
 */
export function makeSqliteCostReader(db: Database.Database): CostReader {
  return async (runId) =>
    readEvalResults(db, runId).map((r) => ({ estimatedCost: r.cost }));
}

/** Parse `--band lo:hi` (default 40:70) from argv; everything else is the exp name. */
function parseArgs(argv: string[]): { experiment: string | undefined; bandLo: number; bandHi: number } {
  let bandLo = 40;
  let bandHi = 70;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--band' && argv[i + 1]) {
      const [lo, hi] = argv[++i]!.split(':').map(Number);
      if (Number.isFinite(lo)) bandLo = lo!;
      if (Number.isFinite(hi)) bandHi = hi!;
    } else {
      positional.push(argv[i]!);
    }
  }
  return { experiment: positional[0], bandLo, bandHi };
}

/**
 * CLI entry. `reader` is injected (no default — the direct CLI run wires
 * `makeSqliteReader(db)`, #1094; tests inject a fixture function). `costReader`
 * is optional and injectable (#1088): when supplied (the direct CLI run wires
 * `makeSqliteCostReader(db)`), the report gains the total/mean/unpriced cost
 * block; when omitted (unit tests of the no-cost path), the cost read is skipped
 * entirely so `main` stays network-free. `experiment` is the run id (eval_run.id).
 */
export async function main(
  argv: string[],
  reader: ExperimentReader,
  costReader?: CostReader,
): Promise<number> {
  const { experiment, bandLo, bandHi } = parseArgs(argv);
  if (!experiment) {
    console.error('usage: analyze-experiment <run-id> [--band lo:hi]');
    return 2;
  }
  const rows = await reader(experiment);
  if (rows.length === 0) {
    console.error(`No usable rows read from run '${experiment}' (is the run id correct, and did the run write eval_result rows?).`);
    return 1;
  }
  const cost = costReader ? summarizeCost(await costReader(experiment)) : undefined;
  console.log(formatReport(experiment, analyze(rows, { bandLo, bandHi }), cost));
  return 0;
}

// Run only when invoked directly (tsx scripts/analyze-experiment.ts …), never on import.
// REVIEW_DB is the local review store the runner wrote eval_result/eval_run to.
if (import.meta.url === `file://${process.argv[1]}`) {
  const reviewDb = process.env.REVIEW_DB;
  if (!reviewDb) {
    console.error('REVIEW_DB is required (the local review.sqlite the run wrote to)');
    process.exit(2);
  }
  const db = openDb(reviewDb);
  main(process.argv.slice(2), makeSqliteReader(db), makeSqliteCostReader(db))
    .then((code) => {
      db.close();
      process.exit(code);
    })
    .catch((err: unknown) => {
      db.close();
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}

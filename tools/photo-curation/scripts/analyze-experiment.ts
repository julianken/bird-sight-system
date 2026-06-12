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
// It is READ-ONLY: no eval run, no Gemini calls, no judging. Run it after an
// experiment completes:  npm run analyze -w @bird-watch/photo-curation <exp>.
//
// The math is PURE (the exported helpers below), unit-tested on a hand-built
// fixture with known answers (analyze-experiment.test.ts). The Braintrust read
// is injected via `ExperimentReader`, so the tests need no network and the CLI
// glue is the only un-unit-tested surface (mirrors eval/photo-judge.eval.ts).
//
// Lives OUTSIDE src/ (the tsconfig rootDir) like the eval entry, so it is not a
// tsc build target; `tsx` runs it directly.
// ─────────────────────────────────────────────────────────────────────────────

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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

/** Render the analysis as a human-readable report block. */
export function formatReport(experiment: string, a: Analysis): string {
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
  ].join('\n');
}

// ── Braintrust read (injected; not unit-tested) ──────────────────────────────

/** Reads a completed experiment's rows back. Injected so tests need no network. */
export type ExperimentReader = (experiment: string) => Promise<AnalysisRow[]>;

/** A `scores`/`output`/`expected` row as `bt sql` returns it (loosely typed). */
interface RawRow {
  output?: { keep?: unknown; qualityScore?: unknown } | null;
  expected?: { keep?: unknown; qualityScore?: unknown } | null;
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
 * The default reader: `bt sql "SELECT output, expected FROM experiment('<exp>')"`
 * as JSON, projected onto `AnalysisRow`. Shells out to the Braintrust CLI (auth
 * resolves from the active `bt` profile), so it is operator-run, never in CI.
 */
const btSqlReader: ExperimentReader = async (experiment) => {
  const query = `SELECT output, expected FROM experiment('${experiment}')`;
  const { stdout } = await execFileAsync('bt', ['sql', '--json', query], {
    maxBuffer: 64 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout) as unknown;
  const rows: RawRow[] = Array.isArray(parsed)
    ? (parsed as RawRow[])
    : ((parsed as { data?: RawRow[] }).data ?? []);
  return projectRows(rows);
};

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

/** CLI entry. `reader` is injectable; defaults to the `bt sql` reader. */
export async function main(argv: string[], reader: ExperimentReader = btSqlReader): Promise<number> {
  const { experiment, bandLo, bandHi } = parseArgs(argv);
  if (!experiment) {
    console.error('usage: analyze-experiment <experiment-name-or-id> [--band lo:hi]');
    return 2;
  }
  const rows = await reader(experiment);
  if (rows.length === 0) {
    console.error(`No usable rows read from experiment '${experiment}' (is it complete, and does it carry output/expected keep + qualityScore?).`);
    return 1;
  }
  console.log(formatReport(experiment, analyze(rows, { bandLo, bandHi })));
  return 0;
}

// Run only when invoked directly (tsx scripts/analyze-experiment.ts …), never on import.
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}

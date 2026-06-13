// ─────────────────────────────────────────────────────────────────────────────
// Generic, domain-free dataset-level diagnostics for a completed eval run.
//
// Ported VERBATIM IN MATH from tools/photo-curation/scripts/analyze-experiment.ts
// (#1067), but rewritten over a domain-free row shape: the photo-judge "keep"
// decision becomes a generic boolean `label`, and the confusion-matrix axes are
// renamed to the domain-free `falsePositive` / `falseNegative`. The threshold-free
// read (AUC) and the calibrated-threshold sweep need every row at once, so they
// live here as committed, repeatable PURE functions rather than per-row scorers.
//
// This module is PURE: no SQLite, no better-sqlite3, no store import, no I/O, no
// network, and ZERO `@bird-watch/*` imports (the one-way dependency contract that
// lets the package `git mv` to its own repo later). The store→analysis projection
// lives in `projectForAnalysis`, fed by a consumer-supplied selector — eleatic
// never hard-codes where in output_json / expected_json / scores_json each axis
// lives. The consumer (e.g. the photo-curation adapter) owns that mapping.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One eval row reduced to the four values the diagnostics need, in domain-free
 * terms. `label` is the boolean class (the photo-judge "keep" decision maps here);
 * `score` is the numeric ranking / sweep / band axis (the photo-judge qualityScore).
 *   - outputLabel   — the candidate model's boolean class decision.
 *   - outputScore   — the candidate's numeric score: the RANKING signal for AUC,
 *                     the sweep axis for the calibrated threshold, the routing axis.
 *   - expectedLabel — the baseline (proxy ground-truth) boolean class.
 *   - expectedScore — the baseline's numeric score: the AMBIGUITY-BAND axis.
 */
export interface AnalysisRow {
  outputLabel: boolean;
  outputScore: number;
  expectedLabel: boolean;
  expectedScore: number;
}

// ── Pure helpers (unit-tested) ───────────────────────────────────────────────

/** Fraction of rows where the candidate and baseline label decisions match. Empty → 0. */
export function labelAgreement(rows: AnalysisRow[]): number {
  if (rows.length === 0) return 0;
  const agree = rows.filter((r) => r.outputLabel === r.expectedLabel).length;
  return agree / rows.length;
}

/**
 * Confusion-matrix counts in domain-free terms:
 *   falsePositive = output is `true`, expected is `false` (the photo-judge
 *                   "falseKeep" — the dangerous direction).
 *   falseNegative = output is `false`, expected is `true` (the photo-judge
 *                   "falseReplace" — the cheap direction).
 */
export function confusionCounts(rows: AnalysisRow[]): { falsePositive: number; falseNegative: number } {
  let falsePositive = 0;
  let falseNegative = 0;
  for (const r of rows) {
    if (r.outputLabel && !r.expectedLabel) falsePositive++;
    else if (!r.outputLabel && r.expectedLabel) falseNegative++;
  }
  return { falsePositive, falseNegative };
}

/** Mean absolute error of the candidate vs. baseline score. Empty → 0. */
export function scoreMAE(rows: AnalysisRow[]): number {
  if (rows.length === 0) return 0;
  const sum = rows.reduce((acc, r) => acc + Math.abs(r.outputScore - r.expectedScore), 0);
  return sum / rows.length;
}

/**
 * AUC of the candidate `outputScore` as a ranker of the baseline `label`:
 * P(a random expected-true row outranks a random expected-false row), ties
 * counting as 0.5. Computed by the exhaustive pairwise (Mann–Whitney) definition
 * — O(n²), fine at ≤~1000 rows and exactly matching the by-hand fixture.
 * Returns `null` when either class is empty (AUC undefined).
 */
export function auc(rows: AnalysisRow[]): number | null {
  const pos = rows.filter((r) => r.expectedLabel).map((r) => r.outputScore);
  const neg = rows.filter((r) => !r.expectedLabel).map((r) => r.outputScore);
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
 * label iff `outputScore >= t`, then measure boolean agreement against the
 * baseline label. Returns the best agreement reachable and the winning `t`.
 *
 * Candidate thresholds are the distinct scores plus one just above the max (so
 * "label nothing" is reachable). The best achievable agreement is the ceiling a
 * recalibrated score-only gate could hit — when it sits well below 1.0 the
 * disagreement is genuine model divergence, not boundary noise. Empty →
 * `{ bestAgreement: 0, threshold: 0 }`.
 */
export function calibratedThreshold(rows: AnalysisRow[]): { bestAgreement: number; threshold: number } {
  if (rows.length === 0) return { bestAgreement: 0, threshold: 0 };
  const scores = rows.map((r) => r.outputScore);
  const max = Math.max(...scores);
  // Candidate cut points: each observed score (predict label at >= score) plus a
  // sentinel above the max (predict label for nothing).
  const candidates = Array.from(new Set([...scores, max + 1])).sort((a, b) => a - b);
  let best = { bestAgreement: -1, threshold: candidates[0]! };
  for (const t of candidates) {
    let agree = 0;
    for (const r of rows) {
      const predictedLabel = r.outputScore >= t;
      if (predictedLabel === r.expectedLabel) agree++;
    }
    const agreement = agree / rows.length;
    if (agreement > best.bestAgreement) best = { bestAgreement: agreement, threshold: t };
  }
  return best;
}

/**
 * Ambiguity-band breakdown: of all label-disagreements, how many sit inside the
 * baseline-score band `[lo, hi]` (inclusive). A disagreement near the baseline's
 * own midpoint is a genuine close call (the kind a hybrid would route); a
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
    if (r.outputLabel === r.expectedLabel) continue;
    total++;
    if (r.expectedScore >= lo && r.expectedScore <= hi) inBand++;
  }
  return { inBandDisagreements: inBand, totalDisagreements: total };
}

/**
 * Hybrid-routing preview: route any row whose CANDIDATE score lands in the
 * mid-band `[lo, hi]` to the baseline (which, being the proxy ground truth,
 * decides correctly); outside the band, keep the candidate's own decision.
 * Reports:
 *   - routed / routedFraction — baseline-call budget the hybrid would spend.
 *   - autoSetAgreement        — label-agreement after routing (routed rows are
 *                               auto-correct; out-of-band rows keep the candidate).
 *   - residualFalseKeep       — falseKeeps the hybrid still ships (a dangerous
 *                               candidate-true call whose score fell OUTSIDE the
 *                               band, so it was never re-judged). NOTE: this is a
 *                               routing-RESIDUAL count, distinct from the
 *                               `confusionCounts` axis — so it keeps the ported
 *                               `residualFalseKeep` name (only the confusion-matrix
 *                               fields rename to falsePositive / falseNegative).
 * Empty → all zeros.
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
      // Routed to the baseline → decided correctly by construction (it is the label).
      routed++;
      correct++;
    } else {
      // Keep the candidate's decision.
      if (r.outputLabel === r.expectedLabel) correct++;
      else if (r.outputLabel && !r.expectedLabel) residualFalseKeep++;
    }
  }
  return {
    routed,
    routedFraction: routed / rows.length,
    autoSetAgreement: correct / rows.length,
    residualFalseKeep,
  };
}

// ── Composed analysis ────────────────────────────────────────────────────────

/** Tunable band edges for the ambiguity + hybrid-routing analysis. */
export interface AnalysisOptions {
  /** Lower edge of the ambiguity / routing band (inclusive). */
  bandLo: number;
  /** Upper edge of the ambiguity / routing band (inclusive). */
  bandHi: number;
}

/** The full dataset-level diagnostic, aggregated from the eval rows. */
export interface Analysis {
  n: number;
  labelAgreement: number;
  confusion: { falsePositive: number; falseNegative: number };
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
    labelAgreement: labelAgreement(rows),
    confusion: confusionCounts(rows),
    scoreMAE: scoreMAE(rows),
    auc: auc(rows),
    calibrated: calibratedThreshold(rows),
    band: { lo: opts.bandLo, hi: opts.bandHi, ...band },
    hybrid: hybridRouting(rows, opts.bandLo, opts.bandHi),
  };
}

// ── Generic projection + per-scorer aggregation ──────────────────────────────

/**
 * Consumer-supplied reduction of one generic eleatic row to the four AnalysisRow
 * values, or `null` to drop the row. The selector — not eleatic — owns where in
 * output_json / expected_json / scores_json each of the four axes lives, so the
 * package never hard-codes a domain mapping. Generic over the row type `T` so it
 * matches whatever row shape a consumer reads (E1's write-side record, an E2
 * read-side row, or a raw projection) without coupling eleatic to any one of them.
 */
export type AnalysisSelector<T> = (row: T) => AnalysisRow | null;

/**
 * Project a run's generic rows onto `AnalysisRow[]` via a consumer selector,
 * dropping any row the selector maps to `null` (its "incomplete row" signal —
 * a missing boolean label or non-finite score on either side). Pure and tolerant
 * of incomplete rows: a `null` row is dropped, never thrown. Mirrors the
 * photo-judge `projectRows`' "keep only complete rows" discipline, but with the
 * extraction pushed into the consumer.
 */
export function projectForAnalysis<T>(rows: T[], select: AnalysisSelector<T>): AnalysisRow[] {
  const out: AnalysisRow[] = [];
  for (const r of rows) {
    const projected = select(r);
    if (projected !== null) out.push(projected);
  }
  return out;
}

/**
 * Reduce a run's per-row `scores_json` blobs into a `{name: number}` map of
 * per-scorer means: each key is EXACTLY a scorer name that appears in the rows'
 * scores_json, and each value is the mean of that scorer across the rows that
 * carry it (a scorer present on only some rows is averaged over only those rows).
 *
 * This is deliberately the per-scorer aggregate, NOT the run-level gate metrics:
 * the run-level metric names the hub gate reads out of eval_run.metrics_json
 * (e.g. "agreement") are the CONSUMER's responsibility — the consumer chooses
 * those names and persists them via the write store's finalizeRun. eleatic
 * invents no run-level metric names here. A consumer is free to ALSO derive
 * labelAgreement / scoreMAE / auc (skip auc when it is null) from `analyze` and
 * merge them under whatever metric names its gate expects.
 *
 * Takes the scores blobs directly (one `Record<string, number>` per row) rather
 * than `AnalysisRow[]`, because `AnalysisRow` carries none of the named-scorer
 * data this averages — the four-axis projection deliberately discards scorer
 * names, so per-scorer means must read the scores blobs.
 */
export function aggregateScores(rows: Array<Record<string, number>>): Record<string, number> {
  const sums: Record<string, number> = {};
  const counts: Record<string, number> = {};
  for (const scores of rows) {
    for (const [name, value] of Object.entries(scores)) {
      if (!Number.isFinite(value)) continue;
      sums[name] = (sums[name] ?? 0) + value;
      counts[name] = (counts[name] ?? 0) + 1;
    }
  }
  const means: Record<string, number> = {};
  for (const [name, sum] of Object.entries(sums)) {
    const count = counts[name]!; // present by construction: a name in `sums` was counted.
    means[name] = sum / count;
  }
  return means;
}

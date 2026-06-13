// Pure, framework-free rendering primitives for the eleatic explorer hub.
//
// Three independent, fully-testable units, none touching the DOM or network:
//   1. FORMATTERS / formatMetric — the per-metric display registry. The hub
//      reads a {metric -> formatter-name} map from /config.js and renders each
//      run-level metric cell with the named formatter. eleatic invents no
//      domain: an unconfigured metric (or an unknown formatter name) falls back
//      to `raw`, and a missing/non-numeric value renders an em dash (never NaN).
//   2. evalGate — the configurable {metric, op, threshold} run gate. Generalizes
//      photo-curation's hard-coded `agreement >= 0.90` PASS/fail to any metric +
//      op. The 0–1 fraction contract is preserved by config, not by code: a
//      gate of {agreement, gte, 0.9} compares against the stored fraction.
//   3. mapPoints — the inline-SVG trend point mapper: a numeric series ->
//      viewBox {x,y} coordinates for a <polyline>, with min/max y-scaling, y
//      inversion (SVG y grows downward), and empty / single-point / flat-domain
//      edge cases handled so the hub needs NO chart dependency.

// ── 1. Metric formatter registry ──────────────────────────────────────────────

const EM_DASH = '—';

/**
 * The four named formatters. Each takes a finite number and returns a string;
 * the missing/NaN guard lives in `formatMetric`, so a formatter never sees a
 * non-number.
 */
export const FORMATTERS = {
  // 0–1 fraction -> one-decimal percent. Mirrors photo-curation's pct().
  percent: (n) => `${(n * 100).toFixed(1)}%`,
  // number -> two-decimal USD. Mirrors photo-curation's usd().
  usd: (n) => `$${n.toFixed(2)}`,
  // number -> rounded integer string.
  integer: (n) => String(Math.round(n)),
  // number -> stringified verbatim (the generic fallback; no domain assumption).
  raw: (n) => String(n),
};

/**
 * Render a single metric value with the named formatter. An unknown / undefined
 * formatter name falls back to `raw`; a missing or non-finite value renders an
 * em dash so a sparse run never shows `NaN`.
 */
export function formatMetric(value, formatterName) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return EM_DASH;
  const fmt = FORMATTERS[formatterName] ?? FORMATTERS.raw;
  return fmt(value);
}

// ── 2. Gate evaluator ──────────────────────────────────────────────────────────

const OPS = {
  eq: (a, b) => a === b,
  ne: (a, b) => a !== b,
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
};

/**
 * Evaluate a run gate. `gate` is `{ metric, op, threshold }` (from /config.js);
 * `metrics` is the run's `metrics_json` object. Returns:
 *   • 'PASS' / 'fail' when the gate is configured and the gated metric is present,
 *   • undefined when no gate is configured OR the metric is absent (no badge).
 * Comparison is over the stored value as-is (the 0–1 fraction contract is the
 * config's responsibility, not this function's).
 */
export function evalGate(gate, metrics) {
  if (gate === undefined || gate === null) return undefined;
  const value = metrics?.[gate.metric];
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const op = OPS[gate.op];
  if (op === undefined) return undefined;
  return op(value, gate.threshold) ? 'PASS' : 'fail';
}

// ── 3. Inline-SVG trend point mapper ────────────────────────────────────────────

/**
 * Map a numeric series into viewBox `{x, y}` points for an SVG `<polyline>`.
 *
 * `values` is index-ordered; a `null`/`undefined`/non-finite entry is a GAP —
 * it is dropped from the output, but the surviving points keep their original
 * index-derived x so the line never lies about horizontal position. `box` is
 * `{ width, height, pad }` (pad insets the plot from the viewBox edges).
 *
 * x: spread evenly by index across `[pad, width - pad]` (a single visible point
 *    sits at the horizontal center). y: min/max scaled and INVERTED so the max
 *    value sits at the top (`pad`) and the min at the bottom (`height - pad`);
 *    a flat domain (min === max, incl. the single-point case) sits every point
 *    at the vertical center. Empty series -> `[]` (caller renders empty-state).
 */
export function mapPoints(values, box) {
  const { width, height, pad } = box;
  const n = values.length;
  if (n === 0) return [];

  // Indexed, gap-filtered points; x derives from the ORIGINAL index.
  const indexed = [];
  for (let i = 0; i < n; i += 1) {
    const v = values[i];
    if (typeof v === 'number' && Number.isFinite(v)) indexed.push({ i, v });
  }
  if (indexed.length === 0) return [];

  const plotW = width - 2 * pad;
  const plotH = height - 2 * pad;
  const xSpan = n - 1; // index domain across the full original series
  const xFor = (i) => (xSpan === 0 ? width / 2 : pad + (i / xSpan) * plotW);

  const vs = indexed.map((p) => p.v);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const flat = max === min;
  const yFor = (v) =>
    flat ? height / 2 : pad + (1 - (v - min) / (max - min)) * plotH;

  return indexed.map((p) => ({ x: xFor(p.i), y: yFor(p.v) }));
}

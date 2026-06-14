// Shared render helpers for the eleatic trace surfaces — the score-bar block and
// a single metric <dl> row, used by BOTH the side-drawer (drawer.js) and the
// trace explorer's right pane (trace-view.js#renderSpanDetail).
//
// `scoreBars` is LIFTED VERBATIM from drawer.js (the 0..1-clamped horizontal
// bars, esc'd keys/values, "No scores" empty note). Moving it here is a pure
// refactor — drawer.js now imports it instead of holding a private copy, so the
// drawer's rendered output is byte-identical. Sharing it lets the right pane
// reuse the same scorer-bar visual without duplicating the clamp/escape logic.
//
// SECURITY: a span's scores live inside the OPAQUE, attacker-influenceable trace
// blob (the server exposes a write path), so every dynamic key/value routes
// through safe.js#esc — an injected `"><img onerror>` renders as inert text (the
// trace.test.ts / pretty.test.ts threat model).
//
// Plain ESM, named exports — importable by the browser (express.static) and by
// vitest in node (the trace.js / pretty.js / format.js precedent). PURE: no DOM,
// no fetch, never throws. The sibling trace-format.test.ts makes knip trace this
// file (so it needs no knip ignore — unlike the browser-only page glue).

import { esc } from './safe.js';

/**
 * A horizontal score bar (0..1 clamped) per scores entry — LIFTED VERBATIM from
 * drawer.js (no behaviour change). The bar WIDTH is clamped into 0..1, but the
 * numeric VALUE shown alongside is the raw, esc'd entry. An empty object (or
 * undefined) renders the "No scores" empty note.
 */
export function scoreBars(scores) {
  const entries = Object.entries(scores ?? {});
  if (entries.length === 0) return '<p class="drawer-empty">No scores</p>';
  return entries
    .map(([k, v]) => {
      const num = typeof v === 'number' && Number.isFinite(v) ? v : 0;
      const pct = Math.max(0, Math.min(1, num)) * 100;
      return `
        <div class="score-row">
          <span class="score-key">${esc(k)}</span>
          <span class="score-track"><span class="score-fill" style="width:${pct.toFixed(1)}%"></span></span>
          <span class="score-val">${esc(num)}</span>
        </div>`;
    })
    .join('');
}

/**
 * One metric <dl> row: a `<dt>` label + a `<dd>` value. Returns '' when the
 * value is absent (`''` or `undefined`) so the caller can omit a missing metric
 * row entirely (the omit-when-absent discipline of the §4 detail contract). Both
 * the label and the value route through esc.
 */
export function metricRow(label, v) {
  if (v === '' || v === undefined) return '';
  return `<div class="span-detail-row"><dt class="span-detail-key">${esc(label)}</dt><dd class="span-detail-val">${esc(v)}</dd></div>`;
}

/**
 * The shareable deep-link to the full-screen trace explorer for a row. Both the
 * drawer's "View trace →" entry and the page glue (trace-view-page.js) build the
 * same `/trace?run=&row=` URL from here, so the encoding lives in ONE place. The
 * optional `&span=` is added by the page on selection (history.replaceState), not
 * by this href — opening the trace defaults to the root span (§6 contract).
 */
export function traceHref(run, rowKey) {
  return `/trace?run=${encodeURIComponent(run)}&row=${encodeURIComponent(rowKey)}`;
}

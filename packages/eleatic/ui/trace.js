// Generic per-row TRACE renderer for the eleatic drawer.
//
// A row may carry an OPAQUE `trace` blob (trace_json — eleatic invents no eval
// domain and never destructures it on the store/read side). When it conforms to
// the conventional `{ spans: [{ name, input, output, usage }] }` shape, we render
// one LABELED BLOCK per span: the span name, a collapsible (<details>) pretty-
// print of its input and output, and a compact usage line
// (promptTokens·completionTokens·latencyMs·$costUsd) that OMITS any absent field.
// Anything that doesn't conform — no `spans` array, a scalar, an array — falls
// back to pretty-printing the WHOLE blob, so a non-standard trace still renders
// losslessly rather than vanishing.
//
// SECURITY: the blob is attacker-influenceable (the server exposes a write path
// and the harness that filled the store is untrusted). Every dynamic value goes
// through prettyJson (which escapes via safe.js#esc) or esc directly, so an
// injected `"><img onerror>` renders as inert text — the same threat model and
// proof as pretty.test.ts / safe.test.ts.
//
// This module also exports `rollupTrace` (the per-trace structural reduction the
// /trace page's tree-root label sums from): total spans + summed tokens / cost /
// latency over every span, domain-agnostic and with no dependency on the tree
// builder. See its own doc-comment below.
//
// Plain ESM with named exports — importable by the browser (express.static) and
// by vitest in node (the pretty.js / format.js precedent). PURE: no DOM, no fetch.

import { esc } from './safe.js';
import { prettyJson } from './pretty.js';

/** A collapsible labeled pretty-print of one sub-value (input / output). */
function collapsible(label, value) {
  return `<details class="trace-io"><summary class="trace-io-label">${esc(label)}</summary>${prettyJson(value)}</details>`;
}

/**
 * Render a usage line from a span's `usage` object. Each field is independent and
 * OMITTED when absent / non-finite; cost is dollar-formatted, the rest are bare
 * integers. Returns '' when nothing renders (so the caller drops the line).
 */
function renderUsage(usage) {
  if (usage === null || typeof usage !== 'object') return '';
  const parts = [];
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

  const prompt = num(usage.promptTokens);
  if (prompt !== undefined) parts.push(`<span class="trace-usage-part">${esc(prompt)} prompt</span>`);
  const completion = num(usage.completionTokens);
  if (completion !== undefined) parts.push(`<span class="trace-usage-part">${esc(completion)} completion</span>`);
  const latency = num(usage.latencyMs);
  if (latency !== undefined) parts.push(`<span class="trace-usage-part">${esc(latency)} ms</span>`);
  const cost = num(usage.costUsd);
  if (cost !== undefined) parts.push(`<span class="trace-usage-part">$${esc(cost)}</span>`);

  if (parts.length === 0) return '';
  return `<div class="trace-usage">${parts.join('<span class="trace-usage-sep">·</span>')}</div>`;
}

/** Render a single span block: name + collapsible input/output + usage line. */
function renderSpan(span, index) {
  const obj = span !== null && typeof span === 'object' ? span : {};
  const rawName = typeof obj.name === 'string' && obj.name !== '' ? obj.name : `span ${index}`;
  const io = [];
  if ('input' in obj) io.push(collapsible('input', obj.input));
  if ('output' in obj) io.push(collapsible('output', obj.output));
  const usage = renderUsage(obj.usage);
  return `<div class="trace-span"><div class="trace-span-name">${esc(rawName)}</div>${io.join('')}${usage}</div>`;
}

/**
 * Render an OPAQUE trace blob to an HTML string.
 *
 * Conforming shape: `{ spans: [{ name?, input?, output?, usage? }] }` → one
 * labeled block per span. Anything else (no spans array, scalar, array) → the
 * whole blob pretty-printed. Always returns a string and never throws.
 */
export function renderTrace(trace) {
  const spans =
    trace !== null && typeof trace === 'object' && Array.isArray(trace.spans)
      ? trace.spans
      : undefined;
  if (spans === undefined) {
    // Non-conforming → pretty-print the whole blob (lossless fallback).
    return `<div class="trace-raw">${prettyJson(trace ?? null)}</div>`;
  }
  if (spans.length === 0) return '<p class="drawer-empty">No spans</p>';
  return `<div class="trace-spans">${spans.map(renderSpan).join('')}</div>`;
}

/**
 * Reduce an OPAQUE trace blob to a per-trace rollup — the totals the tree-root
 * label shows above the span tree. PURE, domain-agnostic, never throws.
 *
 * Self-contained over the raw trace's generic span keys (NO dependency on the
 * tree builder): for each span it reads `metrics` ELSE the legacy `usage` object
 * (a span carrying both prefers `metrics`, so a normalized span is never
 * double-counted against its own legacy mirror) and sums every finite numeric
 * field via the SAME guard `renderUsage` uses. Latency comes from
 * `metrics.durationMs` OR `usage.latencyMs`.
 *
 * Each field is OMITTED from the result when NO span carried it — so a usage-less
 * trace rolls up to `{ spanCount }` alone (never `costUsd: 0`). `totalTokens` is
 * the sum of prompt + completion across spans (the same arithmetic the detail
 * pane's "Total tokens" row uses), emitted only when at least one is present.
 *
 * The flat sum over `trace.spans` is correct for the pinned producer convention
 * (tokens/cost live ONLY on the judge leaf; eval/task/scorer spans carry none),
 * so it does not double-count. A non-conforming blob → `{ spanCount: 0 }`.
 *
 * @returns {{ spanCount: number, promptTokens?: number, completionTokens?: number, totalTokens?: number, costUsd?: number, latencyMs?: number }}
 */
export function rollupTrace(trace) {
  const spans =
    trace !== null && typeof trace === 'object' && Array.isArray(trace.spans)
      ? trace.spans
      : undefined;
  if (spans === undefined) return { spanCount: 0 };

  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  // A running accumulator: value stays undefined until the first finite addend,
  // so a field never appears in the result unless some span actually carried it.
  const add = (acc, v) => (v === undefined ? acc : (acc ?? 0) + v);

  let promptTokens;
  let completionTokens;
  let costUsd;
  let latencyMs;

  for (const span of spans) {
    const obj = span !== null && typeof span === 'object' ? span : {};
    // Prefer the canonical `metrics`; fall back to the legacy `usage` mirror.
    const m = obj.metrics !== null && typeof obj.metrics === 'object' ? obj.metrics : undefined;
    const u = obj.usage !== null && typeof obj.usage === 'object' ? obj.usage : undefined;
    const src = m ?? u ?? {};

    promptTokens = add(promptTokens, num(src.promptTokens));
    completionTokens = add(completionTokens, num(src.completionTokens));
    costUsd = add(costUsd, num(src.costUsd));
    // Latency: durationMs (canonical) OR latencyMs (legacy) on the chosen source.
    latencyMs = add(latencyMs, num(src.durationMs ?? src.latencyMs));
  }

  const result = { spanCount: spans.length };
  if (promptTokens !== undefined) result.promptTokens = promptTokens;
  if (completionTokens !== undefined) result.completionTokens = completionTokens;
  // totalTokens = prompt + completion, emitted when EITHER is present (the same
  // sum the detail pane shows — never the absent-when-zero trap).
  if (promptTokens !== undefined || completionTokens !== undefined) {
    result.totalTokens = (promptTokens ?? 0) + (completionTokens ?? 0);
  }
  if (costUsd !== undefined) result.costUsd = costUsd;
  if (latencyMs !== undefined) result.latencyMs = latencyMs;
  return result;
}

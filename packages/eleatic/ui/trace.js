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
// Plain ESM with a named export — importable by the browser (express.static) and
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

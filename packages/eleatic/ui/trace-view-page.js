// Browser glue for the full-screen two-pane trace explorer (T4).
//
// The page is opened from a row drawer's "View trace →" deep-link:
//   /trace?run=<run>&row=<rowKey>[&span=<id>]
// It boots like facets.js (initTheme + the image-host allowlist + the theme
// toggle), then:
//   1. reads run / row / span from location.search,
//   2. fetches the EXISTING `GET /api/row?run=&row=` (no new /api route) →
//      { row: record } whose `record.trace` is the OPAQUE blob,
//   3. buildTraceTree(record.trace):
//        • ok === false → render renderTrace(record.trace), the lossless flat
//          fallback (a non-conforming / legacy-scalar trace still renders),
//        • else → render renderTree(roots, selectedId, collapsed) into the LEFT
//          pane and renderSpanDetail(selectedNode) into the RIGHT pane, plus the
//          per-trace rollup (rollupTrace) as a tree-root label above the tree.
//   4. selectedId = the &span= param when it resolves to a real node, else
//      roots[0].id — an unknown / stale span falls back to the root, never a
//      blank pane.
//
// wireTree delegates ONE click + ONE keydown listener (never per-row): onSelect
// swaps the detail pane + rewrites ONLY the &span= param via history.replaceState
// (NEVER pushState — arrow-nav must not flood history; run/row are preserved, the
// same surgical-param discipline as the drawer deleting only &row=); onToggle
// flips the node's collapsed state and re-renders the tree. The tree is fully
// expanded by default.
//
// Browser-only DOM + fetch glue — NO unit test (the drawer.js precedent; the
// pure logic lives in the trace-tree.js / trace-view.js / trace.js / format.js
// units, and the page is verified live at T6). Because knip can't statically
// trace a `<script type=module>` browser entry, this file is listed in the
// packages/eleatic knip ignore (T4).

import { initTheme, toggleTheme } from './theme.js';
import { esc, setImageHostAllowlist } from './safe.js';
import { buildTraceTree } from './trace-tree.js';
import { renderTree, renderSpanDetail, wireTree } from './trace-view.js';
import { renderTrace, rollupTrace } from './trace.js';
import { formatTokens, formatCost, formatDuration } from './format.js';
import { config } from '/config.js';

// ── Boot ──
initTheme();
setImageHostAllowlist(config.imageHostAllowlist);
document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);

const params = new URLSearchParams(location.search);
const run = params.get('run') ?? '';
const rowKey = params.get('row') ?? '';

const main = document.querySelector('.trace-explorer');
const rollupHost = document.getElementById('trace-rollup');
const treeHost = document.getElementById('trace-tree');
const detailHost = document.getElementById('trace-detail');
const fallbackHost = document.getElementById('trace-fallback');

// Render-state owned by the page (wireTree only routes events to the callbacks):
// the flat id→node index (for stale-span resolution + detail render), the root
// list, the current selection, and the collapsed-id Set (default fully expanded).
let nodeIndex = new Map();
let roots = [];
let selectedId = '';
const collapsed = new Set();

/**
 * Escape a span id for safe use inside an attribute selector. Span ids come from
 * the OPAQUE, attacker-influenceable trace blob, so they may contain quotes /
 * brackets that would break (or inject into) a `[data-span-id="…"]` selector.
 * CSS.escape is the standard primitive; the typeof guard keeps the module
 * importable in a non-browser context (it is browser-only glue, but stays safe).
 */
function cssEscape(value) {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(String(value))
    : String(value).replace(/["\\\]]/g, '\\$&');
}

/** A flat id→TraceNode index over the whole forest, for selection + detail render. */
function indexNodes(rootList) {
  const index = new Map();
  const stack = [...rootList];
  while (stack.length > 0) {
    const n = stack.pop();
    index.set(n.id, n);
    for (const c of n.children) stack.push(c);
  }
  return index;
}

/**
 * Render the per-trace ROLLUP line — the tree-root label above the span tree:
 * `{spanCount} spans · {totalTokens} · {costUsd} · {latencyMs}`. The rollup is a
 * pure structural reduction (rollupTrace) over the raw trace; each segment is
 * OMITTED when its field is absent (a usage-less trace shows only the span
 * count). Tokens / cost / latency reuse the same format.js formatters the tree
 * meta line uses. Every dynamic value routes through esc() — the trace blob is
 * attacker-influenceable (the trace.test.ts / pretty.test.ts threat model).
 */
function renderRollup(trace) {
  const r = rollupTrace(trace);
  const spanWord = r.spanCount === 1 ? 'span' : 'spans';
  const segments = [
    `${r.spanCount} ${spanWord}`,
    formatTokens(r.totalTokens, undefined), // single combined count → '{n} tok'
    formatCost(r.costUsd),
    formatDuration(r.latencyMs),
  ].filter((s) => s !== '');
  rollupHost.innerHTML = segments
    .map((s) => `<span class="trace-rollup-part">${esc(s)}</span>`)
    .join('<span class="trace-rollup-sep">·</span>');
  rollupHost.hidden = false;
}

/** Re-render the LEFT tree pane from the current roots / selection / collapsed set. */
function renderTreePane() {
  treeHost.innerHTML = renderTree(roots, selectedId, collapsed);
}

/** Re-render the RIGHT detail pane for the current selection. */
function renderDetailPane() {
  const node = nodeIndex.get(selectedId);
  detailHost.innerHTML = node ? renderSpanDetail(node) : '';
}

/** Rewrite ONLY the &span= param (run/row preserved) — replaceState, never push. */
function syncSpanParam() {
  const next = new URLSearchParams(location.search);
  next.set('span', selectedId);
  history.replaceState(null, '', `?${next.toString()}`);
}

/**
 * Select a node: update the panes, the URL, and (on mobile) flip to the detail
 * view. The tree re-render replaces the DOM, so if a node currently holds
 * keyboard focus (Enter/Space select), restore focus to the now-selected row so
 * arrow-nav can continue. A mouse click doesn't focus the row, so focus is only
 * restored when the page already had keyboard focus inside the tree.
 */
function selectSpan(id) {
  if (!nodeIndex.has(id)) return; // ignore a click on a stale / unknown id
  const hadTreeFocus = !!document.activeElement?.closest?.('[data-span-id]');
  selectedId = id;
  renderTreePane(); // re-render so aria-selected + roving tabindex track the selection
  renderDetailPane();
  syncSpanParam();
  if (main) main.setAttribute('data-mobile-view', 'detail');
  if (hadTreeFocus) {
    // The re-rendered selected row already carries tabindex=0 (renderNode); just
    // move DOM focus onto it so keyboard traversal resumes from the selection.
    treeHost.querySelector(`[data-span-id="${cssEscape(id)}"]`)?.focus();
  }
}

/**
 * Toggle a branch's collapsed state and re-render the tree. A keyboard toggle
 * (←/→) destroys + re-creates the DOM, so restore focus + the roving tab stop to
 * the toggled row afterwards (renderNode only puts tabindex=0 on the SELECTED
 * row, which may differ from the focused one). A mouse toggle leaves focus where
 * it was, so only re-focus when the toggled row currently holds keyboard focus.
 */
function toggleSpan(id) {
  const hadFocus =
    document.activeElement?.closest?.('[data-span-id]')?.getAttribute('data-span-id') === id;
  if (collapsed.has(id)) collapsed.delete(id);
  else collapsed.add(id);
  renderTreePane();
  if (hadFocus) {
    const row = treeHost.querySelector(`[data-span-id="${cssEscape(id)}"]`);
    if (row) {
      row.setAttribute('tabindex', '0');
      row.focus();
    }
  }
}

/** Render the lossless fallback for a non-conforming trace (single column). */
function renderFallback(trace) {
  rollupHost.hidden = true; // no tree-root label when there is no tree
  treeHost.hidden = true;
  detailHost.hidden = true;
  fallbackHost.hidden = false;
  fallbackHost.innerHTML = renderTrace(trace);
}

async function load() {
  if (run === '' || rowKey === '') {
    renderFallback(null);
    fallbackHost.innerHTML =
      '<p class="empty">Provide ?run=&lt;run&gt;&amp;row=&lt;rowKey&gt; to inspect a trace.</p>';
    return;
  }

  let record;
  try {
    const res = await fetch(`/api/row?run=${encodeURIComponent(run)}&row=${encodeURIComponent(rowKey)}`);
    if (!res.ok) {
      renderFallback(null);
      fallbackHost.innerHTML = '<p class="empty">Could not load this row.</p>';
      return;
    }
    record = (await res.json()).row;
  } catch {
    renderFallback(null);
    fallbackHost.innerHTML = '<p class="empty">Network error loading this row.</p>';
    return;
  }
  if (!record) {
    renderFallback(null);
    fallbackHost.innerHTML = '<p class="empty">Row not found.</p>';
    return;
  }

  const built = buildTraceTree(record.trace);
  if (!built.ok) {
    // Non-conforming / legacy-scalar trace → the lossless flat preview.
    renderFallback(record.trace);
    return;
  }
  if (built.roots.length === 0) {
    // A CONFORMING but EMPTY trace ({ spans: [] }) builds ok:true with no roots.
    // Rendering the two panes would leave both blank — contradicting the page's
    // "never a blank pane" intent (T6 fold #2). Route it through the same
    // lossless fallback, which shows renderTrace's empty-trace note.
    renderFallback(record.trace);
    return;
  }

  roots = built.roots;
  nodeIndex = indexNodes(roots);

  // The tree-root label: total spans / tokens / cost / latency over the whole
  // trace, summed from the raw blob (no tree-builder dependency).
  renderRollup(record.trace);

  // Default selection = the &span= param when it resolves to a real node, else
  // the first root (an unknown / stale span never leaves the detail pane blank).
  const wanted = params.get('span');
  selectedId = wanted !== null && nodeIndex.has(wanted) ? wanted : roots[0]?.id ?? '';

  renderTreePane();
  renderDetailPane();

  // ONE delegated click + ONE delegated keydown listener on the tree host.
  wireTree(treeHost, { onSelect: selectSpan, onToggle: toggleSpan });

  // The mobile back button (single-column collapse) returns to the tree view.
  detailHost.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-mobile-back]') && main) {
      main.setAttribute('data-mobile-view', 'tree');
    }
  });
}

load();

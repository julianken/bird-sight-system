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
//          pane and renderSpanDetail(selectedNode) into the RIGHT pane.
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
import { setImageHostAllowlist } from './safe.js';
import { buildTraceTree } from './trace-tree.js';
import { renderTree, renderSpanDetail, wireTree } from './trace-view.js';
import { renderTrace } from './trace.js';
import { config } from '/config.js';

// ── Boot ──
initTheme();
setImageHostAllowlist(config.imageHostAllowlist);
document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);

const params = new URLSearchParams(location.search);
const run = params.get('run') ?? '';
const rowKey = params.get('row') ?? '';

const main = document.querySelector('.trace-explorer');
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

/** Select a node: update the panes, the URL, and (on mobile) flip to the detail view. */
function selectSpan(id) {
  if (!nodeIndex.has(id)) return; // ignore a click on a stale / unknown id
  selectedId = id;
  renderTreePane(); // re-render so aria-selected + roving tabindex track the selection
  renderDetailPane();
  syncSpanParam();
  if (main) main.setAttribute('data-mobile-view', 'detail');
}

/** Toggle a branch's collapsed state and re-render the tree. */
function toggleSpan(id) {
  if (collapsed.has(id)) collapsed.delete(id);
  else collapsed.add(id);
  renderTreePane();
}

/** Render the lossless fallback for a non-conforming trace (single column). */
function renderFallback(trace) {
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

  roots = built.roots;
  nodeIndex = indexNodes(roots);

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

// PURE recursive renderer for the LEFT pane of the eleatic trace explorer — the
// indented, clickable ARIA span tree — plus ONE delegated click/keydown listener.
//
// The tree is built from TraceNodes (trace-tree.js) that reconstruct a structure
// from an OPAQUE trace blob. eleatic invents NO eval domain: the renderers key
// off a node's STRUCTURE (children / metrics), never off a span's name or kind
// semantics, and iconByKind carries no photo-judge literal (the T7 no-coupling
// guard enforces that). A row's `trace` blob is attacker-influenceable (the
// server exposes a write path), so EVERY dynamic value routes through
// safe.js#esc — an injected `"><img onerror>` renders as inert text (the same
// threat model and proof as trace.test.ts / pretty.test.ts).
//
// Indent is carried by the CSS custom property `--depth` on each <li>
// (app.css: `padding-left: calc(var(--depth) * 16px)`), NEVER concatenated into
// a class or id — so depth stays data, not a combinatorial class explosion.
//
// Plain ESM, named exports — importable by the browser (express.static) and by
// vitest in node (the trace.js / pretty.js / format.js precedent). The render
// functions + the keyboard model (flattenVisible / keyToAction) are PURE (no
// DOM, no fetch, never throw); wireTree is the single glue that binds the host
// element (the only DOM-touching export) and implements the full WAI-ARIA tree
// keyboard model (arrow nav with roving tabindex, expand/collapse, Home/End,
// Enter/Space select) via ONE delegated keydown listener over the visible rows.

import { esc } from './safe.js';
import { prettyJson } from './pretty.js';
import { formatDuration, formatTokens, formatCost } from './format.js';
import { scoreBars, metricRow } from './trace-format.js';

// Generic, domain-neutral glyphs keyed purely off a node's STRUCTURE. A node
// WITH children is a group/branch; a childless node WITH metrics is a model/leaf
// call; a bare childless node is a plain span. iconByKind never reads span.name.
const ICON_GROUP = '▾'; // a branch holding child spans (visual: an open disclosure)
const ICON_MODEL = '◆'; // a leaf that recorded metrics (a measured call)
const ICON_SPAN = '•'; // a bare leaf span (no children, no metrics)

/**
 * A generic glyph for a node, keyed off its STRUCTURE only:
 *   has children → group glyph; leaf WITH metrics → model glyph; bare leaf → span
 *   glyph. MUST NOT read span.name and MUST NOT embed any domain literal — the
 *   T7 quoted-literal guard scans this file for exactly that.
 */
export function iconByKind(node) {
  if (node.children.length > 0) return ICON_GROUP;
  if (node.metrics !== undefined && node.metrics !== null) return ICON_MODEL;
  return ICON_SPAN;
}

/**
 * A node's display name: the span's `name` when it is a non-empty string, else
 * the `span {index}` fallback (the trace.js precedent). For a synthesized id-less
 * node the id carries the index (`legacy:3` → `span 3`). Shared by the tree row
 * and the detail header so both label a node identically. Returns a RAW string
 * (the caller escapes via esc).
 */
function nodeName(node) {
  const span = node.span !== null && typeof node.span === 'object' ? node.span : {};
  return typeof span.name === 'string' && span.name !== ''
    ? span.name
    : `span ${String(node.id).replace(/^legacy:/, '')}`;
}

/**
 * The per-node META line: `duration · tokens · cost`, each segment OMITTED when
 * its source is absent, joined by '·'. Reads node.metrics ONLY (never span.usage
 * or span.metrics — normalization is the builder's job). Returns '' when nothing
 * renders, so renderNode can drop the meta span entirely.
 */
function metaLine(metrics) {
  if (metrics === null || typeof metrics !== 'object') return '';
  const parts = [
    formatDuration(metrics.durationMs),
    formatTokens(metrics.promptTokens, metrics.completionTokens),
    formatCost(metrics.costUsd),
  ].filter((p) => p !== '');
  if (parts.length === 0) return '';
  return `<span class="trace-node-meta">${parts.map((p) => esc(p)).join('<span class="trace-node-sep">·</span>')}</span>`;
}

/**
 * The disclosure twisty: an expanded branch shows ▾, a collapsed branch ▸, a
 * leaf an inert spacer (so all rows align). The button carries data-toggle for
 * the delegated click; aria-hidden because the row's aria-expanded conveys state.
 */
function twisty(id, hasChildren, expanded) {
  const glyph = hasChildren ? (expanded ? '▾' : '▸') : ' ';
  return `<button class="trace-twisty" data-toggle="${esc(id)}" aria-hidden="true">${glyph}</button>`;
}

/**
 * Render ONE node as an <li role="treeitem">, nesting its children in a
 * <ul role="group"> when expanded. `selectedId` marks the focused row
 * (aria-selected + tabindex=0; others tabindex=-1, the roving-tabindex contract).
 * `collapsed` is a Set of ids whose children are hidden (default: fully expanded).
 */
export function renderNode(node, selectedId, collapsed) {
  const hasChildren = node.children.length > 0;
  const expanded = hasChildren && !collapsed.has(node.id);
  const selected = node.id === selectedId;

  // name = the span's name, else a `span {index}` fallback (trace.js precedent).
  const rawName = nodeName(node);

  // aria-expanded only exists on a branch (omitted on a leaf, never "false").
  const ariaExpanded = hasChildren ? ` aria-expanded="${expanded ? 'true' : 'false'}"` : '';
  const meta = metaLine(node.metrics);
  const childMarkup = expanded
    ? node.children.map((c) => renderNode(c, selectedId, collapsed)).join('')
    : '';

  return (
    `<li class="trace-node" data-span-id="${esc(node.id)}" role="treeitem"` +
    ` aria-level="${esc(node.depth + 1)}" aria-selected="${selected ? 'true' : 'false'}"` +
    ariaExpanded +
    ` tabindex="${selected ? 0 : -1}" style="--depth:${esc(node.depth)}">` +
    '<span class="trace-node-row">' +
    twisty(node.id, hasChildren, expanded) +
    `<span class="trace-node-icon" aria-hidden="true">${esc(iconByKind(node))}</span>` +
    `<span class="trace-node-name">${esc(rawName)}</span>` +
    meta +
    '</span>' +
    `<ul role="group">${childMarkup}</ul>` +
    '</li>'
  );
}

/**
 * Render the whole tree: wrap the root nodes in a <ul role="tree">. `selectedId`
 * and `collapsed` thread down to every renderNode. Returns '' content inside the
 * tree when there are no roots (the caller decides the empty-state copy).
 */
export function renderTree(roots, selectedId, collapsed) {
  const items = roots.map((r) => renderNode(r, selectedId, collapsed)).join('');
  return `<ul class="trace-tree" role="tree">${items}</ul>`;
}

/**
 * Render the RIGHT pane for one selected node — the span inspector, top to
 * bottom (mirrors the Braintrust span panel):
 *   • a <header> with the node's structural glyph + name + a mobile back button
 *     (`[data-mobile-back]`, the single-column collapse's "← Spans" affordance),
 *   • a Metrics <dl> reading node.metrics: Duration · Total tokens · Prompt
 *     tokens · Completion tokens · Est. cost — each via metricRow, OMITTED when
 *     its source is absent (the omit-when-absent §4 discipline). All three token
 *     rows render through formatTokens, so the detail pane reads identically to
 *     the tree meta line (thousands-separated + " tok"); "Total tokens" passes
 *     prompt + completion and is omitted when neither is finite. There is no
 *     "Start" row: startMs is a timestamp (no producer field, no timeline
 *     feature) and was wrongly run through the DURATION formatter (T6 fold #1),
 *   • a Scores block ONLY when node.span.scores exists, wrapped in the caller's
 *     `.score-bars` flex container around the shared scoreBars (matching the
 *     drawer, where `.score-bars` wraps the call rather than scoreBars emitting
 *     it),
 *   • Input / Output pretty-printed via prettyJson, or a "No input" / "No output"
 *     empty note.
 *
 * PURE, never throws. Every dynamic value routes through esc / prettyJson /
 * scoreBars — the trace blob is attacker-influenceable, so an injected payload
 * renders as inert text (the trace.test.ts / pretty.test.ts threat model).
 */
export function renderSpanDetail(node) {
  const span = node.span !== null && typeof node.span === 'object' ? node.span : {};
  const metrics = node.metrics !== null && typeof node.metrics === 'object' ? node.metrics : {};

  // Token rows ALL route through formatTokens so the detail pane reads
  // identically to the tree meta line — thousands-separated + " tok" suffix
  // (e.g. "1,884 tok"), never a bare integer. "Total tokens" passes BOTH
  // prompt + completion (the same sum the tree meta line computes); the
  // single-arg calls render each component alone. formatTokens returns '' when
  // its source is absent, so metricRow omits the row (the omit-when-absent §4
  // discipline). No "Start" row: metrics.startMs is a timestamp, not a
  // duration, has no producer field, and there is no timeline feature yet —
  // formatting it through the DURATION formatter was wrong (T6 fold #1).
  const rows =
    metricRow('Duration', formatDuration(metrics.durationMs)) +
    metricRow('Total tokens', formatTokens(metrics.promptTokens, metrics.completionTokens)) +
    metricRow('Prompt tokens', formatTokens(metrics.promptTokens, undefined)) +
    metricRow('Completion tokens', formatTokens(undefined, metrics.completionTokens)) +
    metricRow('Est. cost', formatCost(metrics.costUsd));

  const scores =
    span.scores !== null && typeof span.scores === 'object'
      ? `<section class="span-detail-section"><h3 class="span-detail-h3">Scores</h3><div class="score-bars">${scoreBars(span.scores)}</div></section>`
      : '';

  const input =
    'input' in span
      ? prettyJson(span.input)
      : '<p class="drawer-empty">No input</p>';
  const output =
    'output' in span
      ? prettyJson(span.output)
      : '<p class="drawer-empty">No output</p>';

  return (
    '<div class="span-detail">' +
    '<header class="span-detail-head">' +
    `<button class="span-detail-back" type="button" data-mobile-back>← Spans</button>` +
    `<span class="span-detail-icon" aria-hidden="true">${esc(iconByKind(node))}</span>` +
    `<h2 class="span-detail-name">${esc(nodeName(node))}</h2>` +
    '</header>' +
    (rows !== '' ? `<dl class="span-detail-metrics">${rows}</dl>` : '') +
    scores +
    `<section class="span-detail-section"><h3 class="span-detail-h3">Input</h3><div class="span-detail-io">${input}</div></section>` +
    `<section class="span-detail-section"><h3 class="span-detail-h3">Output</h3><div class="span-detail-io">${output}</div></section>` +
    '</div>'
  );
}

/**
 * Flatten the forest into the ordered list of VISIBLE treeitems — a pre-order
 * walk that recurses into a node's children ONLY when the node is NOT collapsed.
 * The result is the exact set of rows the user can move focus between with the
 * arrow keys (a collapsed subtree's descendants are excluded), and is the pure
 * core the wireTree keydown handler's DOM walk mirrors. Each descriptor carries
 * only the structural facts keyToAction needs. PURE; never throws.
 *
 * @returns {{ id: string, hasChildren: boolean, expanded: boolean, depth: number, parentId: string|null }[]}
 */
export function flattenVisible(roots, collapsed) {
  const out = [];
  const walk = (node, parentId) => {
    const hasChildren = node.children.length > 0;
    const expanded = hasChildren && !collapsed.has(node.id);
    out.push({ id: node.id, hasChildren, expanded, depth: node.depth, parentId });
    if (expanded) {
      for (const c of node.children) walk(c, node.id);
    }
  };
  for (const r of roots) walk(r, null);
  return out;
}

// The set of keys the tree's keydown handler consumes (preventing the default
// page scroll / caret motion). Any other key falls through (type:'none', no
// preventDefault) so the page's normal handling is untouched.
const TREE_KEYS = new Set([
  'ArrowDown',
  'ArrowUp',
  'ArrowRight',
  'ArrowLeft',
  'Home',
  'End',
  'Enter',
  ' ',
]);

/**
 * The PURE WAI-ARIA tree key model: given a `key`, the currently-focused id,
 * and the ordered `visible` list (from flattenVisible), return the action the
 * delegated keydown handler should apply:
 *   { type: 'focus'|'select'|'toggle'|'none', id?: string, preventDefault: boolean }
 *
 *   • ↓ / ↑  — focus the next / previous visible item (CLAMP at the ends, no
 *              wrap). A focused id absent from the list defaults ↓→first, ↑→last
 *              so navigation never gets stuck on stale focus.
 *   • →      — a COLLAPSED branch expands (toggle); an EXPANDED branch focuses
 *              its first child; a leaf is a no-op (still prevents scroll).
 *   • ←      — an EXPANDED branch collapses (toggle); otherwise focus moves to
 *              the parent (a root with no parent is a no-op).
 *   • Enter / Space — select the focused item (Space prevents page scroll; we
 *              prevent default for both for a consistent roving experience).
 *   • Home / End — focus the first / last visible item.
 *
 * No DOM, no callbacks — wireTree owns applying the action. PURE; never throws.
 */
export function keyToAction(key, focusedId, visible) {
  if (!TREE_KEYS.has(key) || visible.length === 0) {
    return { type: 'none', preventDefault: false };
  }
  const i = visible.findIndex((v) => v.id === focusedId);
  const focused = i === -1 ? undefined : visible[i];
  const last = visible.length - 1;

  switch (key) {
    case 'ArrowDown': {
      const next = i === -1 ? visible[0] : visible[Math.min(i + 1, last)];
      return { type: 'focus', id: next.id, preventDefault: true };
    }
    case 'ArrowUp': {
      const prev = i === -1 ? visible[last] : visible[Math.max(i - 1, 0)];
      return { type: 'focus', id: prev.id, preventDefault: true };
    }
    case 'ArrowRight': {
      if (focused === undefined) return { type: 'none', preventDefault: true };
      if (focused.hasChildren && !focused.expanded) {
        return { type: 'toggle', id: focused.id, preventDefault: true };
      }
      if (focused.hasChildren && focused.expanded) {
        // The first child is the very next visible row (pre-order guarantees it).
        const child = visible[i + 1];
        if (child) return { type: 'focus', id: child.id, preventDefault: true };
      }
      return { type: 'none', preventDefault: true }; // a leaf: nothing to expand
    }
    case 'ArrowLeft': {
      if (focused === undefined) return { type: 'none', preventDefault: true };
      if (focused.hasChildren && focused.expanded) {
        return { type: 'toggle', id: focused.id, preventDefault: true };
      }
      if (focused.parentId !== null && focused.parentId !== undefined) {
        return { type: 'focus', id: focused.parentId, preventDefault: true };
      }
      return { type: 'none', preventDefault: true }; // a root: no parent
    }
    case 'Home':
      return { type: 'focus', id: visible[0].id, preventDefault: true };
    case 'End':
      return { type: 'focus', id: visible[last].id, preventDefault: true };
    case 'Enter':
    case ' ': {
      if (focused === undefined) return { type: 'none', preventDefault: true };
      return { type: 'select', id: focused.id, preventDefault: true };
    }
    default:
      return { type: 'none', preventDefault: false };
  }
}

/**
 * Read the VISIBLE treeitems straight from the rendered DOM, in document order.
 * Because renderNode only nests a branch's children when it is expanded, the
 * collapsed subtrees are simply absent from the DOM — so the live treeitems ARE
 * the visible list. Each descriptor mirrors flattenVisible's shape (id +
 * hasChildren + expanded + parentId) so keyToAction is fed identically whether
 * driven by the pure unit test or the browser. parentId is the data-span-id of
 * the nearest ANCESTOR treeitem (null at a root).
 */
function visibleFromDom(host) {
  const items = Array.from(host.querySelectorAll('[role="treeitem"]'));
  const byEl = new Map(items.map((el) => [el, el.getAttribute('data-span-id')]));
  return items.map((el) => {
    const expandedAttr = el.getAttribute('aria-expanded');
    // A parent treeitem is the nearest ancestor row; null at a root. `closest`
    // from the element itself returns itself, so search from the parent node.
    let parentId = null;
    const parentEl =
      typeof el.parentElement?.closest === 'function'
        ? el.parentElement.closest('[role="treeitem"]')
        : null;
    if (parentEl && byEl.has(parentEl)) parentId = byEl.get(parentEl);
    return {
      el,
      id: el.getAttribute('data-span-id'),
      hasChildren: expandedAttr !== null, // aria-expanded only exists on a branch
      expanded: expandedAttr === 'true',
      parentId,
    };
  });
}

/**
 * Bind the tree's interaction with ONE delegated click + ONE delegated keydown
 * listener on `host` (the facets.js anti-per-row-binding pattern — never one
 * listener per node). A click on a twisty (`[data-toggle]`) calls onToggle(id);
 * any other click inside a node row (`[data-span-id]`) calls onSelect(id).
 *
 * The keydown listener implements the full WAI-ARIA tree keyboard model
 * (keyToAction) over the VISIBLE treeitems (read live from the DOM):
 *   ↓/↑ move focus (roving tabindex — the focused row gets tabindex=0, the rest
 *   -1, and .focus() lands on the new row); → expands-or-descends; ← collapses-
 *   or-ascends; Enter/Space select; Home/End jump to the first/last visible row.
 * Selection (onSelect) and toggling (onToggle) re-render via the caller's
 * callbacks; after a re-render renderNode re-establishes the roving tabindex
 * from selectedId. The collapsed Set is owned by the caller (the page glue) —
 * wireTree only routes events to the two callbacks + manages transient focus.
 */
export function wireTree(host, { onSelect, onToggle }) {
  host.addEventListener('click', (ev) => {
    const toggle = ev.target.closest('[data-toggle]');
    if (toggle) {
      const id = toggle.getAttribute('data-toggle');
      if (id !== null) onToggle(id);
      return;
    }
    const row = ev.target.closest('[data-span-id]');
    if (!row) return;
    const id = row.getAttribute('data-span-id');
    if (id !== null) onSelect(id);
  });

  host.addEventListener('keydown', (ev) => {
    if (!TREE_KEYS.has(ev.key)) return; // leave every other key to the page

    // Select (Enter/Space) is DOM-light: it routes the focused row's id to
    // onSelect without needing the full visible list. Arrow / Home / End nav
    // reads the live visible treeitems and moves roving focus.
    if (ev.key === 'Enter' || ev.key === ' ') {
      const row = ev.target.closest('[data-span-id]');
      if (!row) return;
      ev.preventDefault();
      const id = row.getAttribute('data-span-id');
      if (id !== null) onSelect(id);
      return;
    }

    const visible = visibleFromDom(host);
    if (visible.length === 0) return;
    const focusedRow = ev.target.closest('[role="treeitem"]');
    const focusedId = focusedRow ? focusedRow.getAttribute('data-span-id') : null;
    const action = keyToAction(ev.key, focusedId, visible);
    if (action.preventDefault) ev.preventDefault();

    if (action.type === 'focus') {
      const target = visible.find((v) => v.id === action.id);
      if (!target) return;
      // Roving tabindex: the focused row is the single tab stop (0), the rest -1.
      for (const v of visible) v.el.setAttribute('tabindex', v === target ? '0' : '-1');
      target.el.focus();
    } else if (action.type === 'toggle') {
      onToggle(action.id);
    } else if (action.type === 'select') {
      onSelect(action.id);
    }
  });
}

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
// functions are PURE (no DOM, no fetch, never throw); wireTree is the single
// glue that binds the host element (the only DOM-touching export).

import { esc } from './safe.js';
import { formatDuration, formatTokens, formatCost } from './format.js';

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
  // For a synthesized id-less node the id carries the index (`legacy:3`).
  const span = node.span !== null && typeof node.span === 'object' ? node.span : {};
  const rawName =
    typeof span.name === 'string' && span.name !== ''
      ? span.name
      : `span ${String(node.id).replace(/^legacy:/, '')}`;

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
 * Bind the tree's interaction with ONE delegated click + ONE delegated keydown
 * listener on `host` (the facets.js anti-per-row-binding pattern — never one
 * listener per node). A click on a twisty (`[data-toggle]`) calls onToggle(id);
 * any other click inside a node row (`[data-span-id]`) calls onSelect(id). Enter
 * or Space on a focused node selects it (preventing the default scroll). The
 * collapsed Set is owned by the caller (the page glue, T4) — wireTree only routes
 * events to the two callbacks.
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
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const row = ev.target.closest('[data-span-id]');
    if (!row) return;
    ev.preventDefault();
    const id = row.getAttribute('data-span-id');
    if (id !== null) onSelect(id);
  });
}

import { describe, it, expect } from 'vitest';
import {
  renderTree,
  renderNode,
  iconByKind,
  wireTree,
  renderSpanDetail,
  flattenVisible,
  keyToAction,
} from './trace-view.js';
import { buildTraceTree } from './trace-tree.js';

// trace-view.js is the LEFT pane of the eleatic trace explorer: a PURE recursive
// string renderer over the TraceNodes that buildTraceTree (trace-tree.js)
// reconstructs from an OPAQUE trace blob, plus ONE delegated click/keydown
// listener (wireTree). eleatic invents no eval domain — iconByKind keys off a
// node's STRUCTURE (children / metrics), never a span name, and contains no
// photo-judge literal (the T7 guard enforces that). Every dynamic value flows
// through safe.js#esc, so an injected payload renders inert (same threat model
// and proof as trace.test.ts / pretty.test.ts).
//
// The vitest env is `node` (no jsdom) — the render functions are pure strings,
// and wireTree is exercised with minimal fake host/event objects that mimic only
// the addEventListener + closest surface it uses.

// ── A small TraceNode literal helper (renderers read id/span/metrics/depth/children). ──
function node(partial) {
  return { id: 'x', span: {}, metrics: undefined, depth: 0, children: [], ...partial };
}

describe('renderNode — structure', () => {
  it('emits one <li role="treeitem"> with aria-level, data-span-id, --depth', () => {
    const out = renderNode(node({ id: 'judge', span: { name: 'judge' }, depth: 2 }), 'judge', new Set());
    expect(out).toContain('role="treeitem"');
    expect(out).toContain('class="trace-node"');
    expect(out).toContain('data-span-id="judge"');
    expect(out).toContain('aria-level="3"'); // depth + 1
    expect(out).toContain('style="--depth:2"'); // depth carried by a CSS var, never in a class/id
    expect(out).not.toContain('class="trace-node-2"'); // depth NEVER concatenated into a class
  });

  it('marks the selected node aria-selected=true + tabindex=0, others -1', () => {
    const sel = renderNode(node({ id: 'a', span: { name: 'a' } }), 'a', new Set());
    expect(sel).toContain('aria-selected="true"');
    expect(sel).toContain('tabindex="0"');

    const unsel = renderNode(node({ id: 'b', span: { name: 'b' } }), 'a', new Set());
    expect(unsel).toContain('aria-selected="false"');
    expect(unsel).toContain('tabindex="-1"');
  });

  it('emits the span name, falling back to `span {index}` when absent', () => {
    expect(renderNode(node({ id: 'n', span: { name: 'retrieve' } }), '', new Set())).toContain(
      'retrieve',
    );
    // No name → the trace.js precedent fallback. The node id carries the index for
    // a synthesized legacy node (`legacy:3`).
    const out = renderNode(node({ id: 'legacy:3', span: {} }), '', new Set());
    expect(out).toContain('span 3');
  });

  it('renders a twisty + group for a node WITH children; a leaf gets a spacer + empty group', () => {
    const parent = node({
      id: 'p',
      span: { name: 'p' },
      children: [node({ id: 'c', span: { name: 'c' }, depth: 1 })],
    });
    const out = renderNode(parent, '', new Set());
    expect(out).toContain('data-toggle="p"');
    expect(out).toContain('role="group"');
    // Expanded by default (collapsed set empty) → the child is nested.
    expect(out).toContain('data-span-id="c"');
    expect(out).toContain('aria-expanded="true"');

    const leaf = renderNode(node({ id: 'leaf', span: { name: 'leaf' } }), '', new Set());
    // A leaf carries no aria-expanded (the attribute is omitted, not "false").
    expect(leaf).not.toContain('aria-expanded');
  });

  it('omits children markup + flips aria-expanded when the node is collapsed', () => {
    const parent = node({
      id: 'p',
      span: { name: 'p' },
      children: [node({ id: 'c', span: { name: 'c' }, depth: 1 })],
    });
    const out = renderNode(parent, '', new Set(['p']));
    expect(out).toContain('aria-expanded="false"');
    expect(out).not.toContain('data-span-id="c"'); // collapsed → children not rendered
  });
});

describe('renderNode — meta line (reads node.metrics, omits absent segments)', () => {
  it('renders duration · tokens · cost when all three present', () => {
    const out = renderNode(
      node({
        id: 'j',
        span: { name: 'judge' },
        metrics: { durationMs: 1500, promptTokens: 1000, completionTokens: 884, costUsd: 0.0123 },
      }),
      '',
      new Set(),
    );
    expect(out).toContain('1.50s');
    expect(out).toContain('1,884 tok');
    expect(out).toContain('$0.0123');
    expect(out).toContain('trace-node-meta');
  });

  it('omits a segment whose metric is absent', () => {
    // Only completion tokens present → only the tokens segment renders.
    const out = renderNode(
      node({ id: 'j', span: { name: 'judge' }, metrics: { completionTokens: 7 } }),
      '',
      new Set(),
    );
    expect(out).toContain('7 tok');
    expect(out).not.toContain('s</span>'); // no duration segment
    expect(out).not.toContain('$'); // no cost segment
  });

  it('reads node.metrics, NOT span.metrics or span.usage', () => {
    // The renderer must NOT fall back to span.usage — normalization is the
    // builder's job (trace-tree.js), and node.metrics is the single source.
    const out = renderNode(
      node({
        id: 'j',
        span: { name: 'judge', usage: { latencyMs: 9999 }, metrics: { durationMs: 9999 } },
        metrics: { durationMs: 250 }, // the ONLY value the renderer should read
      }),
      '',
      new Set(),
    );
    expect(out).toContain('250ms');
    expect(out).not.toContain('9999');
  });

  it('renders a meta line for a node whose metrics were normalized from legacy usage', () => {
    // buildTraceTree maps legacy usage → node.metrics; the renderer reads that.
    const { roots } = buildTraceTree({
      spans: [{ name: 'judge', usage: { latencyMs: 250, promptTokens: 12, completionTokens: 34 } }],
    });
    // Legacy id-less → one synthesized root with the judge child beneath it.
    const out = renderTree(roots, '', new Set());
    expect(out).toContain('250ms');
    expect(out).toContain('46 tok');
  });
});

describe('iconByKind — generic, structure-keyed, no domain literal', () => {
  it('returns a group glyph for a node with children', () => {
    const parent = node({ children: [node({ id: 'c' })] });
    const leafModel = node({ metrics: { durationMs: 1 } });
    const bareLeaf = node({});
    const g = iconByKind(parent);
    const m = iconByKind(leafModel);
    const s = iconByKind(bareLeaf);
    expect(typeof g).toBe('string');
    // The three structural classes produce three DISTINCT glyphs.
    expect(new Set([g, m, s]).size).toBe(3);
  });

  it('ignores span.name entirely (same structure → same glyph regardless of name)', () => {
    const a = node({ id: 'a', span: { name: 'judge' }, metrics: { durationMs: 1 } });
    const b = node({ id: 'b', span: { name: 'totally-different' }, metrics: { durationMs: 1 } });
    expect(iconByKind(a)).toBe(iconByKind(b));
  });

  it('contains no photo-judge domain literal in its output', () => {
    for (const n of [node({ children: [node({})] }), node({ metrics: {} }), node({})]) {
      const glyph = iconByKind(n);
      for (const lit of ['judge', 'scorer', 'species', 'rubric', 'keep']) {
        expect(glyph).not.toContain(lit);
      }
    }
  });
});

describe('renderTree — wraps roots in a <ul role="tree">', () => {
  it('wraps the roots and renders each as a treeitem', () => {
    const roots = [
      node({ id: 'a', span: { name: 'a' } }),
      node({ id: 'b', span: { name: 'b' } }),
    ];
    const out = renderTree(roots, 'a', new Set());
    expect(out).toContain('role="tree"');
    expect(out.match(/role="treeitem"/g)?.length).toBe(2);
    expect(out).toContain('data-span-id="a"');
    expect(out).toContain('data-span-id="b"');
  });

  it('renders nested children at increasing depth', () => {
    const { roots } = buildTraceTree({
      spans: [
        { id: 'eval', parentId: null, name: 'eval' },
        { id: 'task', parentId: 'eval', name: 'task' },
        { id: 'judge', parentId: 'task', name: 'judge' },
      ],
    });
    const out = renderTree(roots, 'eval', new Set());
    expect(out).toContain('style="--depth:0"');
    expect(out).toContain('style="--depth:1"');
    expect(out).toContain('style="--depth:2"');
    expect(out).toContain('aria-level="1"');
    expect(out).toContain('aria-level="3"');
  });
});

describe('renderNode — XSS escaping (same threat model as trace.test.ts)', () => {
  it('neutralizes an injected payload in a NESTED span name + data-span-id', () => {
    const { roots } = buildTraceTree({
      spans: [
        { id: 'root', parentId: null, name: 'root' },
        { id: '"><img src=x onerror=alert(1)>', parentId: 'root', name: '"><img onerror>' },
      ],
    });
    const out = renderTree(roots, 'root', new Set());
    expect(out).toContain('&lt;'); // payload escaped to inert text
    expect(out).not.toContain('<img'); // no live <img> in the name OR the data-span-id attribute
    expect(out).not.toContain('onerror=alert(1)>');
  });
});

describe('renderSpanDetail — the RIGHT pane (Metrics · Scores · Input · Output)', () => {
  it('renders a header with the structural icon, the span name, and a mobile back button', () => {
    const out = renderSpanDetail(node({ id: 'j', span: { name: 'judge' } }));
    expect(out).toContain('<header');
    expect(out).toContain('judge'); // the name
    expect(out).toContain('data-mobile-back'); // the mobile "← Spans" button
    expect(out).toContain('← Spans');
  });

  it('falls back to `span {index}` for a synthesized id-less node with no name', () => {
    const out = renderSpanDetail(node({ id: 'legacy:3', span: {} }));
    expect(out).toContain('span 3');
  });

  it('renders the metric rows present and OMITS the absent ones', () => {
    const out = renderSpanDetail(
      node({
        id: 'j',
        span: { name: 'judge' },
        metrics: { startMs: 5, durationMs: 1500, promptTokens: 1000, completionTokens: 884, costUsd: 0.0123 },
      }),
    );
    // No "Start" row — startMs is a timestamp, NOT a duration, and there is no
    // producer field nor timeline feature yet (T6 fold #1: the row was dropped
    // rather than mis-formatted through the DURATION formatter).
    expect(out).not.toContain('Start');
    expect(out).toContain('Duration');
    expect(out).toContain('1.50s');
    expect(out).toContain('Prompt tokens');
    expect(out).toContain('Completion tokens');
    expect(out).toContain('Est. cost');
    expect(out).toContain('$0.0123');
    // Total tokens = prompt + completion, formatted with a thousands separator +
    // " tok" suffix (T6 fold #3) so the detail row MATCHES the tree meta line
    // (1,884 tok) instead of a bare 1884. The arithmetic is still sumTokens.
    expect(out).toContain('Total tokens');
    expect(out).toContain('1,884 tok');
    expect(out).not.toMatch(/>1884</); // never the bare, unseparated number
    // Prompt / Completion rows are also thousands-separated + suffixed for
    // consistency across the three token rows.
    expect(out).toContain('1,000 tok');
    expect(out).toContain('884 tok');
  });

  it('omits ALL metric rows when the node has no metrics (a usage-less scorer span)', () => {
    const out = renderSpanDetail(node({ id: 's', span: { name: 'keep_agreement', scores: { keep_agreement: 1 } } }));
    expect(out).not.toContain('Duration');
    expect(out).not.toContain('Total tokens');
    expect(out).not.toContain('Prompt tokens');
    expect(out).not.toContain('Est. cost');
  });

  it('omits Total tokens when neither prompt nor completion is finite, but shows duration', () => {
    const out = renderSpanDetail(node({ id: 'x', span: { name: 'x' }, metrics: { durationMs: 250 } }));
    expect(out).toContain('Duration');
    expect(out).toContain('250ms');
    expect(out).not.toContain('Total tokens');
    expect(out).not.toContain('Prompt tokens');
  });

  it('shows the Scores block (wrapped in .score-bars) ONLY when node.span.scores exists', () => {
    const withScores = renderSpanDetail(node({ id: 's', span: { name: 's', scores: { keep_agreement: 1 } } }));
    expect(withScores).toContain('score-bars'); // the flex wrapper from the caller
    expect(withScores).toContain('score-row'); // a bar rendered by the shared scoreBars
    expect(withScores).toContain('keep_agreement');

    const noScores = renderSpanDetail(node({ id: 'n', span: { name: 'n' } }));
    expect(noScores).not.toContain('score-bars');
    expect(noScores).not.toContain('score-row');
  });

  it('pretty-prints input/output when present', () => {
    const out = renderSpanDetail(
      node({ id: 'j', span: { name: 'judge', input: { prompt: 'hi' }, output: { parsed: 'keep' } } }),
    );
    expect(out).toContain('prompt');
    expect(out).toContain('parsed');
    expect(out).toContain('json-object'); // prettyJson output
  });

  it('shows the empty notes when input/output are absent', () => {
    const out = renderSpanDetail(node({ id: 'n', span: { name: 'n' } }));
    expect(out).toContain('No input');
    expect(out).toContain('No output');
    expect(out).toContain('drawer-empty');
  });

  it('neutralizes an injected payload in the name AND the input (same threat model)', () => {
    const out = renderSpanDetail(
      node({
        id: 'x',
        span: { name: '"><img src=x onerror=alert(1)>', input: { evil: '"><script>alert(1)</script>' } },
      }),
    );
    expect(out).toContain('&lt;'); // escaped to inert text
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<script>alert(1)</script>');
    expect(out).not.toContain('onerror=alert(1)>');
  });

  it('renders a detail pane from a real judge node built by buildTraceTree (legacy usage normalized)', () => {
    const { roots } = buildTraceTree({
      spans: [{ name: 'judge', input: { p: 1 }, output: { r: 2 }, usage: { latencyMs: 250, promptTokens: 12, completionTokens: 34, costUsd: 0.01 } }],
    });
    // legacy id-less → synthesized root with the judge child beneath it.
    const judge = roots[0].children[0];
    const out = renderSpanDetail(judge);
    expect(out).toContain('judge');
    expect(out).toContain('250ms'); // durationMs normalized from latencyMs
    expect(out).toContain('Total tokens');
    expect(out).toContain('46 tok'); // 12 + 34, thousands-sep + " tok" suffix
    expect(out).toContain('$0.01');
  });
});

// ── wireTree: ONE delegated click + ONE delegated keydown listener ──
//
// No jsdom in this env — a minimal fake host records the listeners wireTree
// registers, and fake events carry a `target.closest(sel)` that returns a stub
// matching one selector. This proves the delegation logic (a single listener
// each, dispatching by closest('[data-toggle]') vs closest('[data-span-id]'))
// without a real DOM.
function fakeHost() {
  const listeners = {};
  return {
    listeners,
    addEventListener(type, fn) {
      // record EVERY registration so a per-row binding (many) would be visible.
      (listeners[type] ??= []).push(fn);
    },
  };
}
/** A fake event whose target.closest(sel) returns `match` only for `matchSel`. */
function fakeEvent(matchSel, match, extra = {}) {
  return {
    ...extra,
    preventDefault() {
      this.defaultPrevented = true;
    },
    target: {
      closest(sel) {
        return sel === matchSel ? match : null;
      },
    },
  };
}

describe('wireTree — delegation', () => {
  it('registers exactly ONE click + ONE keydown listener (no per-row binding)', () => {
    const host = fakeHost();
    wireTree(host, { onSelect() {}, onToggle() {} });
    expect(host.listeners.click).toHaveLength(1);
    expect(host.listeners.keydown).toHaveLength(1);
  });

  it('a click on a twisty fires onToggle with the toggled id (NOT onSelect)', () => {
    const host = fakeHost();
    const toggled = [];
    const selected = [];
    wireTree(host, { onSelect: (id) => selected.push(id), onToggle: (id) => toggled.push(id) });
    const twisty = { getAttribute: (a) => (a === 'data-toggle' ? 'judge' : null) };
    host.listeners.click[0](fakeEvent('[data-toggle]', twisty));
    expect(toggled).toEqual(['judge']);
    expect(selected).toEqual([]); // toggle takes precedence; select does not also fire
  });

  it('a click on a node row (not a twisty) fires onSelect with the span id', () => {
    const host = fakeHost();
    const selected = [];
    wireTree(host, { onSelect: (id) => selected.push(id), onToggle() {} });
    const row = { getAttribute: (a) => (a === 'data-span-id' ? 'task' : null) };
    // closest('[data-toggle]') → null, closest('[data-span-id]') → the row.
    host.listeners.click[0](fakeEvent('[data-span-id]', row));
    expect(selected).toEqual(['task']);
  });

  it('a click outside any node is a no-op', () => {
    const host = fakeHost();
    const selected = [];
    const toggled = [];
    wireTree(host, { onSelect: (id) => selected.push(id), onToggle: (id) => toggled.push(id) });
    host.listeners.click[0](fakeEvent('[data-nothing]', { getAttribute: () => null }));
    expect(selected).toEqual([]);
    expect(toggled).toEqual([]);
  });

  it('Enter/Space on a focused node fires onSelect and prevents default scroll', () => {
    const host = fakeHost();
    const selected = [];
    wireTree(host, { onSelect: (id) => selected.push(id), onToggle() {} });
    const row = { getAttribute: (a) => (a === 'data-span-id' ? 'eval' : null) };
    const ev = fakeEvent('[data-span-id]', row, { key: 'Enter' });
    host.listeners.keydown[0](ev);
    expect(selected).toEqual(['eval']);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('ignores keydown that is not a handled key', () => {
    const host = fakeHost();
    const selected = [];
    wireTree(host, { onSelect: (id) => selected.push(id), onToggle() {} });
    const row = { getAttribute: () => 'eval' };
    host.listeners.keydown[0](fakeEvent('[data-span-id]', row, { key: 'a' }));
    expect(selected).toEqual([]);
  });
});

// ── flattenVisible: the ordered list of VISIBLE treeitems ──
//
// PURE pre-order flatten over the TraceNode forest, recursing into a node's
// children ONLY when it is not collapsed. The result drives both the arrow-key
// next-focus computation and (in the browser) the DOM walk. Each descriptor
// carries exactly the structural facts keyToAction needs: id, hasChildren,
// expanded, depth, parentId.
describe('flattenVisible — ordered visible treeitems (collapsed subtrees skipped)', () => {
  const tree = buildTraceTree({
    spans: [
      { id: 'eval', parentId: null, name: 'eval' },
      { id: 'task', parentId: 'eval', name: 'task' },
      { id: 'judge', parentId: 'task', name: 'judge' },
      { id: 's1', parentId: 'task', name: 's1' },
    ],
  }).roots;

  it('pre-orders the whole forest when nothing is collapsed', () => {
    const vis = flattenVisible(tree, new Set());
    expect(vis.map((v) => v.id)).toEqual(['eval', 'task', 'judge', 's1']);
    expect(vis.map((v) => v.depth)).toEqual([0, 1, 2, 2]);
    expect(vis.find((v) => v.id === 'eval')).toMatchObject({
      hasChildren: true,
      expanded: true,
      parentId: null,
    });
    expect(vis.find((v) => v.id === 'judge')).toMatchObject({
      hasChildren: false,
      parentId: 'task',
    });
  });

  it('skips the children of a collapsed node (but keeps the node itself)', () => {
    const vis = flattenVisible(tree, new Set(['task']));
    // task is visible (and collapsed), but its children judge/s1 are hidden.
    expect(vis.map((v) => v.id)).toEqual(['eval', 'task']);
    expect(vis.find((v) => v.id === 'task')).toMatchObject({
      hasChildren: true,
      expanded: false,
    });
  });

  it('reports parentId so keyToAction can navigate ← to a parent', () => {
    const vis = flattenVisible(tree, new Set());
    expect(vis.find((v) => v.id === 's1').parentId).toBe('task');
    expect(vis.find((v) => v.id === 'eval').parentId).toBe(null);
  });
});

// ── keyToAction: the PURE key → action mapping (the WAI-ARIA tree model) ──
//
// Given a key, the currently-focused id, and the ordered visible list,
// keyToAction returns { type, id, preventDefault } where type is one of
// 'focus' | 'select' | 'toggle' | 'none'. wireTree's single delegated keydown
// listener reads the visible list from the DOM and APPLIES the returned action
// (roving tabindex + .focus(), onSelect, or onToggle). No DOM here — pure.
describe('keyToAction — WAI-ARIA tree key model (pure)', () => {
  // eval(branch,expanded) > task(branch,expanded) > [judge(leaf), s1(leaf)]
  const visible = [
    { id: 'eval', hasChildren: true, expanded: true, depth: 0, parentId: null },
    { id: 'task', hasChildren: true, expanded: true, depth: 1, parentId: 'eval' },
    { id: 'judge', hasChildren: false, expanded: false, depth: 2, parentId: 'task' },
    { id: 's1', hasChildren: false, expanded: false, depth: 2, parentId: 'task' },
  ];

  it('ArrowDown moves focus to the next visible item', () => {
    expect(keyToAction('ArrowDown', 'eval', visible)).toMatchObject({ type: 'focus', id: 'task', preventDefault: true });
    expect(keyToAction('ArrowDown', 'judge', visible)).toMatchObject({ type: 'focus', id: 's1' });
  });

  it('ArrowDown clamps at the last item (no wrap)', () => {
    expect(keyToAction('ArrowDown', 's1', visible)).toMatchObject({ type: 'focus', id: 's1' });
  });

  it('ArrowUp moves focus to the previous visible item', () => {
    expect(keyToAction('ArrowUp', 's1', visible)).toMatchObject({ type: 'focus', id: 'judge', preventDefault: true });
  });

  it('ArrowUp clamps at the first item (no wrap)', () => {
    expect(keyToAction('ArrowUp', 'eval', visible)).toMatchObject({ type: 'focus', id: 'eval' });
  });

  it('ArrowRight on a COLLAPSED branch expands it (toggle)', () => {
    const collapsedTask = [
      { id: 'eval', hasChildren: true, expanded: true, depth: 0, parentId: null },
      { id: 'task', hasChildren: true, expanded: false, depth: 1, parentId: 'eval' },
    ];
    expect(keyToAction('ArrowRight', 'task', collapsedTask)).toMatchObject({ type: 'toggle', id: 'task', preventDefault: true });
  });

  it('ArrowRight on an EXPANDED branch moves to its first child', () => {
    expect(keyToAction('ArrowRight', 'eval', visible)).toMatchObject({ type: 'focus', id: 'task' });
  });

  it('ArrowRight on a LEAF is a no-op (but still prevents scroll)', () => {
    expect(keyToAction('ArrowRight', 'judge', visible)).toMatchObject({ type: 'none', preventDefault: true });
  });

  it('ArrowLeft on an EXPANDED branch collapses it (toggle)', () => {
    expect(keyToAction('ArrowLeft', 'task', visible)).toMatchObject({ type: 'toggle', id: 'task', preventDefault: true });
  });

  it('ArrowLeft on a LEAF moves focus to its parent', () => {
    expect(keyToAction('ArrowLeft', 'judge', visible)).toMatchObject({ type: 'focus', id: 'task' });
  });

  it('ArrowLeft on a COLLAPSED branch moves to its parent (no parent at a root → none)', () => {
    const collapsedTask = [
      { id: 'eval', hasChildren: true, expanded: true, depth: 0, parentId: null },
      { id: 'task', hasChildren: true, expanded: false, depth: 1, parentId: 'eval' },
    ];
    // collapsed branch with a parent → move to the parent.
    expect(keyToAction('ArrowLeft', 'task', collapsedTask)).toMatchObject({ type: 'focus', id: 'eval' });
    // a collapsed root has no parent → no-op.
    const rootCollapsed = [{ id: 'r', hasChildren: true, expanded: false, depth: 0, parentId: null }];
    expect(keyToAction('ArrowLeft', 'r', rootCollapsed)).toMatchObject({ type: 'none' });
  });

  it('Enter selects the focused item', () => {
    expect(keyToAction('Enter', 'judge', visible)).toMatchObject({ type: 'select', id: 'judge', preventDefault: true });
  });

  it('Space selects the focused item and prevents default (no page scroll)', () => {
    expect(keyToAction(' ', 'judge', visible)).toMatchObject({ type: 'select', id: 'judge', preventDefault: true });
  });

  it('Home focuses the first visible item, End the last', () => {
    expect(keyToAction('Home', 's1', visible)).toMatchObject({ type: 'focus', id: 'eval', preventDefault: true });
    expect(keyToAction('End', 'eval', visible)).toMatchObject({ type: 'focus', id: 's1', preventDefault: true });
  });

  it('an unhandled key yields a no-op that does not prevent default', () => {
    expect(keyToAction('a', 'eval', visible)).toMatchObject({ type: 'none', preventDefault: false });
  });

  it('a focused id absent from the visible list defaults arrows to the ends', () => {
    // Stale focus (e.g. a just-collapsed child) → ArrowDown lands on the first
    // item, ArrowUp on the last, so navigation never gets stuck.
    expect(keyToAction('ArrowDown', 'gone', visible)).toMatchObject({ type: 'focus', id: 'eval' });
    expect(keyToAction('ArrowUp', 'gone', visible)).toMatchObject({ type: 'focus', id: 's1' });
  });

  it('empty visible list → no-op for every key', () => {
    expect(keyToAction('ArrowDown', 'x', [])).toMatchObject({ type: 'none' });
    expect(keyToAction('Enter', 'x', [])).toMatchObject({ type: 'none' });
  });
});

// ── wireTree keyboard nav: the single delegated keydown drives focus/roving ──
//
// A richer fake host exposes querySelectorAll over the rendered treeitems (each
// a fake element with the attributes + a focus() spy + a tabindex setter) so the
// DOM wiring (roving tabindex + .focus() on arrow nav) is exercised without
// jsdom. The fake mirrors only the surface wireTree's keydown handler touches.
function fakeTreeItem(attrs) {
  let tabindex = attrs['tabindex'] ?? '-1';
  const el = {
    _focused: 0,
    getAttribute: (a) => (a === 'tabindex' ? tabindex : attrs[a] ?? null),
    setAttribute: (a, v) => {
      if (a === 'tabindex') tabindex = String(v);
      else attrs[a] = v;
    },
    focus() {
      this._focused += 1;
    },
  };
  return el;
}

/**
 * A fake tree host whose querySelectorAll('[role="treeitem"]') returns the
 * given fake items in document order, and whose keydown listener can be invoked
 * with a fake event whose target is one of those items.
 */
function fakeTreeHost(items) {
  const listeners = {};
  return {
    items,
    listeners,
    addEventListener(type, fn) {
      (listeners[type] ??= []).push(fn);
    },
    querySelectorAll(sel) {
      return sel === '[role="treeitem"]' ? items : [];
    },
  };
}
/** A keydown event whose target IS the given fake treeitem (target.closest returns it). */
function keydownEvent(key, targetItem) {
  return {
    key,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    target: {
      closest(sel) {
        return sel === '[data-span-id]' || sel === '[role="treeitem"]' ? targetItem : null;
      },
    },
  };
}

describe('wireTree — keyboard navigation drives roving tabindex + focus', () => {
  function setup() {
    const evalItem = fakeTreeItem({ 'data-span-id': 'eval', 'aria-expanded': 'true', tabindex: '0' });
    const taskItem = fakeTreeItem({ 'data-span-id': 'task', 'aria-expanded': 'true', tabindex: '-1' });
    const judgeItem = fakeTreeItem({ 'data-span-id': 'judge', tabindex: '-1' }); // leaf: no aria-expanded
    const host = fakeTreeHost([evalItem, taskItem, judgeItem]);
    const selected = [];
    const toggled = [];
    wireTree(host, { onSelect: (id) => selected.push(id), onToggle: (id) => toggled.push(id) });
    return { host, evalItem, taskItem, judgeItem, selected, toggled };
  }

  it('ArrowDown focuses the next item and sets roving tabindex (0 on it, -1 elsewhere)', () => {
    const { host, evalItem, taskItem, judgeItem } = setup();
    const ev = keydownEvent('ArrowDown', evalItem);
    host.listeners.keydown[0](ev);
    expect(taskItem._focused).toBe(1); // moved focus to the next visible item
    expect(taskItem.getAttribute('tabindex')).toBe('0'); // roving: focused → 0
    expect(evalItem.getAttribute('tabindex')).toBe('-1'); // others → -1
    expect(judgeItem.getAttribute('tabindex')).toBe('-1');
    expect(ev.defaultPrevented).toBe(true);
  });

  it('ArrowUp clamps at the first item', () => {
    const { host, evalItem } = setup();
    const ev = keydownEvent('ArrowUp', evalItem);
    host.listeners.keydown[0](ev);
    expect(evalItem._focused).toBe(1); // stays on the first, re-focused
  });

  it('Enter on a focused item fires onSelect (no focus move)', () => {
    const { host, taskItem, selected } = setup();
    const ev = keydownEvent('Enter', taskItem);
    host.listeners.keydown[0](ev);
    expect(selected).toEqual(['task']);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('ArrowRight on an expanded branch focuses its first child', () => {
    const { host, evalItem, taskItem } = setup();
    const ev = keydownEvent('ArrowRight', evalItem);
    host.listeners.keydown[0](ev);
    expect(taskItem._focused).toBe(1);
  });

  it('ArrowLeft on an expanded branch toggles (collapse) via onToggle', () => {
    const { host, taskItem, toggled } = setup();
    const ev = keydownEvent('ArrowLeft', taskItem);
    host.listeners.keydown[0](ev);
    expect(toggled).toEqual(['task']);
  });

  it('Home focuses the first, End the last', () => {
    const { host, evalItem, judgeItem } = setup();
    host.listeners.keydown[0](keydownEvent('End', evalItem));
    expect(judgeItem._focused).toBe(1);
    host.listeners.keydown[0](keydownEvent('Home', judgeItem));
    expect(evalItem._focused).toBe(1);
  });

  it('an unhandled key does not prevent default and moves no focus', () => {
    const { host, evalItem, taskItem } = setup();
    const ev = keydownEvent('a', evalItem);
    host.listeners.keydown[0](ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(taskItem._focused).toBe(0);
  });
});

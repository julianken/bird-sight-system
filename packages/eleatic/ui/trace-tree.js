// PURE render-time tree builder for the eleatic trace explorer.
//
// A row's `trace` blob (trace_json) is OPAQUE — eleatic invents no eval domain
// and never branches on a span's semantics. Conventionally it is a flat
// `{ spans: [...] }` envelope. buildTraceTree reconstructs a TraceNode tree from
// that flat array, tolerating three shapes:
//   1. NON-CONFORMING (no spans array, scalar, bare array) → { ok:false, roots:[] }
//      so the caller falls back to the lossless renderTrace(trace) preview. The
//      conformance gate is the SAME test ui/trace.js uses.
//   2. LEGACY id-less flat (today's producer: one `{name,input,output,usage}`
//      span, no ids) → every span is wrapped under ONE synthesized
//      `{ id:'legacy:root', name:'trace', kind:'eval' }` root, with synthesized
//      `legacy:<index>` child ids, so even legacy data shows a tree (Decision 3).
//      Synthesized ids are render-time only.
//   3. KEYED (≥1 span carries a string `id`) → spans are linked by `parentId`:
//      an ORPHAN (missing/null/unknown parentId) is PROMOTED to a root (never
//      dropped); a DUPLICATE id keeps the first and demotes the later span to a
//      root; a self-cycle / back-edge is re-rooted. A seen-set guarantees the
//      walk always TERMINATES — it never hangs on a cycle.
//
// This is the SINGLE place legacy `usage` is normalized to a canonical `metrics`
// object on the node (latencyMs→durationMs the only rename; prompt/completion
// tokens + costUsd identical). Renderers read `node.metrics` and never touch
// `span.usage`. A node carrying a canonical `span.metrics` uses it verbatim.
//
// TraceNode = {
//   id: string,             // stable id; 'legacy:<i>' for id-less spans
//   span: object,           // the ORIGINAL opaque span (renderer reads name/kind/input/output/scores)
//   metrics: object|undefined,  // NORMALIZED metrics (span.metrics, else mapped span.usage, else undefined)
//   depth: number,          // 0 at roots, +1 per level
//   children: TraceNode[],
// }
//
// Plain ESM, named export — importable by the browser (express.static) and by
// vitest in node (the trace.js / pretty.js / format.js precedent). PURE: no DOM,
// no fetch, never throws.

/** True iff `t` is the conforming `{ spans: [...] }` envelope (the trace.js gate). */
function isConforming(t) {
  return t !== null && typeof t === 'object' && Array.isArray(t.spans);
}

/**
 * Normalize a span's metrics for the node. Prefer the canonical camelCase
 * `span.metrics`; else map a legacy `span.usage` (latencyMs→durationMs the only
 * rename, the rest identical); else undefined. Never throws.
 */
function normalizeMetrics(span) {
  if (span === null || typeof span !== 'object') return undefined;
  if (span.metrics !== null && typeof span.metrics === 'object') {
    return span.metrics;
  }
  const usage = span.usage;
  if (usage === null || typeof usage !== 'object') return undefined;
  const out = {};
  if ('latencyMs' in usage) out.durationMs = usage.latencyMs;
  if ('promptTokens' in usage) out.promptTokens = usage.promptTokens;
  if ('completionTokens' in usage) out.completionTokens = usage.completionTokens;
  if ('totalTokens' in usage) out.totalTokens = usage.totalTokens;
  if ('costUsd' in usage) out.costUsd = usage.costUsd;
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Make a fresh TraceNode wrapping the original span (depth filled in the linking
 * pass). `ord` is the span's index in the original spans[] array — the stable
 * tiebreaker that preserves array order regardless of which collection a root
 * lands in (orphan vs duplicate-demoted vs cycle-broken). It is render-internal
 * and not part of the TraceNode contract renderers read.
 */
function makeNode(id, span, ord) {
  return { id, span, metrics: normalizeMetrics(span), depth: 0, children: [], ord };
}

/** A finite numeric startMs, else undefined. */
function startMs(node) {
  const m = node.metrics;
  const v = m && typeof m === 'object' ? m.startMs : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * STABLE sibling order: preserve original spans[] array order, sorting by
 * metrics.startMs ONLY when BOTH siblings carry a finite numeric startMs. The
 * `ord` (original array index) is the deterministic tiebreaker — it keeps array
 * order even for roots gathered from different collections, where insertion
 * order alone would not. Mutates `nodes` in place.
 */
function orderSiblings(nodes) {
  nodes.sort((a, b) => {
    const sa = startMs(a);
    const sb = startMs(b);
    if (sa !== undefined && sb !== undefined && sa !== sb) return sa - sb;
    return a.ord - b.ord; // not both timed (or equal) → original array order
  });
}

/**
 * Build the trace tree.
 * @returns {{ ok: boolean, roots: object[] }} PURE; never throws. ok=false ⇒
 *   caller renders renderTrace(trace) fallback.
 */
export function buildTraceTree(trace) {
  if (!isConforming(trace)) return { ok: false, roots: [] };
  const spans = trace.spans;

  // Conforming but empty → a valid (empty) tree, NOT a synthesized legacy root.
  if (spans.length === 0) return { ok: true, roots: [] };

  // LEGACY id-less branch: NO span carries a string `id`. Wrap all spans under
  // one synthesized root so even legacy data shows a tree (Decision 3).
  const hasAnyId = spans.some(
    (s) => s !== null && typeof s === 'object' && typeof s.id === 'string',
  );
  if (!hasAnyId) {
    // The legacy branch returns directly (no link/cycle pass), so build clean
    // TraceNodes without the internal `ord` tiebreaker the keyed branch needs.
    const rootSpan = { id: 'legacy:root', name: 'trace', kind: 'eval' };
    const root = {
      id: 'legacy:root',
      span: rootSpan,
      metrics: undefined, // the synthesized root carries no metrics of its own
      depth: 0,
      children: spans.map((span, i) => ({
        id: `legacy:${i}`,
        span,
        metrics: normalizeMetrics(span),
        depth: 1,
        children: [],
      })),
    };
    return { ok: true, roots: [root] };
  }

  // KEYED branch. Index by id (first wins); collect roots (orphans + duplicates
  // + cycle-breaks) and parent→child links.
  const byId = new Map();
  /** @type {object[]} nodes in encounter order whose parent must be resolved. */
  const nodes = [];
  /** @type {object[]} nodes promoted to roots (no resolvable parent). */
  const explicitRoots = [];

  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    const rawId = span !== null && typeof span === 'object' ? span.id : undefined;
    const id = typeof rawId === 'string' ? rawId : `legacy:${i}`;
    const node = makeNode(id, span, i);
    if (typeof rawId === 'string' && byId.has(rawId)) {
      // DUPLICATE id: first wins; this later span is demoted to a root and keeps
      // its (now non-indexable) id but is never attachable as a parent target.
      explicitRoots.push(node);
      continue;
    }
    byId.set(id, node);
    nodes.push(node);
  }

  // Link pass: attach each indexed node to its resolvable parent; else root it.
  const linkedRoots = [];
  for (const node of nodes) {
    const span = node.span;
    const parentId =
      span !== null && typeof span === 'object' ? span.parentId : undefined;
    const parent =
      typeof parentId === 'string' && parentId !== node.id ? byId.get(parentId) : undefined;
    if (parent === undefined) {
      // ORPHAN (missing/null/unknown parentId) OR self-cycle (parentId===id) →
      // promoted to a root, never dropped.
      linkedRoots.push(node);
    } else {
      parent.children.push(node);
    }
  }

  // Cycle break: a back-edge cycle (a→b→a) leaves every node with a resolvable
  // parent, so NONE landed in linkedRoots — yet a tree needs ≥1 root. Detect any
  // node not reachable from a current root and re-root it. The seen-set is keyed
  // on the NODE OBJECT (not its id string — a demoted-duplicate root reuses a
  // live node's id), and guarantees termination regardless of cycle length.
  const roots = [...explicitRoots, ...linkedRoots];
  const reachable = new Set();
  const markReachable = (start) => {
    const stack = [start];
    while (stack.length > 0) {
      const n = stack.pop();
      if (reachable.has(n)) continue; // seen-set on node identity: terminates on any cycle
      reachable.add(n);
      for (const c of n.children) stack.push(c);
    }
  };
  for (const r of roots) markReachable(r);
  // Any indexed node still unreachable belongs to a pure cycle with no external
  // root. Re-root them in encounter order; marking each as we go keeps the rest
  // of the cycle linked beneath the first re-rooted member.
  for (const node of nodes) {
    if (!reachable.has(node)) {
      // Sever this node from any parent that links it, so it doesn't appear
      // twice (as a re-rooted root AND as a child inside the cycle).
      for (const other of nodes) {
        const idx = other.children.indexOf(node);
        if (idx !== -1) other.children.splice(idx, 1);
      }
      roots.push(node);
      markReachable(node);
    }
  }

  // Assign depth + stable sibling order in one traversal, then drop the internal
  // `ord` so the returned node matches the TraceNode contract exactly
  // ({ id, span, metrics, depth, children }). The seen-set is belt-and-suspenders:
  // the structure is already acyclic here, but it guarantees termination even if
  // a future change reintroduced a back-edge.
  const visited = new Set();
  const assign = (node, depth) => {
    if (visited.has(node)) return; // node-identity seen-set (ids may collide)
    visited.add(node);
    node.depth = depth;
    orderSiblings(node.children);
    for (const c of node.children) assign(c, depth + 1);
    delete node.ord;
  };
  orderSiblings(roots);
  for (const r of roots) assign(r, 0);

  return { ok: true, roots };
}

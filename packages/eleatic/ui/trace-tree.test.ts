import { describe, it, expect } from 'vitest';
// buildTraceTree (ui/trace-tree.js) reconstructs a TraceNode tree from the flat,
// OPAQUE `{ spans: [...] }` trace blob (trace_json — eleatic invents no eval
// domain and never branches on a span's semantics). It is PURE and never throws:
//   - the SAME conformance gate as trace.js (object && Array.isArray(trace.spans))
//     guards the build; a non-conforming blob returns { ok:false, roots:[] } so
//     the caller can fall back to the lossless renderTrace(trace) preview.
//   - today's LEGACY id-less flat shape (one `{name,input,output,usage}` span, no
//     ids) is wrapped under one synthesized `legacy:root` so even legacy data
//     shows a tree (Decision 3); synthesized ids are render-time only.
//   - a KEYED shape (≥1 string id) links by parentId, promoting orphans to roots
//     (never dropping), demoting duplicate ids to roots (first wins), and re-
//     rooting cycles/back-edges (a seen-set guarantees termination).
//   - the SINGLE legacy `usage`→`metrics` normalization point lives here: a node's
//     `metrics` is span.metrics if present, else span.usage mapped (latencyMs→
//     durationMs the only rename), else undefined. Renderers read node.metrics.
// Importable by the browser (express.static) and by vitest in node.
import { buildTraceTree } from './trace-tree.js';

describe('buildTraceTree — conformance gate', () => {
  it('returns { ok:false, roots:[] } for null', () => {
    expect(buildTraceTree(null)).toEqual({ ok: false, roots: [] });
  });

  it('returns { ok:false, roots:[] } for a number', () => {
    expect(buildTraceTree(42)).toEqual({ ok: false, roots: [] });
  });

  it('returns { ok:false, roots:[] } for a string', () => {
    expect(buildTraceTree('x')).toEqual({ ok: false, roots: [] });
  });

  it('returns { ok:false, roots:[] } for a bare array', () => {
    expect(buildTraceTree([1, 2, 3])).toEqual({ ok: false, roots: [] });
  });

  it('returns { ok:false, roots:[] } when spans is not an array', () => {
    expect(buildTraceTree({ spans: 'not-an-array' })).toEqual({ ok: false, roots: [] });
  });

  it('returns { ok:false, roots:[] } when there is no spans key', () => {
    expect(buildTraceTree({ no: 'spans' })).toEqual({ ok: false, roots: [] });
  });

  it('returns { ok:true, roots:[] } for a conforming-but-empty spans array', () => {
    expect(buildTraceTree({ spans: [] })).toEqual({ ok: true, roots: [] });
  });
});

describe('buildTraceTree — legacy id-less flat shape (Decision 3)', () => {
  it('wraps a single id-less span under one synthesized legacy:root', () => {
    const { ok, roots } = buildTraceTree({ spans: [{ name: 'judge' }] });
    expect(ok).toBe(true);
    expect(roots).toHaveLength(1);
    const root = roots[0];
    expect(root.id).toBe('legacy:root');
    expect(root.depth).toBe(0);
    expect(root.span).toEqual({ id: 'legacy:root', name: 'trace', kind: 'eval' });
    expect(root.children).toHaveLength(1);
    const child = root.children[0];
    expect(child.id).toBe('legacy:0');
    expect(child.depth).toBe(1);
    // The child wraps the ORIGINAL opaque span object (not a copy of a synth root).
    expect(child.span).toEqual({ name: 'judge' });
  });

  it('places every id-less span under the synthesized root in array order', () => {
    const { ok, roots } = buildTraceTree({
      spans: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
    });
    expect(ok).toBe(true);
    expect(roots).toHaveLength(1);
    const root = roots[0];
    expect(root.children.map((c) => c.span.name)).toEqual(['a', 'b', 'c']);
    expect(root.children.map((c) => c.id)).toEqual(['legacy:0', 'legacy:1', 'legacy:2']);
    expect(root.children.every((c) => c.depth === 1)).toBe(true);
  });

  it('normalizes a legacy usage object to node.metrics (latencyMs→durationMs)', () => {
    const { roots } = buildTraceTree({
      spans: [
        {
          name: 'judge',
          usage: { latencyMs: 250, promptTokens: 12, completionTokens: 34, costUsd: 0.01 },
        },
      ],
    });
    const child = roots[0].children[0];
    expect(child.metrics).toEqual({
      durationMs: 250,
      promptTokens: 12,
      completionTokens: 34,
      costUsd: 0.01,
    });
  });

  it('leaves node.metrics undefined for a legacy span with no usage', () => {
    const { roots } = buildTraceTree({ spans: [{ name: 'plain' }] });
    expect(roots[0].children[0].metrics).toBeUndefined();
    // The synthesized root carries no metrics either.
    expect(roots[0].metrics).toBeUndefined();
  });
});

describe('buildTraceTree — keyed build', () => {
  it('builds eval→task→(judge, scorers) with correct depths and child order', () => {
    const { ok, roots } = buildTraceTree({
      spans: [
        { id: 'eval', parentId: null, name: 'eval', kind: 'eval' },
        { id: 'task', parentId: 'eval', name: 'task', kind: 'task' },
        { id: 'judge', parentId: 'task', name: 'judge', kind: 'llm' },
        { id: 'scorer:keep', parentId: 'task', name: 'keep', kind: 'scorer' },
        { id: 'scorer:mae', parentId: 'task', name: 'mae', kind: 'scorer' },
      ],
    });
    expect(ok).toBe(true);
    expect(roots).toHaveLength(1);
    const evalNode = roots[0];
    expect(evalNode.id).toBe('eval');
    expect(evalNode.depth).toBe(0);
    expect(evalNode.children).toHaveLength(1);
    const taskNode = evalNode.children[0];
    expect(taskNode.id).toBe('task');
    expect(taskNode.depth).toBe(1);
    // judge before scorers — original spans[] order preserved.
    expect(taskNode.children.map((c) => c.id)).toEqual(['judge', 'scorer:keep', 'scorer:mae']);
    expect(taskNode.children.every((c) => c.depth === 2)).toBe(true);
  });

  it('carries the ORIGINAL span object on each keyed node', () => {
    const span = { id: 'eval', parentId: null, name: 'eval', kind: 'eval' };
    const { roots } = buildTraceTree({ spans: [span] });
    expect(roots[0].span).toBe(span);
  });

  it('reads node.metrics from a canonical span.metrics when present', () => {
    const { roots } = buildTraceTree({
      spans: [
        {
          id: 'judge',
          parentId: null,
          name: 'judge',
          metrics: { startMs: 5, durationMs: 99, promptTokens: 1, totalTokens: 3 },
        },
      ],
    });
    expect(roots[0].metrics).toEqual({ startMs: 5, durationMs: 99, promptTokens: 1, totalTokens: 3 });
  });

  it('prefers span.metrics over span.usage when both exist', () => {
    const { roots } = buildTraceTree({
      spans: [
        {
          id: 'judge',
          parentId: null,
          name: 'judge',
          metrics: { durationMs: 11 },
          usage: { latencyMs: 999 },
        },
      ],
    });
    expect(roots[0].metrics).toEqual({ durationMs: 11 });
  });
});

describe('buildTraceTree — orphan tolerance', () => {
  it('promotes a span whose parentId is an unknown id to a root', () => {
    const { ok, roots } = buildTraceTree({
      spans: [
        { id: 'root', parentId: null, name: 'root' },
        { id: 'orphan', parentId: 'ghost', name: 'orphan' },
      ],
    });
    expect(ok).toBe(true);
    expect(roots.map((r) => r.id)).toEqual(['root', 'orphan']);
    expect(roots.every((r) => r.depth === 0)).toBe(true);
    // The orphan is never dropped.
    expect(roots).toHaveLength(2);
  });

  it('treats a missing parentId (undefined) as a root', () => {
    const { roots } = buildTraceTree({ spans: [{ id: 'lonely', name: 'lonely' }] });
    expect(roots.map((r) => r.id)).toEqual(['lonely']);
    expect(roots[0].depth).toBe(0);
  });
});

describe('buildTraceTree — duplicate ids', () => {
  it('keeps the first span for a duplicate id and demotes the later one to a root', () => {
    const { ok, roots } = buildTraceTree({
      spans: [
        { id: 'eval', parentId: null, name: 'first' },
        { id: 'child', parentId: 'eval', name: 'child' },
        { id: 'eval', parentId: null, name: 'second' },
      ],
    });
    expect(ok).toBe(true);
    // The first 'eval' wins the id; the duplicate is demoted to its own root.
    expect(roots).toHaveLength(2);
    const firstEval = roots[0];
    expect(firstEval.span.name).toBe('first');
    expect(firstEval.children.map((c) => c.span.name)).toEqual(['child']);
    const demoted = roots[1];
    expect(demoted.span.name).toBe('second');
    expect(demoted.depth).toBe(0);
    expect(demoted.children).toEqual([]);
  });
});

describe('buildTraceTree — cycle safety (always terminates)', () => {
  it('re-roots a self-cycle (parentId === id) and terminates', () => {
    const { ok, roots } = buildTraceTree({
      spans: [{ id: 'a', parentId: 'a', name: 'a' }],
    });
    expect(ok).toBe(true);
    expect(roots).toHaveLength(1);
    expect(roots[0].id).toBe('a');
    expect(roots[0].depth).toBe(0);
  });

  it('re-roots a two-node back-edge cycle and terminates', () => {
    // a parents b, b parents a — a classic 2-cycle. Exactly one becomes a root;
    // the other links under it. The key invariant: the call RETURNS (no hang).
    const result = buildTraceTree({
      spans: [
        { id: 'a', parentId: 'b', name: 'a' },
        { id: 'b', parentId: 'a', name: 'b' },
      ],
    });
    expect(result.ok).toBe(true);
    // Every span appears exactly once across the whole tree (none dropped, none
    // duplicated by the cycle break).
    const seen: string[] = [];
    const walk = (n: { id: string; children: { id: string; children: unknown[] }[] }) => {
      seen.push(n.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      n.children.forEach((c: any) => walk(c));
    };
    result.roots.forEach((r) => walk(r));
    expect(seen.sort()).toEqual(['a', 'b']);
  });

  it('terminates on a longer cycle (a→b→c→a)', () => {
    const result = buildTraceTree({
      spans: [
        { id: 'a', parentId: 'c', name: 'a' },
        { id: 'b', parentId: 'a', name: 'b' },
        { id: 'c', parentId: 'b', name: 'c' },
      ],
    });
    expect(result.ok).toBe(true);
    const seen: string[] = [];
    const walk = (n: { id: string; children: { id: string; children: unknown[] }[] }) => {
      seen.push(n.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      n.children.forEach((c: any) => walk(c));
    };
    result.roots.forEach((r) => walk(r));
    expect(seen.sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('buildTraceTree — sibling ordering', () => {
  it('preserves spans[] array order for two untimed siblings', () => {
    const { roots } = buildTraceTree({
      spans: [
        { id: 'root', parentId: null, name: 'root' },
        { id: 'second', parentId: 'root', name: 'second' },
        { id: 'first', parentId: 'root', name: 'first' },
      ],
    });
    expect(roots[0].children.map((c) => c.id)).toEqual(['second', 'first']);
  });

  it('sorts two timed siblings by metrics.startMs', () => {
    const { roots } = buildTraceTree({
      spans: [
        { id: 'root', parentId: null, name: 'root' },
        { id: 'late', parentId: 'root', name: 'late', metrics: { startMs: 200 } },
        { id: 'early', parentId: 'root', name: 'early', metrics: { startMs: 100 } },
      ],
    });
    expect(roots[0].children.map((c) => c.id)).toEqual(['early', 'late']);
  });

  it('preserves array order when one sibling lacks a finite startMs', () => {
    const { roots } = buildTraceTree({
      spans: [
        { id: 'root', parentId: null, name: 'root' },
        { id: 'timed', parentId: 'root', name: 'timed', metrics: { startMs: 100 } },
        { id: 'untimed', parentId: 'root', name: 'untimed' },
      ],
    });
    // startMs sort only applies when BOTH siblings carry a finite startMs.
    expect(roots[0].children.map((c) => c.id)).toEqual(['timed', 'untimed']);
  });

  it('preserves array order when a startMs is non-finite (NaN / Infinity)', () => {
    const { roots } = buildTraceTree({
      spans: [
        { id: 'root', parentId: null, name: 'root' },
        { id: 'b', parentId: 'root', name: 'b', metrics: { startMs: Number.NaN } },
        { id: 'a', parentId: 'root', name: 'a', metrics: { startMs: 50 } },
      ],
    });
    expect(roots[0].children.map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('also sorts timed roots by startMs', () => {
    const { roots } = buildTraceTree({
      spans: [
        { id: 'late', parentId: null, name: 'late', metrics: { startMs: 9 } },
        { id: 'early', parentId: null, name: 'early', metrics: { startMs: 1 } },
      ],
    });
    expect(roots.map((r) => r.id)).toEqual(['early', 'late']);
  });
});

describe('buildTraceTree — totality (never throws)', () => {
  it('returns an object for every input over the trace.test.ts matrix', () => {
    for (const v of [
      null,
      undefined,
      1,
      'x',
      true,
      {},
      [],
      [1, 2, 3],
      { spans: 'not-an-array' },
      { no: 'spans' },
      { spans: [] },
      { spans: [{ name: 'a' }] },
      { spans: [{ id: 'a', parentId: 'a' }] },
      { spans: [null, 42, 'str', { name: 'ok' }] },
    ]) {
      const out = buildTraceTree(v);
      expect(out).toHaveProperty('ok');
      expect(out).toHaveProperty('roots');
      expect(Array.isArray(out.roots)).toBe(true);
    }
  });

  it('tolerates non-object spans inside a conforming envelope without throwing', () => {
    // A legacy-shaped envelope (no ids) containing junk entries: still wrapped
    // under one synthesized root, junk entries carried opaquely.
    const { ok, roots } = buildTraceTree({ spans: [null, 'str', 7, { name: 'ok' }] });
    expect(ok).toBe(true);
    expect(roots).toHaveLength(1);
    expect(roots[0].id).toBe('legacy:root');
    expect(roots[0].children).toHaveLength(4);
    expect(roots[0].children.map((c) => c.id)).toEqual([
      'legacy:0',
      'legacy:1',
      'legacy:2',
      'legacy:3',
    ]);
  });
});

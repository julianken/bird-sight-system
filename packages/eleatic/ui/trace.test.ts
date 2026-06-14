import { describe, it, expect } from 'vitest';
// trace.js renders an OPAQUE per-row trace blob (trace_json — eleatic never
// destructures the eval domain) to an HTML string for the drawer's Trace
// section. A conforming `{ spans: [...] }` shape renders one labeled block per
// span (name + collapsible input/output via the escaping prettyJson unit + a
// usage line); anything else falls back to pretty-printing the whole blob. Every
// key / string value flows through pretty.js → safe.js#esc, so an injected
// payload renders inert. Importable by the browser (express.static) and vitest.
import { renderTrace, rollupTrace } from './trace.js';

describe('renderTrace — span rendering', () => {
  it('renders one labeled block per span with the span name', () => {
    const out = renderTrace({
      spans: [{ name: 'retrieve' }, { name: 'judge' }],
    });
    expect(out).toContain('retrieve');
    expect(out).toContain('judge');
    // Two span blocks.
    expect(out.match(/class="trace-span"/g)?.length).toBe(2);
  });

  it('pretty-prints a span input and output inside collapsible blocks', () => {
    const out = renderTrace({
      spans: [{ name: 'judge', input: { prompt: 'hello' }, output: { keep: true } }],
    });
    // Collapsible <details>/<summary> per the issue.
    expect(out).toContain('<details');
    expect(out).toContain('<summary');
    expect(out).toContain('input');
    expect(out).toContain('output');
    // prettyJson tree markup proves the blob was rendered, not stringified raw.
    expect(out).toContain('json-key');
    expect(out).toContain('prompt');
    expect(out).toContain('hello');
  });

  it('renders a usage line with the present metrics only, omitting absent ones', () => {
    const out = renderTrace({
      spans: [
        {
          name: 'judge',
          usage: { promptTokens: 12, completionTokens: 34, latencyMs: 250, costUsd: 0.0123 },
        },
      ],
    });
    expect(out).toContain('12');
    expect(out).toContain('34');
    expect(out).toContain('250');
    // costUsd is dollar-formatted.
    expect(out).toContain('$0.0123');
  });

  it('omits absent usage fields (only completionTokens present)', () => {
    const out = renderTrace({
      spans: [{ name: 'judge', usage: { completionTokens: 7 } }],
    });
    expect(out).toContain('7');
    // No prompt-token / latency / cost tokens leak in when absent.
    expect(out).not.toContain('promptTokens');
    expect(out).not.toContain('latencyMs');
    expect(out).not.toContain('$');
  });

  it('omits the usage line entirely when a span has no usage', () => {
    const out = renderTrace({ spans: [{ name: 'plain' }] });
    expect(out).toContain('plain');
    expect(out).not.toContain('trace-usage');
  });

  it('falls back to a span index label when a span has no name', () => {
    const out = renderTrace({ spans: [{ input: { a: 1 } }] });
    // Some non-empty label still renders (e.g. "span 0") — never an empty block.
    expect(out).toContain('trace-span');
    expect(out).toContain('span');
  });
});

describe('renderTrace — non-conforming blob fallback', () => {
  it('pretty-prints a blob with no spans array as a whole', () => {
    const out = renderTrace({ anything: 'goes', n: 1 });
    expect(out).toContain('anything');
    expect(out).toContain('goes');
    // Rendered via prettyJson (tree markup), not as a span list.
    expect(out).toContain('json-key');
    expect(out).not.toContain('trace-span');
  });

  it('pretty-prints a non-object trace (string / number / array) as a whole', () => {
    expect(renderTrace('just a string')).toContain('just a string');
    expect(renderTrace([1, 2, 3])).toContain('json-array');
    expect(renderTrace(42)).toContain('42');
  });

  it('treats spans that is not an array as a non-conforming blob', () => {
    const out = renderTrace({ spans: 'not-an-array' });
    expect(out).not.toContain('trace-span');
    expect(out).toContain('not-an-array');
  });

  it('returns a string for every input type (never throws)', () => {
    for (const v of [null, undefined, 1, 'x', true, {}, [], { spans: [] }, { spans: [{ name: 'a' }] }]) {
      expect(typeof renderTrace(v)).toBe('string');
    }
  });
});

describe('renderTrace — XSS escaping (same threat model as pretty.test.ts)', () => {
  it('neutralizes an injected payload in a span name', () => {
    const out = renderTrace({ spans: [{ name: '"><img src=x onerror=alert(1)>' }] });
    expect(out).toContain('&lt;');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('onerror=alert(1)>');
  });

  it('neutralizes an injected payload inside a span input blob', () => {
    const out = renderTrace({ spans: [{ name: 'x', input: { p: '<script>x</script>' } }] });
    expect(out).toContain('&lt;');
    expect(out).not.toContain('<script>');
  });

  it('neutralizes an injected payload in the non-conforming fallback', () => {
    const out = renderTrace({ evil: '"><img src=x onerror=alert(1)>' });
    expect(out).toContain('&lt;');
    expect(out).not.toContain('<img');
  });
});

describe('rollupTrace — per-trace structural reduction', () => {
  it('sums usage/metrics across all spans and counts them', () => {
    // An eval→task→judge+scorers tree: tokens/cost live ONLY on the judge leaf
    // (the pinned producer convention) — so the flat sum equals the judge leaf.
    const r = rollupTrace({
      spans: [
        { id: 'eval', name: 'eval' },
        { id: 'task', name: 'task' },
        {
          id: 'judge',
          name: 'judge',
          metrics: { promptTokens: 1200, completionTokens: 684, costUsd: 0.0009, durationMs: 1720 },
        },
        { id: 'scorer:a', name: 'a', scores: { a: 1 } },
        { id: 'scorer:b', name: 'b', scores: { b: 0 } },
      ],
    });
    expect(r.spanCount).toBe(5);
    expect(r.promptTokens).toBe(1200);
    expect(r.completionTokens).toBe(684);
    expect(r.totalTokens).toBe(1884);
    expect(r.costUsd).toBeCloseTo(0.0009, 10);
    expect(r.latencyMs).toBe(1720);
  });

  it('sums the same field across MULTIPLE bearing spans (no double-count guard relies on producer, but math is additive)', () => {
    const r = rollupTrace({
      spans: [
        { id: 'a', metrics: { promptTokens: 10, completionTokens: 5, costUsd: 0.001, durationMs: 100 } },
        { id: 'b', metrics: { promptTokens: 20, completionTokens: 7, costUsd: 0.002, durationMs: 250 } },
      ],
    });
    expect(r.spanCount).toBe(2);
    expect(r.promptTokens).toBe(30);
    expect(r.completionTokens).toBe(12);
    expect(r.totalTokens).toBe(42);
    expect(r.costUsd).toBeCloseTo(0.003, 10);
    expect(r.latencyMs).toBe(350);
  });

  it('omits a field that NO span carried (no costUsd:0 when no span had cost)', () => {
    const r = rollupTrace({
      spans: [{ id: 'judge', metrics: { promptTokens: 50, completionTokens: 10 } }],
    });
    expect(r.spanCount).toBe(1);
    expect(r.promptTokens).toBe(50);
    expect(r.completionTokens).toBe(10);
    expect(r.totalTokens).toBe(60);
    expect('costUsd' in r).toBe(false);
    expect('latencyMs' in r).toBe(false);
  });

  it('sets totalTokens from a lone prompt or completion (either present)', () => {
    const promptOnly = rollupTrace({ spans: [{ id: 'j', metrics: { promptTokens: 99 } }] });
    expect(promptOnly.promptTokens).toBe(99);
    expect('completionTokens' in promptOnly).toBe(false);
    expect(promptOnly.totalTokens).toBe(99);

    const completionOnly = rollupTrace({ spans: [{ id: 'j', metrics: { completionTokens: 7 } }] });
    expect('promptTokens' in completionOnly).toBe(false);
    expect(completionOnly.completionTokens).toBe(7);
    expect(completionOnly.totalTokens).toBe(7);
  });

  it('sums LEGACY usage (latencyMs) and new metrics (durationMs) both', () => {
    // A legacy flat single-span trace (today's producer) still rolls up.
    const legacy = rollupTrace({
      spans: [
        { name: 'judge', usage: { promptTokens: 12, completionTokens: 34, latencyMs: 250, costUsd: 0.0123 } },
      ],
    });
    expect(legacy.spanCount).toBe(1);
    expect(legacy.promptTokens).toBe(12);
    expect(legacy.completionTokens).toBe(34);
    expect(legacy.totalTokens).toBe(46);
    expect(legacy.latencyMs).toBe(250);
    expect(legacy.costUsd).toBeCloseTo(0.0123, 10);
  });

  it('reads latencyMs from durationMs OR usage.latencyMs across mixed spans', () => {
    const r = rollupTrace({
      spans: [
        { id: 'a', metrics: { durationMs: 100 } },
        { id: 'b', usage: { latencyMs: 50 } },
      ],
    });
    expect(r.spanCount).toBe(2);
    expect(r.latencyMs).toBe(150);
  });

  it('prefers metrics over usage on a span carrying both (no double-add)', () => {
    const r = rollupTrace({
      spans: [
        {
          id: 'j',
          metrics: { promptTokens: 100, completionTokens: 20, durationMs: 300, costUsd: 0.01 },
          usage: { promptTokens: 999, completionTokens: 999, latencyMs: 999, costUsd: 9.99 },
        },
      ],
    });
    expect(r.promptTokens).toBe(100);
    expect(r.completionTokens).toBe(20);
    expect(r.totalTokens).toBe(120);
    expect(r.latencyMs).toBe(300);
    expect(r.costUsd).toBeCloseTo(0.01, 10);
  });

  it('ignores non-finite values (NaN/Infinity) — the renderUsage num-guard', () => {
    const r = rollupTrace({
      spans: [
        { id: 'a', metrics: { promptTokens: Number.NaN, completionTokens: Infinity, costUsd: 0.5, durationMs: 100 } },
      ],
    });
    expect('promptTokens' in r).toBe(false);
    expect('completionTokens' in r).toBe(false);
    // totalTokens omitted when neither prompt nor completion is finite anywhere.
    expect('totalTokens' in r).toBe(false);
    expect(r.costUsd).toBe(0.5);
    expect(r.latencyMs).toBe(100);
  });

  it('a usage-less trace rolls up to { spanCount } only (no numeric line)', () => {
    const r = rollupTrace({ spans: [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }] });
    expect(r).toEqual({ spanCount: 2 });
  });

  it('an empty spans array → { spanCount: 0 }', () => {
    expect(rollupTrace({ spans: [] })).toEqual({ spanCount: 0 });
  });

  it('a non-conforming blob → { spanCount: 0 }, never throws', () => {
    expect(rollupTrace({ anything: 'goes' })).toEqual({ spanCount: 0 });
    expect(rollupTrace({ spans: 'not-an-array' })).toEqual({ spanCount: 0 });
    expect(rollupTrace('a string')).toEqual({ spanCount: 0 });
    expect(rollupTrace([1, 2, 3])).toEqual({ spanCount: 0 });
    expect(rollupTrace(42)).toEqual({ spanCount: 0 });
  });

  it('never throws on any garbage input and always returns a spanCount', () => {
    for (const v of [null, undefined, 1, 'x', true, {}, [], { spans: [null, 1, 'x', {}] }]) {
      const r = rollupTrace(v);
      expect(typeof r.spanCount).toBe('number');
    }
    // A spans array of garbage entries: each is a span (counted), none carries usage.
    expect(rollupTrace({ spans: [null, 1, 'x', {}] })).toEqual({ spanCount: 4 });
  });
});

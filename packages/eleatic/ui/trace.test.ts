import { describe, it, expect } from 'vitest';
// trace.js renders an OPAQUE per-row trace blob (trace_json — eleatic never
// destructures the eval domain) to an HTML string for the drawer's Trace
// section. A conforming `{ spans: [...] }` shape renders one labeled block per
// span (name + collapsible input/output via the escaping prettyJson unit + a
// usage line); anything else falls back to pretty-printing the whole blob. Every
// key / string value flows through pretty.js → safe.js#esc, so an injected
// payload renders inert. Importable by the browser (express.static) and vitest.
import { renderTrace } from './trace.js';

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

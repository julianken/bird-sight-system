import { describe, it, expect } from 'vitest';
// pretty.js renders an OPAQUE eval blob (output_json / expected_json — eleatic
// never destructures them) to an HTML string for the drawer. Every key and
// string value passes through safe.js#esc, so an injected payload inside a blob
// renders inert. Importable by the browser (express.static) and vitest in node.
import { prettyJson } from './pretty.js';

describe('prettyJson — XSS escaping (same threat model as safe.test.ts)', () => {
  it('neutralizes an injected <img onerror> payload in a string VALUE', () => {
    const out = prettyJson({ name: '"><img src=x onerror=alert(1)>' });
    expect(out).toContain('&lt;');
    expect(out).toContain('&gt;');
    expect(out).toContain('&quot;');
    // The raw payload must not survive as live markup.
    expect(out).not.toContain('<img');
    expect(out).not.toContain('onerror=alert(1)>');
  });

  it('neutralizes an injected payload in a KEY name', () => {
    const out = prettyJson({ '"><script>x</script>': 1 });
    expect(out).toContain('&lt;');
    expect(out).not.toContain('<script>');
  });

  it('escapes a payload nested deep inside arrays/objects', () => {
    const out = prettyJson({ a: [{ b: ['<x>'] }] });
    expect(out).toContain('&lt;x&gt;');
    expect(out).not.toContain('<x>');
  });
});

describe('prettyJson — value rendering', () => {
  it('renders null, numbers, and booleans verbatim (and not as escaped text fragments)', () => {
    expect(prettyJson(null)).toContain('null');
    expect(prettyJson(42)).toContain('42');
    expect(prettyJson(true)).toContain('true');
    expect(prettyJson(false)).toContain('false');
  });

  it('renders nested objects and arrays without throwing', () => {
    const blob = {
      verdict: 'keep',
      scores: { agreement: 0.91, mae: 0.04 },
      tags: ['a', 'b', 'c'],
      nested: { deep: { deeper: [1, 2, { x: null }] } },
    };
    expect(() => prettyJson(blob)).not.toThrow();
    const out = prettyJson(blob);
    expect(out).toContain('keep');
    expect(out).toContain('agreement');
    expect(out).toContain('0.91');
  });

  it('renders an empty object and an empty array', () => {
    expect(() => prettyJson({})).not.toThrow();
    expect(() => prettyJson([])).not.toThrow();
  });

  it('returns a string for every input type', () => {
    for (const v of [null, 1, 'x', true, {}, [], { a: 1 }, [1, 2]]) {
      expect(typeof prettyJson(v)).toBe('string');
    }
  });
});

import { describe, it, expect } from 'vitest';
// facet-grammar.js is plain browser ESM (served verbatim by express.static) AND
// importable here in node, exactly like safe.js / format.js. It owns the `f=`
// URL grammar (de)serializer — the only piece of the facet page with logic worth
// a unit test; the DOM controller (facets.js) is thin glue over it.
import { parseFacets, serializeFacets } from './facet-grammar.js';

// The canonical FacetFilter op set (E2 #1145, queries.ts) the grammar round-trips.
const OPS = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'contains', 'exists'] as const;

/** Build a URLSearchParams from raw `f=` tokens (+ optional extra params). */
function sp(fTokens: string[], extra: Record<string, string> = {}): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  for (const f of fTokens) p.append('f', f);
  return p;
}

describe('parseFacets / serializeFacets round-trip', () => {
  it('zero clauses → empty array, and serializing [] → empty string', () => {
    expect(parseFacets(sp([]))).toEqual([]);
    expect(serializeFacets([])).toBe('');
  });

  it('one metadata eq clause round-trips', () => {
    const clauses = parseFacets(sp(['metadata.disagreement:eq:falseKeep']));
    expect(clauses).toEqual([
      { path: 'metadata.disagreement', op: 'eq', value: 'falseKeep' },
    ]);
    // serialize → re-parse is identity.
    const re = parseFacets(new URLSearchParams(serializeFacets(clauses)));
    expect(re).toEqual(clauses);
  });

  it('one scores numeric clause coerces the value to a number', () => {
    const clauses = parseFacets(sp(['scores.agreement:gte:0.9']));
    expect(clauses).toEqual([{ path: 'scores.agreement', op: 'gte', value: 0.9 }]);
    expect(typeof (clauses[0] as { value: unknown }).value).toBe('number');
  });

  it('boolean values coerce to booleans; `exists` carries no value', () => {
    expect(parseFacets(sp(['metadata.flagged:eq:true']))).toEqual([
      { path: 'metadata.flagged', op: 'eq', value: true },
    ]);
    expect(parseFacets(sp(['scores.confidence:exists']))).toEqual([
      { path: 'scores.confidence', op: 'exists' },
    ]);
  });

  it('`in` takes a comma list and coerces each element', () => {
    const clauses = parseFacets(sp(['metadata.disagreement:in:falseKeep,falseReplace']));
    expect(clauses).toEqual([
      { path: 'metadata.disagreement', op: 'in', value: ['falseKeep', 'falseReplace'] },
    ]);
    const re = parseFacets(new URLSearchParams(serializeFacets(clauses)));
    expect(re).toEqual(clauses);
  });

  it('round-trips many clauses across every canonical op and both axes', () => {
    const clauses = OPS.map((op, i) => {
      const axis = i % 2 === 0 ? 'scores' : 'metadata';
      const path = `${axis}.k${i}`;
      if (op === 'exists') return { path, op };
      if (op === 'in') return { path, op, value: [1, 2, 3] };
      return { path, op, value: axis === 'scores' ? i * 0.1 : `v${i}` };
    });
    const re = parseFacets(new URLSearchParams(serializeFacets(clauses)));
    expect(re).toEqual(clauses);
  });

  it('preserves a value that looks empty/string, never NaN', () => {
    // contains with a textual fragment stays a string.
    expect(parseFacets(sp(['metadata.label:contains:owl']))).toEqual([
      { path: 'metadata.label', op: 'contains', value: 'owl' },
    ]);
  });
});

describe('parseFacets skips (never throws on) malformed clauses', () => {
  it('a token with no colon is skipped', () => {
    expect(parseFacets(sp(['garbage']))).toEqual([]);
  });

  it('an unknown op is skipped', () => {
    expect(parseFacets(sp(['scores.x:frobnicate:1']))).toEqual([]);
  });

  it('a value-requiring op with no value is skipped', () => {
    expect(parseFacets(sp(['scores.x:eq']))).toEqual([]);
  });

  it('an empty path is skipped', () => {
    expect(parseFacets(sp([':eq:1']))).toEqual([]);
  });

  it('keeps the good clauses and drops only the malformed ones', () => {
    const clauses = parseFacets(
      sp(['scores.agreement:gte:0.9', 'garbage', 'metadata.d:eq:falseKeep']),
    );
    expect(clauses).toEqual([
      { path: 'scores.agreement', op: 'gte', value: 0.9 },
      { path: 'metadata.d', op: 'eq', value: 'falseKeep' },
    ]);
  });

  it('does not throw on any malformed input', () => {
    expect(() => parseFacets(sp(['', ':', '::', 'a:b', 'x:in:', 'scores.x:eq']))).not.toThrow();
  });
});

import { describe, it, expect } from 'vitest';
import { toJsonOrNull, toTextOrNull, parseJson, nullableNumber } from './serde.js';

// The JSON <-> column boundary helpers. better-sqlite3 rejects `undefined` as a
// bind value, so every optional field must collapse to SQL NULL on the way in
// and re-inflate to `undefined` (NOT `null`) on the way out — that round-trip is
// what lets the record types satisfy `exactOptionalPropertyTypes`.
describe('serde', () => {
  it('toJsonOrNull maps undefined to null and serializes objects', () => {
    expect(toJsonOrNull(undefined)).toBe(null);
    expect(toJsonOrNull({ a: 1 })).toBe('{"a":1}');
  });

  it('toJsonOrNull serializes a null value distinctly from an omitted one', () => {
    // An explicit null is a real value: it serializes to the string "null".
    // An omitted (undefined) field collapses to a SQL NULL (the JS null sentinel).
    expect(toJsonOrNull(null)).toBe('null');
    expect(toJsonOrNull(undefined)).toBe(null);
  });

  it('toTextOrNull maps undefined to null and passes strings through', () => {
    expect(toTextOrNull(undefined)).toBe(null);
    expect(toTextOrNull('hi')).toBe('hi');
  });

  it('parseJson maps null to undefined and parses JSON text', () => {
    expect(parseJson(null)).toBe(undefined);
    expect(parseJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it('nullableNumber maps a DB null to undefined and passes numbers through', () => {
    expect(nullableNumber(null)).toBe(undefined);
    expect(nullableNumber(0)).toBe(0);
    expect(nullableNumber(344)).toBe(344);
  });
});

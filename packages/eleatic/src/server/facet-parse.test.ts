import { describe, it, expect } from 'vitest';
import { parseFacet } from './app.js';

describe('parseFacet', () => {
  it('parses path:op:value into a FacetFilter', () => {
    expect(parseFacet('metadata.disagreement:eq:falseKeep')).toEqual({
      path: 'metadata.disagreement',
      op: 'eq',
      value: 'falseKeep',
    });
  });

  it('coerces numeric + boolean values', () => {
    expect(parseFacet('scores.quality:gte:70')).toEqual({ path: 'scores.quality', op: 'gte', value: 70 });
    expect(parseFacet('metadata.flagged:eq:true')).toEqual({ path: 'metadata.flagged', op: 'eq', value: true });
    expect(parseFacet('metadata.flagged:eq:false')).toEqual({ path: 'metadata.flagged', op: 'eq', value: false });
  });

  it('parses the no-value `exists` op', () => {
    expect(parseFacet('scores.quality:exists')).toEqual({ path: 'scores.quality', op: 'exists' });
  });

  it('parses `in` into a coerced scalar list', () => {
    expect(parseFacet('metadata.disagreement:in:falseKeep,falseReplace')).toEqual({
      path: 'metadata.disagreement',
      op: 'in',
      value: ['falseKeep', 'falseReplace'],
    });
  });

  it('keeps a colon inside the value (only the first two colons are delimiters)', () => {
    expect(parseFacet('metadata.url:eq:https://x')).toEqual({
      path: 'metadata.url',
      op: 'eq',
      value: 'https://x',
    });
  });

  it('throws on a structurally malformed token', () => {
    expect(() => parseFacet('garbage')).toThrow();          // no colon at all
    expect(() => parseFacet('path:bogusop:v')).toThrow();    // unknown op
    expect(() => parseFacet(':eq:v')).toThrow();             // empty path
    expect(() => parseFacet('path:eq')).toThrow();           // op needs a value
  });
});

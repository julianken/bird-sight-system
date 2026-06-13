import { describe, it, expect } from 'vitest';
// staleness.js owns the adjudication staleness comparator — the one piece of the
// adjudication panel with logic. adjudicate.js renders a "stale — re-decide"
// badge when this returns true. Mirrors the server's isStale contract
// (queries.ts): a verdict with no recorded against_hash is never stale.
import { isStale } from './staleness.js';

describe('isStale', () => {
  it('both present and differ → true', () => {
    expect(isStale('h1', 'h2')).toBe(true);
  });

  it('both present and equal → false', () => {
    expect(isStale('h1', 'h1')).toBe(false);
  });

  it('no against_hash (undefined) → false — an unanchored verdict is never stale', () => {
    expect(isStale(undefined, 'h1')).toBe(false);
  });

  it('no current hash (undefined) → false — nothing to compare against', () => {
    expect(isStale('h1', undefined)).toBe(false);
  });

  it('both absent → false', () => {
    expect(isStale(undefined, undefined)).toBe(false);
  });

  it('empty-string hashes are treated as absent → false', () => {
    expect(isStale('', 'h1')).toBe(false);
    expect(isStale('h1', '')).toBe(false);
    expect(isStale('', '')).toBe(false);
  });

  it('null hashes are treated as absent → false', () => {
    expect(isStale(null, 'h1')).toBe(false);
    expect(isStale('h1', null)).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
// diff-classify.js owns the per-row diff classification — the one piece of the
// run-diff view with logic. diff.js maps each RunDiff into this input shape and
// counts the `regression` results. Importable in the browser + vitest.
import { classifyRow } from './diff-classify.js';

describe('classifyRow — presence dominates', () => {
  it('present only in B → new', () => {
    expect(classifyRow({ aPresent: false, bPresent: true, aMatched: false, bMatched: true, diverged: false })).toBe('new');
  });

  it('present only in A → removed', () => {
    expect(classifyRow({ aPresent: true, bPresent: false, aMatched: true, bMatched: false, diverged: false })).toBe('removed');
  });

  it('present in NEITHER → removed (degenerate; never both-absent in a real diff)', () => {
    // A RunDiff always has at least one side, but guard the input anyway.
    expect(classifyRow({ aPresent: false, bPresent: false, aMatched: false, bMatched: false, diverged: false }))
      .toBe('removed');
  });
});

describe('classifyRow — regression / improvement when both present', () => {
  it('matched expected in A, missed in B → regression', () => {
    expect(classifyRow({ aPresent: true, bPresent: true, aMatched: true, bMatched: false, diverged: true })).toBe('regression');
  });

  it('missed expected in A, matched in B → improvement', () => {
    expect(classifyRow({ aPresent: true, bPresent: true, aMatched: false, bMatched: true, diverged: true })).toBe('improvement');
  });

  it('both matched expected → unchanged (even if outputs diverge in shape)', () => {
    expect(classifyRow({ aPresent: true, bPresent: true, aMatched: true, bMatched: true, diverged: true })).toBe('unchanged');
  });

  it('both missed expected → unchanged (no regression — neither matched)', () => {
    expect(classifyRow({ aPresent: true, bPresent: true, aMatched: false, bMatched: false, diverged: true })).toBe('unchanged');
  });

  it('both present, identical, both matched → unchanged', () => {
    expect(classifyRow({ aPresent: true, bPresent: true, aMatched: true, bMatched: true, diverged: false })).toBe('unchanged');
  });
});

describe('classifyRow — exhaustive truth table over both-present matched combos', () => {
  // The 2×2 of (aMatched, bMatched) when both rows are present.
  const cases: Array<[boolean, boolean, string]> = [
    [true, false, 'regression'],
    [false, true, 'improvement'],
    [true, true, 'unchanged'],
    [false, false, 'unchanged'],
  ];
  for (const [aMatched, bMatched, expected] of cases) {
    it(`aMatched=${aMatched} bMatched=${bMatched} → ${expected}`, () => {
      expect(classifyRow({ aPresent: true, bPresent: true, aMatched, bMatched, diverged: true })).toBe(expected);
    });
  }
});

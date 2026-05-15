import { describe, expect, it } from 'vitest';
import { pickGridShape, toPositiveInt, visibleCapacity } from './adaptive-grid';

describe('toPositiveInt', () => {
  it('returns the value for a positive integer', () => {
    expect(toPositiveInt(1)).toBe(1);
    expect(toPositiveInt(42)).toBe(42);
  });
  it('throws on zero', () => {
    expect(() => toPositiveInt(0)).toThrow(/must be a positive integer/i);
  });
  it('throws on negative', () => {
    expect(() => toPositiveInt(-1)).toThrow(/must be a positive integer/i);
  });
  it('throws on non-integer', () => {
    expect(() => toPositiveInt(1.5)).toThrow(/must be a positive integer/i);
  });
});

describe('pickGridShape', () => {
  // Desktop, no overflow
  it('1 family → 1×1', () => {
    expect(pickGridShape(1, 1, false)).toEqual({ tag: 'grid', cols: 1, rows: 1 });
  });
  it('2 families → 2×1', () => {
    expect(pickGridShape(2, 2, false)).toEqual({ tag: 'grid', cols: 2, rows: 1 });
  });
  it('3 families → 2×2', () => {
    expect(pickGridShape(3, 3, false)).toEqual({ tag: 'grid', cols: 2, rows: 2 });
  });
  it('4 families → 2×2', () => {
    expect(pickGridShape(4, 4, false)).toEqual({ tag: 'grid', cols: 2, rows: 2 });
  });
  it('5 families → 3×3', () => {
    expect(pickGridShape(5, 5, false)).toEqual({ tag: 'grid', cols: 3, rows: 3 });
  });
  it('9 families → 3×3', () => {
    expect(pickGridShape(9, 9, false)).toEqual({ tag: 'grid', cols: 3, rows: 3 });
  });
  it('10 families → 4×4', () => {
    expect(pickGridShape(10, 10, false)).toEqual({ tag: 'grid', cols: 4, rows: 4 });
  });
  it('16 families → 4×4', () => {
    expect(pickGridShape(16, 16, false)).toEqual({ tag: 'grid', cols: 4, rows: 4 });
  });

  // Pill caps — family-cap alone
  it('family cap fires alone (17 families, 30 obs)', () => {
    expect(pickGridShape(17, 30, false)).toEqual({ tag: 'pill' });
  });

  // Pill caps — count-cap alone
  it('count cap fires alone (8 families, 65 obs)', () => {
    expect(pickGridShape(8, 65, false)).toEqual({ tag: 'pill' });
  });

  // Boundary: count=64 inclusive
  it('count = 64 inclusive does NOT trigger pill', () => {
    expect(pickGridShape(8, 64, false)).toEqual({ tag: 'grid', cols: 3, rows: 3 });
  });

  // Boundary: count=65 with families=16 (locks > vs >= mutation)
  it('count = 65 with families = 16 → pill', () => {
    expect(pickGridShape(16, 65, false)).toEqual({ tag: 'pill' });
  });

  // Boundary: max grid
  it('families = 16, count = 64 → 4×4 (max grid, no pill)', () => {
    expect(pickGridShape(16, 64, false)).toEqual({ tag: 'grid', cols: 4, rows: 4 });
  });

  // Mobile cap
  it('mobile cap: 12 families → grid-overflow 3×3 with hiddenCount 4', () => {
    expect(pickGridShape(12, 12, true)).toEqual({
      tag: 'grid-overflow', cols: 3, rows: 3, hiddenCount: 4,
    });
  });

  // Mobile boundary: 8 families (no overflow)
  it('mobile: 8 families fits 3×3 exactly, no overflow', () => {
    expect(pickGridShape(8, 8, true)).toEqual({ tag: 'grid', cols: 3, rows: 3 });
  });

  // Mobile boundary: 9 families (first overflow)
  it('mobile: 9 families → grid-overflow with hiddenCount 1', () => {
    expect(pickGridShape(9, 9, true)).toEqual({
      tag: 'grid-overflow', cols: 3, rows: 3, hiddenCount: 1,
    });
  });
});

describe('visibleCapacity', () => {
  it('grid → cols * rows', () => {
    expect(visibleCapacity({ tag: 'grid', cols: 4, rows: 4 })).toBe(16);
    expect(visibleCapacity({ tag: 'grid', cols: 2, rows: 1 })).toBe(2);
  });
  it('grid-overflow → cols * rows - 1 (reserved for "+N")', () => {
    expect(
      visibleCapacity({ tag: 'grid-overflow', cols: 3, rows: 3, hiddenCount: toPositiveInt(4) }),
    ).toBe(8);
  });
});

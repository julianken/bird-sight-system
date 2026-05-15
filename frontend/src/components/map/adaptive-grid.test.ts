import { describe, expect, it } from 'vitest';
import { toPositiveInt } from './adaptive-grid';

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

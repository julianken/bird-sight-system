import { describe, expect, it } from 'vitest';
import { countNoun, formatCount } from './format-count.js';

describe('formatCount', () => {
  it('formats small numbers without separators', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(1)).toBe('1');
    expect(formatCount(999)).toBe('999');
  });

  it('formats 4-digit numbers with a separator', () => {
    expect(formatCount(1000)).toBe('1,000');
    expect(formatCount(1648)).toBe('1,648');
  });

  it('formats large numbers with separators (241966 → "241,966")', () => {
    expect(formatCount(241966)).toBe('241,966');
  });

  it('formats 5-digit count (16626 → "16,626")', () => {
    expect(formatCount(16626)).toBe('16,626');
  });

  it('formats 7-digit numbers', () => {
    expect(formatCount(1234567)).toBe('1,234,567');
  });
});

describe('countNoun', () => {
  it('singular: countNoun(1, "observation") → "1 observation"', () => {
    expect(countNoun(1, 'observation')).toBe('1 observation');
  });

  it('plural with default +s: countNoun(2, "observation") → "2 observations"', () => {
    expect(countNoun(2, 'observation')).toBe('2 observations');
  });

  it('plural with custom plural: countNoun(16626, "sighting") → "16,626 sightings"', () => {
    expect(countNoun(16626, 'sighting')).toBe('16,626 sightings');
  });

  it('zero uses plural form', () => {
    expect(countNoun(0, 'sighting')).toBe('0 sightings');
  });

  it('custom plural form overrides default', () => {
    expect(countNoun(1, 'family', 'families')).toBe('1 family');
    expect(countNoun(3, 'family', 'families')).toBe('3 families');
  });

  it('singular with count=1 uses singular noun regardless of plural arg', () => {
    expect(countNoun(1, 'observation', 'observations')).toBe('1 observation');
  });

  it('formats 4-digit count with separator in noun phrase', () => {
    expect(countNoun(1000, 'observation')).toBe('1,000 observations');
  });
});

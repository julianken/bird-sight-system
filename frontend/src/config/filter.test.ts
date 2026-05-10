import { describe, it, expect } from 'vitest';
import {
  FILTER_SENTENCE_DEBOUNCE_MS,
  FILTER_SENTENCE_CLEAR_HOLD_MS,
} from './filter.js';

describe('filter config', () => {
  it('FILTER_SENTENCE_DEBOUNCE_MS is 500', () => {
    expect(FILTER_SENTENCE_DEBOUNCE_MS).toBe(500);
  });

  it('FILTER_SENTENCE_CLEAR_HOLD_MS is 1500', () => {
    expect(FILTER_SENTENCE_CLEAR_HOLD_MS).toBe(1500);
  });

  it('clear-hold is longer than debounce (SR announcement after settle)', () => {
    expect(FILTER_SENTENCE_CLEAR_HOLD_MS).toBeGreaterThan(FILTER_SENTENCE_DEBOUNCE_MS);
  });
});

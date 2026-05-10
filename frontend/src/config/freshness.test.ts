import { describe, it, expect } from 'vitest';
import {
  FRESHNESS_FRESH_MAX_MS,
  FRESHNESS_RECENT_MAX_MS,
  FRESHNESS_STALE_MIN_MS,
} from './freshness.js';

describe('freshness config', () => {
  it('FRESHNESS_FRESH_MAX_MS is 30 minutes in ms', () => {
    expect(FRESHNESS_FRESH_MAX_MS).toBe(30 * 60 * 1000);
  });

  it('FRESHNESS_RECENT_MAX_MS is 6 hours in ms', () => {
    expect(FRESHNESS_RECENT_MAX_MS).toBe(6 * 60 * 60 * 1000);
  });

  it('FRESHNESS_STALE_MIN_MS is one ms beyond recent threshold', () => {
    expect(FRESHNESS_STALE_MIN_MS).toBe(FRESHNESS_RECENT_MAX_MS + 1);
  });

  it('fresh < recent < stale ordering is preserved', () => {
    expect(FRESHNESS_FRESH_MAX_MS).toBeLessThan(FRESHNESS_RECENT_MAX_MS);
    expect(FRESHNESS_RECENT_MAX_MS).toBeLessThan(FRESHNESS_STALE_MIN_MS);
  });
});

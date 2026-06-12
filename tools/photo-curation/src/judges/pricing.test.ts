import { describe, it, expect } from 'vitest';
import { MODEL_PRICING, estimateCostUsd } from './pricing.js';

describe('MODEL_PRICING', () => {
  // The eval candidates named in #1088 that Google publishes a paid per-token
  // rate for must be priced; the ones with no published paid rate must be
  // ABSENT (so estimateCostUsd returns undefined and the run warns, never $0).
  it('prices every Gemini eval candidate with a published paid rate', () => {
    for (const model of [
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-2.5-pro',
      'gemini-3.5-flash',
      'gemini-3.1-flash-lite',
      'gemini-3.1-pro-preview',
    ]) {
      const price = MODEL_PRICING[model];
      expect(price, `${model} must be in MODEL_PRICING`).toBeTruthy();
      expect(price!.inputPerMTok).toBeGreaterThan(0);
      expect(price!.outputPerMTok).toBeGreaterThan(0);
    }
  });

  it('omits models with no published paid per-token rate (free-tier-only / discontinued)', () => {
    // gemini-3-flash-preview is free-tier-only; gemini-3-pro-preview is
    // discontinued. Neither has a paid USD rate to charge against, so per the
    // "never fabricate a cost" rule they are absent → treated as unpriced.
    expect(MODEL_PRICING['gemini-3-flash-preview']).toBeUndefined();
    expect(MODEL_PRICING['gemini-3-pro-preview']).toBeUndefined();
  });
});

describe('estimateCostUsd', () => {
  it('prices known tokens at the model rate (1M in + 1M out = input+output rate)', () => {
    // gemini-2.5-flash: $0.30 / 1M input, $2.50 / 1M output.
    expect(estimateCostUsd('gemini-2.5-flash', 1_000_000, 1_000_000)).toBeCloseTo(2.8, 10);
  });

  it('scales linearly below 1M tokens', () => {
    // 500k in × $0.30/1M = $0.15; 200k out × $2.50/1M = $0.50; total $0.65.
    expect(estimateCostUsd('gemini-2.5-flash', 500_000, 200_000)).toBeCloseTo(0.65, 10);
  });

  it('returns 0 for zero tokens on a priced model', () => {
    expect(estimateCostUsd('gemini-2.5-flash', 0, 0)).toBe(0);
  });

  it('returns undefined for an unpriced (unknown) model — never fabricates a cost', () => {
    expect(estimateCostUsd('gemini-3-flash-preview', 1000, 1000)).toBeUndefined();
    expect(estimateCostUsd('totally-made-up-model', 1000, 1000)).toBeUndefined();
  });
});

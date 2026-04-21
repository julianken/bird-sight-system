import { describe, it, expect } from 'vitest';
import { formatCoords } from './format-coords.js';

/**
 * formatCoords is a pure helper — no timezone or locale dependencies — so
 * tests assert literal strings. The format pins TWO decimals + hemisphere
 * letter on both axes; regressing either shape is a user-visible bug in
 * every hotspot row.
 */
describe('formatCoords', () => {
  it('formats northern hemisphere lat with N suffix', () => {
    // Arizona — Sabino Canyon-ish. Positive lat → N.
    expect(formatCoords(32.321, -110.872)).toBe('32.32°N, 110.87°W');
  });

  it('formats southern hemisphere lat with S suffix', () => {
    // Patagonian eBird hotspot. Negative lat → S.
    expect(formatCoords(-41.12, -71.3)).toBe('41.12°S, 71.30°W');
  });

  it('formats eastern hemisphere lng with E suffix', () => {
    // Positive lng → E. Europe / Africa / Asia.
    expect(formatCoords(48.85, 2.35)).toBe('48.85°N, 2.35°E');
  });

  it('formats western hemisphere lng with W suffix', () => {
    // The Arizona default. Negative lng → W.
    expect(formatCoords(31.51, -110.35)).toBe('31.51°N, 110.35°W');
  });

  it('pads to exactly two decimals even when the input rounds cleanly', () => {
    // 32.5 must render as "32.50", not "32.5". toFixed(2) handles this but
    // a naive Math.round-then-format would drop the trailing zero.
    expect(formatCoords(32.5, -110)).toBe('32.50°N, 110.00°W');
  });

  it('renders 0,0 with N/E suffixes (positive-zero convention)', () => {
    // JS treats 0 === -0 at the >= boundary — formatCoords treats lat=0 as
    // N and lng=0 as E. This is a convention choice, not a right/wrong
    // answer, but the assertion pins it so a future refactor that flips
    // the comparison to `> 0` is caught by the test suite.
    expect(formatCoords(0, 0)).toBe('0.00°N, 0.00°E');
  });
});

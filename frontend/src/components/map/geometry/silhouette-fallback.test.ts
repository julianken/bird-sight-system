import { describe, it, expect } from 'vitest';
import {
  FALLBACK_SILHOUETTE_PATH,
  isValidSvgPathData,
} from './silhouette-fallback.js';

describe('FALLBACK_SILHOUETTE_PATH', () => {
  it('passes its own charset validator (round-trip)', () => {
    // Sanity: the constant must itself be valid input — otherwise the
    // fallback substitution path in silhouettePathToSvg would also fail.
    expect(isValidSvgPathData(FALLBACK_SILHOUETTE_PATH)).toBe(true);
  });
});

describe('isValidSvgPathData', () => {
  /* ── Positive cases — real path-d strings the migration has shipped ── */

  it('accepts a simple moveto/lineto/closepath path', () => {
    expect(isValidSvgPathData('M0 0L1 1Z')).toBe(true);
  });

  it('accepts the FALLBACK_SILHOUETTE_PATH (arc + close + decimals)', () => {
    expect(isValidSvgPathData('M12 4 a8 8 0 1 0 0.0001 0 z')).toBe(true);
  });

  it('accepts cubic-bezier curves with negative coordinates', () => {
    expect(
      isValidSvgPathData('M-10 -5 C-5 -5 0 -10 5 -5 S15 0 20 -5 Z'),
    ).toBe(true);
  });

  it('accepts scientific-notation coordinates (eE exponents)', () => {
    expect(isValidSvgPathData('M1.5e2 0L0 1e-3Z')).toBe(true);
  });

  /* ── Negative cases — XML-breaking + XSS-shaped inputs ─────────────── */

  it('rejects path data containing a literal double-quote', () => {
    // Bot review on PR #270 named this exact corruption case: a stray `"`
    // closes the surrounding `d="..."` attribute and breaks the SVG.
    expect(isValidSvgPathData('M12 4 L20 20 "')).toBe(false);
  });

  it('rejects path data containing an embedded <script> XSS payload', () => {
    expect(
      isValidSvgPathData('M12 4 L20 20 "<script>alert(1)</script>'),
    ).toBe(false);
  });

  it('rejects path data containing a literal "</path>" substring', () => {
    expect(isValidSvgPathData('M12 4 L20 20 </path>')).toBe(false);
  });

  it('rejects path data containing an ampersand (XML entity character)', () => {
    expect(isValidSvgPathData('M0 0 L1 1 & ')).toBe(false);
  });

  it('rejects path data containing newlines or tabs', () => {
    expect(isValidSvgPathData('M0 0\nL1 1')).toBe(false);
    expect(isValidSvgPathData('M0 0\tL1 1')).toBe(false);
  });

  it('rejects an empty string (path-data grammar requires ≥1 command)', () => {
    expect(isValidSvgPathData('')).toBe(false);
  });

  it('rejects path data containing a non-ASCII character', () => {
    expect(isValidSvgPathData('M0 0 L1 1  ')).toBe(false);
  });
});

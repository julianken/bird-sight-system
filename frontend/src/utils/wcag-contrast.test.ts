import { describe, it, expect } from 'vitest';
import { relativeLuminance, contrastRatio } from './wcag-contrast.js';

describe('relativeLuminance', () => {
  it('returns 0 for pure black', () => {
    expect(relativeLuminance('#000000')).toBe(0);
  });

  it('returns 1 for pure white', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
  });

  it('returns 1 for pure white (uppercase)', () => {
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 10);
  });
});

describe('contrastRatio', () => {
  it('returns 21 for black vs white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });

  it('returns 1 for identical colors (white vs white)', () => {
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 10);
  });

  it('returns 1 for identical colors (black vs black)', () => {
    expect(contrastRatio('#000000', '#000000')).toBeCloseTo(1, 10);
  });

  it('is symmetric — order of arguments does not affect result', () => {
    const a = contrastRatio('#7a5028', '#f4f1ea');
    const b = contrastRatio('#f4f1ea', '#7a5028');
    expect(a).toBeCloseTo(b, 10);
  });

  it('known-good audit value: odontophoridae #7a5028 vs cream #f4f1ea ≈ 6.19:1', () => {
    // Computed via WCAG 2.2 sRGB formula:
    // #7a5028 → R=0.4745, G=0.3137, B=0.1569
    // linearised → R≈0.1983, G≈0.0820, B≈0.0199
    // L = 0.2126*0.1983 + 0.7152*0.0820 + 0.0722*0.0199 ≈ 0.1026
    // #f4f1ea → L ≈ 0.9019
    // ratio = (0.9019 + 0.05) / (0.1026 + 0.05) ≈ 6.19
    const ratio = contrastRatio('#7a5028', '#f4f1ea');
    expect(ratio).toBeGreaterThan(6.0);
    expect(ratio).toBeLessThan(6.4);
  });
});

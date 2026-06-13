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

  // B2 (#1041): short-hex expansion — #444 expands to #444444 before slicing.
  // Without the fix, hexToSRGB('#444') slices h='444' to h.slice(0,2)='44',
  // h.slice(2,4)='4' (length 1), parseInt('4x', 16) — the last channel was
  // being read from h.slice(4,6) = '' → parseInt('', 16) → NaN → luminance NaN.
  it('3-digit short hex (#444) expands correctly — no NaN', () => {
    // #444 → #444444: R=G=B=68/255.  Luminance must be a finite number > 0.
    const lum = relativeLuminance('#444');
    expect(Number.isFinite(lum)).toBe(true);
    expect(lum).toBeGreaterThan(0);
  });

  it('3-digit short hex matches its 6-digit equivalent', () => {
    // #444 and #444444 must produce identical luminance and contrast.
    expect(relativeLuminance('#444')).toBeCloseTo(relativeLuminance('#444444'), 10);
    expect(contrastRatio('#444', '#ffffff')).toBeCloseTo(
      contrastRatio('#444444', '#ffffff'),
      10,
    );
  });

  // B2 (#1041): chip contrast assertions — --color-text-body on --color-bg-inset.
  // Resolved hex constants (pinned for auditability; match tokens.css values):
  //   light: text-body #444 (→ #444444) on bg-inset #f0ebe0 — must ≥ 4.5:1
  //   dark:  text-body #d8dee8 on bg-inset #253050          — must ≥ 4.5:1
  it('B2 chip light: --color-text-body (#444444) on --color-bg-inset (#f0ebe0) ≥ 4.5:1', () => {
    // light: #444444 on cream chip #f0ebe0
    // Contrast ≈ 8.19:1 (WAI WCAG calculator verified)
    const ratio = contrastRatio('#444444', '#f0ebe0');
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('B2 chip dark: --color-text-body (#d8dee8) on --color-bg-inset (#253050) ≥ 4.5:1', () => {
    // dark: #d8dee8 on skeleton-highlight #253050
    // Contrast ≈ 9.60:1 (WAI WCAG calculator verified)
    const ratio = contrastRatio('#d8dee8', '#253050');
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});

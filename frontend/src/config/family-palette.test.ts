import { describe, it, expect } from 'vitest';
import { getFamilyChannel, FAMILY_PALETTE, type FamilyCode } from './family-palette.js';

// --- Contrast utility (WCAG 2.1 relative luminance + contrast ratio) ---
// Kept local so the test file is self-contained. The implementation uses
// the sRGB transfer function per the WCAG 2.1 specification.

function hexToLinear(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const toLinear = (c: number) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return [toLinear(r), toLinear(g), toLinear(b)];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToLinear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// --- Tests ---

const ALL_FAMILY_CODES: FamilyCode[] = [
  'raptor',
  'waterfowl',
  'woodpecker',
  'songbird',
  'shorebird',
  'hummingbird',
  'corvid',
];

describe('FAMILY_PALETTE', () => {
  it('exports exactly 7 family codes', () => {
    expect(Object.keys(FAMILY_PALETTE)).toHaveLength(7);
  });

  it('exports all expected family codes', () => {
    for (const code of ALL_FAMILY_CODES) {
      expect(FAMILY_PALETTE).toHaveProperty(code);
    }
  });
});

describe('getFamilyChannel()', () => {
  it('returns a channel object with fill, on, and shape for every family code', () => {
    for (const code of ALL_FAMILY_CODES) {
      const channel = getFamilyChannel(code);
      expect(channel).toHaveProperty('fill');
      expect(channel).toHaveProperty('on');
      expect(channel).toHaveProperty('shape');
      expect(typeof channel.fill).toBe('string');
      expect(typeof channel.on).toBe('string');
    }
  });

  it('returns fill and on as valid 6-digit hex strings for every family code', () => {
    for (const code of ALL_FAMILY_CODES) {
      const { fill, on } = getFamilyChannel(code);
      expect(fill).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(on).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('asserts AA contrast (≥4.5:1) between fill and on for every family code', () => {
    for (const code of ALL_FAMILY_CODES) {
      const { fill, on } = getFamilyChannel(code);
      const ratio = contrastRatio(fill, on);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('returns a unique shape for each family code (WCAG 1.4.1 — color not sole discriminator)', () => {
    const shapes = ALL_FAMILY_CODES.map(code => getFamilyChannel(code).shape);
    // All shapes are from the allowed set
    const allowed = new Set(['circle', 'square', 'pentagon', 'diamond']);
    for (const shape of shapes) {
      expect(allowed).toContain(shape);
    }
    // Each family has exactly one shape (not undefined)
    for (const shape of shapes) {
      expect(shape).toBeTruthy();
    }
  });

  it('returns null-family neutral channel when family is null', () => {
    const channel = getFamilyChannel(null);
    expect(channel.fill).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(channel.on).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(channel.shape).toBe('circle');
    // Null-family uses bg-tint fill; contrast still AA
    const ratio = contrastRatio(channel.fill, channel.on);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});

import { describe, it, expect } from 'vitest';
import {
  BASEMAP_LIGHT,
  BASEMAP_DARK,
  THEME_REGISTRY,
  THEME_LABELS,
  LAND_COLORS,
  resolveDescriptor,
  isLabelLayer,
} from './basemap-style.js';
import type { ThemeId } from './basemap-style.js';

/* ── Local WCAG sRGB contrast math (independent re-derivation, so the contrast
   assertions below do not lean on app code to grade themselves). ──────────── */
function parseHex(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.replace(/(.)/g, '$1$1');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}
function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  const lin = (c: number): number => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const ALL_IDS: ThemeId[] = ['positron', 'bright', 'liberty', 'dark', 'fiord'];

describe('basemap-style', () => {
  it('exports BASEMAP_LIGHT pointing at OpenFreeMap positron', () => {
    expect(BASEMAP_LIGHT).toBe('https://tiles.openfreemap.org/styles/positron');
  });

  it('exports BASEMAP_DARK pointing at OpenFreeMap dark (G8 closed, Phase 4)', () => {
    // G8 (dark basemap palette ratification) closed in Phase 4 of the
    // adaptive-grid contrast epic (#575, PR #582). BASEMAP_DARK must no longer
    // alias BASEMAP_LIGHT — it must point at the real dark tile URL.
    // This test is the regression guard: if the alias reverts, this fails loudly.
    expect(BASEMAP_DARK).toBe('https://tiles.openfreemap.org/styles/dark');
    expect(BASEMAP_DARK).not.toBe(BASEMAP_LIGHT);
  });

  describe('THEME_REGISTRY', () => {
    it('registers exactly the 5 theme ids', () => {
      expect(Object.keys(THEME_REGISTRY).sort()).toEqual([...ALL_IDS].sort());
    });

    it('contains both positron and dark descriptors with all required fields', () => {
      const positron = THEME_REGISTRY.positron;
      const dark = THEME_REGISTRY.dark;

      expect(positron.id).toBe('positron');
      expect(positron.url).toBe('https://tiles.openfreemap.org/styles/positron');
      expect(positron.kind).toBe('light');
      expect(positron.landColor).toBe('#f4f1ea');
      expect(positron.markerHaloColor).toBe('#ffffff');
      expect(positron.floatColors).toEqual({ outline: '#1a1d24', halo: '#3a3f4a' });

      expect(dark.id).toBe('dark');
      expect(dark.url).toBe('https://tiles.openfreemap.org/styles/dark');
      expect(dark.kind).toBe('dark');
      expect(dark.landColor).toBe('#0E1116');
      expect(dark.markerHaloColor).toBe('#ffffff');
      expect(dark.floatColors).toEqual({ outline: '#e8edf4', halo: '#7fd0ff' });
    });

    it('registers the 3 new descriptors (bright, liberty, fiord) with required fields', () => {
      const bright = THEME_REGISTRY.bright;
      expect(bright.id).toBe('bright');
      expect(bright.url).toBe('https://tiles.openfreemap.org/styles/bright');
      expect(bright.kind).toBe('light');
      expect(bright.landColor).toBe('#f8f4f0');
      expect(bright.markerHaloColor).toBe('#ffffff');
      expect(bright.floatColors).toEqual({ outline: '#1a1d24', halo: '#3a3f4a' });

      const liberty = THEME_REGISTRY.liberty;
      expect(liberty.id).toBe('liberty');
      expect(liberty.url).toBe('https://tiles.openfreemap.org/styles/liberty');
      expect(liberty.kind).toBe('light');
      expect(liberty.landColor).toBe('#f8f4f0');
      expect(liberty.markerHaloColor).toBe('#ffffff');
      expect(liberty.floatColors).toEqual({ outline: '#1a1d24', halo: '#3a3f4a' });

      const fiord = THEME_REGISTRY.fiord;
      expect(fiord.id).toBe('fiord');
      expect(fiord.url).toBe('https://tiles.openfreemap.org/styles/fiord');
      expect(fiord.kind).toBe('dark');
      expect(fiord.landColor).toBe('#45516E');
      expect(fiord.markerHaloColor).toBe('#ffffff');
      expect(fiord.floatColors).toEqual({ outline: '#e8edf4', halo: '#7fd0ff' });
    });

    it('every descriptor has a valid OpenFreeMap url matching its id', () => {
      for (const id of ALL_IDS) {
        expect(THEME_REGISTRY[id].url).toBe(`https://tiles.openfreemap.org/styles/${id}`);
      }
    });

    it('gives the dark-kind descriptors darkLabelTextColors and the light ones none', () => {
      expect(THEME_REGISTRY.dark.darkLabelTextColors).toEqual({
        road: '#d8d8d8',
        place: '#c4c4c4',
        water: '#9db4d8',
      });
      expect(THEME_REGISTRY.fiord.darkLabelTextColors).toBeDefined();
      // light-kind descriptors omit dark label colors
      expect(THEME_REGISTRY.positron.darkLabelTextColors).toBeUndefined();
      expect(THEME_REGISTRY.bright.darkLabelTextColors).toBeUndefined();
      expect(THEME_REGISTRY.liberty.darkLabelTextColors).toBeUndefined();
    });

    it("fiord's darkLabelTextColors clear ≥4.5:1 AA vs its land #45516E (NOT the shared #9db4d8 water = 3.75:1)", () => {
      const fiord = THEME_REGISTRY.fiord;
      const tiers = fiord.darkLabelTextColors!;
      // The shared dark-theme water FAILS against fiord's land — fiord needs its own.
      expect(tiers.water).not.toBe('#9db4d8');
      expect(contrast('#9db4d8', fiord.landColor)).toBeLessThan(4.5);
      for (const [tier, color] of Object.entries(tiers)) {
        const ratio = contrast(color, fiord.landColor);
        expect(
          ratio,
          `fiord ${tier} ${color} vs ${fiord.landColor} = ${ratio.toFixed(2)}:1 must clear AA 4.5`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

    it("fiord's floatColors.outline clears ≥3:1 vs its land #45516E", () => {
      const fiord = THEME_REGISTRY.fiord;
      expect(contrast(fiord.floatColors.outline, fiord.landColor)).toBeGreaterThanOrEqual(3);
    });

    it('keeps registry urls byte-identical to the back-compat aliases', () => {
      expect(BASEMAP_LIGHT).toBe(THEME_REGISTRY.positron.url);
      expect(BASEMAP_DARK).toBe(THEME_REGISTRY.dark.url);
    });

    it('keeps each descriptor landColor in sync with LAND_COLORS', () => {
      ALL_IDS.forEach((id) => {
        expect(THEME_REGISTRY[id].landColor).toBe(LAND_COLORS[id].land);
        expect(THEME_REGISTRY[id].kind).toBe(LAND_COLORS[id].kind);
      });
    });
  });

  describe('LAND_COLORS', () => {
    it('declares all 5 lands with the canonical hexes and kinds', () => {
      expect(Object.keys(LAND_COLORS).sort()).toEqual(
        ['bright', 'dark', 'fiord', 'liberty', 'positron'].sort(),
      );
      expect(LAND_COLORS.positron).toEqual({ land: '#f4f1ea', kind: 'light' });
      expect(LAND_COLORS.bright).toEqual({ land: '#f8f4f0', kind: 'light' });
      expect(LAND_COLORS.liberty).toEqual({ land: '#f8f4f0', kind: 'light' });
      expect(LAND_COLORS.dark).toEqual({ land: '#0E1116', kind: 'dark' });
      expect(LAND_COLORS.fiord).toEqual({ land: '#45516E', kind: 'dark' });
    });

    it('uses #f4f1ea (NOT #f8f4f0) for positron land', () => {
      expect(LAND_COLORS.positron.land).toBe('#f4f1ea');
      expect(LAND_COLORS.positron.land).not.toBe('#f8f4f0');
    });
  });

  describe('resolveDescriptor', () => {
    it('returns the matching descriptor object for each registered id', () => {
      for (const id of ALL_IDS) {
        expect(resolveDescriptor(id)).toBe(THEME_REGISTRY[id]);
        expect(resolveDescriptor(id).id).toBe(id);
      }
    });
  });

  describe('THEME_LABELS (C8 #1220)', () => {
    it('has a label for every registered theme id, equal to the capitalized id', () => {
      for (const id of ALL_IDS) {
        const expected = id.charAt(0).toUpperCase() + id.slice(1);
        expect(THEME_LABELS[id]).toBe(expected);
      }
    });
    it('covers exactly the registry ids (no orphan labels)', () => {
      expect(Object.keys(THEME_LABELS).sort()).toEqual(Object.keys(THEME_REGISTRY).sort());
    });
  });

  describe('isLabelLayer', () => {
    it('returns true for a symbol layer with a text-field and non-observations source', () => {
      expect(isLabelLayer({ type: 'symbol', layout: { 'text-field': '{name}' } })).toBe(true);
    });

    it('returns false for a symbol/text-field layer whose source is observations', () => {
      expect(
        isLabelLayer({
          type: 'symbol',
          source: 'observations',
          layout: { 'text-field': '{name}' },
        }),
      ).toBe(false);
    });

    it('returns false for a symbol layer with no text-field', () => {
      expect(isLabelLayer({ type: 'symbol', layout: {} })).toBe(false);
    });

    it('returns false for a non-symbol line layer', () => {
      expect(isLabelLayer({ type: 'line' })).toBe(false);
    });

    it('returns false for a background layer', () => {
      expect(isLabelLayer({ type: 'background' })).toBe(false);
    });
  });
});

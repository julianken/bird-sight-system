import { describe, it, expect } from 'vitest';
import {
  BASEMAP_LIGHT,
  BASEMAP_DARK,
  basemapStyle,
  basemapStyleLight,
  basemapStyleDark,
  THEME_REGISTRY,
  LAND_COLORS,
  resolveDescriptor,
  isLabelLayer,
} from './basemap-style.js';
import type { ThemeId } from './basemap-style.js';

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

  it('keeps `basemapStyle` as a back-compat alias of BASEMAP_LIGHT', () => {
    expect(basemapStyle).toBe(BASEMAP_LIGHT);
  });

  it('keeps `basemapStyleLight`/`basemapStyleDark` as back-compat aliases', () => {
    expect(basemapStyleLight).toBe(BASEMAP_LIGHT);
    expect(basemapStyleDark).toBe(BASEMAP_DARK);
  });

  describe('THEME_REGISTRY', () => {
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

    it('gives the dark descriptor darkLabelTextColors and the light one none', () => {
      expect(THEME_REGISTRY.dark.darkLabelTextColors).toEqual({
        road: '#d8d8d8',
        place: '#c4c4c4',
        water: '#b8cae6', // re-picked #1217: 4.76:1 vs fiord (#9db4d8 was 3.75:1, an AA fail)
      });
      expect(THEME_REGISTRY.positron.darkLabelTextColors).toBeUndefined();
    });

    it('keeps registry urls byte-identical to the back-compat aliases', () => {
      expect(BASEMAP_LIGHT).toBe(THEME_REGISTRY.positron.url);
      expect(BASEMAP_DARK).toBe(THEME_REGISTRY.dark.url);
    });

    it('keeps each descriptor landColor in sync with LAND_COLORS', () => {
      (['positron', 'dark'] as ThemeId[]).forEach((id) => {
        expect(THEME_REGISTRY[id].landColor).toBe(LAND_COLORS[id].land);
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
      expect(resolveDescriptor('positron')).toBe(THEME_REGISTRY.positron);
      expect(resolveDescriptor('dark')).toBe(THEME_REGISTRY.dark);
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

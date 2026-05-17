import { describe, it, expect } from 'vitest';
import { BASEMAP_LIGHT, BASEMAP_DARK, basemapStyle } from './basemap-style.js';

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
});

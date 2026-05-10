import { describe, it, expect } from 'vitest';
import { BASEMAP_LIGHT, BASEMAP_DARK, basemapStyle } from './basemap-style.js';

describe('basemap-style', () => {
  it('exports BASEMAP_LIGHT pointing at OpenFreeMap positron', () => {
    expect(BASEMAP_LIGHT).toBe('https://tiles.openfreemap.org/styles/positron');
  });

  it('exports BASEMAP_DARK aliasing BASEMAP_LIGHT until G7/G8 close', () => {
    // Until G7 (family × basemap contrast) and G8 (dark basemap palette)
    // prototype-gates close, BASEMAP_DARK is a literal alias of
    // BASEMAP_LIGHT. A real dark tile URL is gated behind those gates.
    expect(BASEMAP_DARK).toBe(BASEMAP_LIGHT);
  });

  it('keeps `basemapStyle` as a back-compat alias of BASEMAP_LIGHT', () => {
    expect(basemapStyle).toBe(BASEMAP_LIGHT);
  });
});

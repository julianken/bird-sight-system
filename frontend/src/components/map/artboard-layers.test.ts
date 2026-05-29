import { describe, it, expect, vi } from 'vitest';
import type { MultiPolygon, Polygon, Position } from 'geojson';
import {
  applyLabelIsolation,
  restoreLabelIsolation,
  bufferIsolationPolygon,
  sinkStrayLayersBelowMask,
  addFloatLayers,
  removeFloatLayers,
  applyArtboardFidelity,
  MASK_LAYER_ID,
  ARTBOARD_HALO_ID,
  ARTBOARD_OUTLINE_ID,
  isIsolatableSymbolLayer,
} from './artboard-layers.js';

/* ── Fixtures ────────────────────────────────────────────────────────────────
   A minimal 1-part MultiPolygon standing in for a state's render-only geometry
   (same shape as MapCanvas.test.tsx's AZ_POLYGON). */
const AZ_POLYGON: MultiPolygon = {
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [-114.815, 31.332],
        [-109.045, 31.332],
        [-109.045, 37.004],
        [-114.815, 37.004],
        [-114.815, 31.332],
      ],
    ],
  ],
};

/**
 * A representative style.layers list mixing symbol layers (some matching the
 * name heuristic, some not), plus basemap fill/line layers (some ABOVE the mask
 * — to assert sinking — and some BELOW). Order matters for the sink test: the
 * mask is at index `maskIndex`; layers AFTER it are "above" in paint order.
 */
function makeStyleLayers() {
  return [
    { id: 'background', type: 'background' },
    { id: 'water', type: 'fill' },
    { id: 'water_outline', type: 'line' },
    { id: 'place_country', type: 'symbol', filter: ['==', 'class', 'country'] },
    { id: 'place_city', type: 'symbol' },
    { id: 'poi_z14', type: 'symbol' },
    // A symbol layer that must NOT match the heuristic (no place/label token).
    { id: 'transit_route_ref', type: 'symbol' },
    // The mask fill (the z-order anchor).
    { id: MASK_LAYER_ID, type: 'fill' },
    // Stray basemap fill/line layers painted ABOVE the mask — must be sunk.
    { id: 'boundary_country', type: 'line' },
    { id: 'landcover_glacier', type: 'fill' },
    // App-owned float layers (must never be sunk).
    { id: ARTBOARD_HALO_ID, type: 'line' },
    { id: ARTBOARD_OUTLINE_ID, type: 'line' },
  ];
}

/**
 * A mock maplibre map backed by an in-memory layer list, with `getStyle`,
 * `getFilter`, `setFilter`, `getLayer`, `moveLayer`, `addLayer`, `removeLayer`,
 * and `triggerRepaint` spies. Mirrors the methods MapCanvas.test.tsx's shared
 * factory exposes, but standalone so the helper is unit-testable without React.
 */
function makeMockMap(layers = makeStyleLayers()) {
  const layersById: Record<string, { id: string; type: string; filter?: unknown }> =
    Object.fromEntries(layers.map((l) => [l.id, l]));
  return {
    layers,
    layersById,
    getStyle: vi.fn(() => ({ layers })),
    getFilter: vi.fn((id: string) => layersById[id]?.filter),
    setFilter: vi.fn((id: string, filter: unknown) => {
      if (layersById[id]) layersById[id].filter = filter;
    }),
    getLayer: vi.fn((id: string) => layersById[id]),
    moveLayer: vi.fn(),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    triggerRepaint: vi.fn(),
  };
}

const turfBbox = (g: Polygon | MultiPolygon): [number, number, number, number] => {
  let minx = Infinity;
  let miny = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  const walk = (c: Position | Position[] | Position[][] | Position[][][]): void => {
    if (typeof (c as number[])[0] === 'number') {
      const [x, y] = c as number[];
      if (x !== undefined && y !== undefined) {
        minx = Math.min(minx, x);
        maxx = Math.max(maxx, x);
        miny = Math.min(miny, y);
        maxy = Math.max(maxy, y);
      }
    } else {
      for (const sub of c as unknown[]) walk(sub as Position);
    }
  };
  walk(g.coordinates as Position[][][]);
  return [minx, miny, maxx, maxy];
};

describe('bufferIsolationPolygon', () => {
  it('returns an OUTWARD-expanded geometry whose bbox is strictly larger than the input', () => {
    const buffered = bufferIsolationPolygon(AZ_POLYGON, 8);
    const [iMinX, iMinY, iMaxX, iMaxY] = turfBbox(AZ_POLYGON);
    const [bMinX, bMinY, bMaxX, bMaxY] = turfBbox(buffered);
    // Strictly larger envelope on all four sides — the buffer expands outward,
    // saving near-border interior label anchors that fall outside the
    // 5%-simplified edge.
    expect(bMinX).toBeLessThan(iMinX);
    expect(bMinY).toBeLessThan(iMinY);
    expect(bMaxX).toBeGreaterThan(iMaxX);
    expect(bMaxY).toBeGreaterThan(iMaxY);
  });

  it('returns a Polygon or MultiPolygon geometry object (not a Feature)', () => {
    const buffered = bufferIsolationPolygon(AZ_POLYGON, 8);
    expect(['Polygon', 'MultiPolygon']).toContain(buffered.type);
    // It is a bare geometry (the shape `within` consumes), NOT a wrapped Feature.
    expect((buffered as { type: string }).type).not.toBe('Feature');
  });
});

describe('isIsolatableSymbolLayer (type + name heuristic, fails OPEN)', () => {
  it('matches symbol layers whose id contains a place/label token', () => {
    expect(isIsolatableSymbolLayer({ id: 'place_city', type: 'symbol' })).toBe(true);
    expect(isIsolatableSymbolLayer({ id: 'place_country', type: 'symbol' })).toBe(true);
    expect(isIsolatableSymbolLayer({ id: 'poi_z14', type: 'symbol' })).toBe(true);
    expect(isIsolatableSymbolLayer({ id: 'settlement-major', type: 'symbol' })).toBe(true);
    expect(isIsolatableSymbolLayer({ id: 'state_label', type: 'symbol' })).toBe(true);
  });

  it('does NOT match symbol layers with no place/label token (fails open: rendered exterior, not blanked)', () => {
    expect(isIsolatableSymbolLayer({ id: 'transit_route_ref', type: 'symbol' })).toBe(false);
  });

  it('does NOT match non-symbol layers even when the id contains a token', () => {
    expect(isIsolatableSymbolLayer({ id: 'place_fill', type: 'fill' })).toBe(false);
    expect(isIsolatableSymbolLayer({ id: 'boundary_country', type: 'line' })).toBe(false);
  });
});

describe('applyLabelIsolation', () => {
  it('merges ["within", isolationPolygon] into a layer with NO original filter (single-expr branch)', () => {
    const map = makeMockMap();
    const buffered = bufferIsolationPolygon(AZ_POLYGON, 8);
    applyLabelIsolation(map as never, buffered);

    // place_city has no original filter → merged filter is just ['within', geom].
    const cityCall = map.setFilter.mock.calls.find((c) => c[0] === 'place_city');
    expect(cityCall).toBeDefined();
    const cityFilter = cityCall?.[1] as unknown[];
    expect(cityFilter[0]).toBe('within');
    expect(cityFilter[1]).toBe(buffered);
  });

  it('combines with the captured original via ["all", original, ["within", …]] (all-branch)', () => {
    const map = makeMockMap();
    const buffered = bufferIsolationPolygon(AZ_POLYGON, 8);
    const originalCountryFilter = map.layersById['place_country']?.filter;
    applyLabelIsolation(map as never, buffered);

    const countryCall = map.setFilter.mock.calls.find((c) => c[0] === 'place_country');
    expect(countryCall).toBeDefined();
    const merged = countryCall?.[1] as unknown[];
    expect(merged[0]).toBe('all');
    expect(merged[1]).toEqual(originalCountryFilter);
    expect((merged[2] as unknown[])[0]).toBe('within');
    expect((merged[2] as unknown[])[1]).toBe(buffered);
  });

  it('uses the BUFFERED isolationPolygon — distinct (larger bbox) from the exact maskPolygon fill geometry', () => {
    const map = makeMockMap();
    const buffered = bufferIsolationPolygon(AZ_POLYGON, 8);
    applyLabelIsolation(map as never, buffered);
    const cityCall = map.setFilter.mock.calls.find((c) => c[0] === 'place_city');
    const withinGeom = (cityCall?.[1] as unknown[])[1] as Polygon | MultiPolygon;
    const [bMinX] = turfBbox(withinGeom);
    const [iMinX] = turfBbox(AZ_POLYGON);
    // The within geometry's envelope is strictly larger than the exact polygon.
    expect(bMinX).toBeLessThan(iMinX);
  });

  it('only touches MATCHING symbol layers, leaving non-matching + non-symbol layers untouched', () => {
    const map = makeMockMap();
    applyLabelIsolation(map as never, bufferIsolationPolygon(AZ_POLYGON, 8));
    const touched = map.setFilter.mock.calls.map((c) => c[0]);
    expect(touched).toEqual(
      expect.arrayContaining(['place_country', 'place_city', 'poi_z14']),
    );
    expect(touched).not.toContain('transit_route_ref'); // symbol but no token
    expect(touched).not.toContain('water'); // non-symbol
    expect(touched).not.toContain('boundary_country'); // non-symbol
  });

  it('captures original filters and calls triggerRepaint (defensive idle-map flush)', () => {
    const map = makeMockMap();
    const originalCountryFilter = map.layersById['place_country']?.filter;
    const saved = applyLabelIsolation(map as never, bufferIsolationPolygon(AZ_POLYGON, 8));
    // The captured original is the pre-merge filter (so restore is exact).
    expect(saved['place_country']).toEqual(originalCountryFilter);
    // place_city had no filter — captured as undefined so restore clears it.
    expect('place_city' in saved).toBe(true);
    expect(saved['place_city']).toBeUndefined();
    expect(map.triggerRepaint).toHaveBeenCalledTimes(1);
  });
});

describe('restoreLabelIsolation', () => {
  it('restores each captured original filter and calls triggerRepaint', () => {
    const map = makeMockMap();
    const originalCountryFilter = map.layersById['place_country']?.filter;
    const saved = applyLabelIsolation(map as never, bufferIsolationPolygon(AZ_POLYGON, 8));
    map.setFilter.mockClear();
    map.triggerRepaint.mockClear();

    restoreLabelIsolation(map as never, saved);

    const countryRestore = map.setFilter.mock.calls.find((c) => c[0] === 'place_country');
    expect(countryRestore?.[1]).toEqual(originalCountryFilter);
    // place_city restores to undefined ("no filter").
    const cityRestore = map.setFilter.mock.calls.find((c) => c[0] === 'place_city');
    expect(cityRestore?.[1]).toBeUndefined();
    expect(map.triggerRepaint).toHaveBeenCalledTimes(1);
  });

  it('does not throw when a saved layer no longer exists (disposed-map guard)', () => {
    const map = makeMockMap();
    map.getLayer = vi.fn(() => undefined);
    expect(() =>
      restoreLabelIsolation(map as never, { gone_layer: ['==', 'x', 1] }),
    ).not.toThrow();
  });
});

describe('sinkStrayLayersBelowMask', () => {
  it('moves basemap fill/line layers ordered ABOVE the mask beneath it via moveLayer(strayId, MASK_LAYER_ID)', () => {
    const map = makeMockMap();
    sinkStrayLayersBelowMask(map as never, MASK_LAYER_ID);
    const moved = map.moveLayer.mock.calls.map((c) => [c[0], c[1]]);
    // boundary_country (line) + landcover_glacier (fill) are above the mask → sunk.
    expect(moved).toEqual(
      expect.arrayContaining([
        ['boundary_country', MASK_LAYER_ID],
        ['landcover_glacier', MASK_LAYER_ID],
      ]),
    );
  });

  it('does NOT sink symbol layers, the mask itself, or the app-owned float layers', () => {
    const map = makeMockMap();
    sinkStrayLayersBelowMask(map as never, MASK_LAYER_ID);
    const movedIds = map.moveLayer.mock.calls.map((c) => c[0]);
    expect(movedIds).not.toContain('place_city'); // symbol stays above
    expect(movedIds).not.toContain(MASK_LAYER_ID); // never moves itself
    expect(movedIds).not.toContain(ARTBOARD_HALO_ID);
    expect(movedIds).not.toContain(ARTBOARD_OUTLINE_ID);
  });

  it('does not throw when the mask layer is absent from the style', () => {
    const layers = makeStyleLayers().filter((l) => l.id !== MASK_LAYER_ID);
    const map = makeMockMap(layers);
    expect(() => sinkStrayLayersBelowMask(map as never, MASK_LAYER_ID)).not.toThrow();
  });
});

describe('addFloatLayers / removeFloatLayers', () => {
  it('adds the halo (line + line-blur) and crisp outline (line) above the mask, with stable app-owned ids', () => {
    const map = makeMockMap();
    addFloatLayers(map as never, AZ_POLYGON, MASK_LAYER_ID, 'light');
    const added = map.addLayer.mock.calls.map((c) => c[0] as { id: string; type: string; paint?: Record<string, unknown> });
    const halo = added.find((l) => l.id === ARTBOARD_HALO_ID);
    const outline = added.find((l) => l.id === ARTBOARD_OUTLINE_ID);
    expect(halo).toBeDefined();
    expect(halo?.type).toBe('line');
    expect(halo?.paint?.['line-blur']).toBeGreaterThan(0);
    expect(outline).toBeDefined();
    expect(outline?.type).toBe('line');
    // The halo is added first (so the crisp outline paints on top of it).
    expect(added[0]?.id).toBe(ARTBOARD_HALO_ID);
    expect(added[1]?.id).toBe(ARTBOARD_OUTLINE_ID);
  });

  it('theme param drives the halo paint (light drop-shadow vs dark glow differ)', () => {
    const lightMap = makeMockMap();
    addFloatLayers(lightMap as never, AZ_POLYGON, MASK_LAYER_ID, 'light');
    const darkMap = makeMockMap();
    addFloatLayers(darkMap as never, AZ_POLYGON, MASK_LAYER_ID, 'dark');
    const haloColor = (m: ReturnType<typeof makeMockMap>) =>
      (m.addLayer.mock.calls.find((c) => (c[0] as { id: string }).id === ARTBOARD_HALO_ID)?.[0] as {
        paint: Record<string, unknown>;
      }).paint['line-color'];
    expect(haloColor(lightMap)).not.toEqual(haloColor(darkMap));
  });

  it('is idempotent — guarded removal of an already-present layer before re-add', () => {
    const map = makeMockMap();
    // Float layers already present in the style (post theme-swap re-apply).
    addFloatLayers(map as never, AZ_POLYGON, MASK_LAYER_ID, 'light');
    // getLayer returns the existing halo/outline → addFloatLayers removes first.
    expect(map.removeLayer).toHaveBeenCalledWith(ARTBOARD_HALO_ID);
    expect(map.removeLayer).toHaveBeenCalledWith(ARTBOARD_OUTLINE_ID);
  });

  it('removeFloatLayers removes both float layers idempotently (guarded, no throw if absent)', () => {
    const layers = makeStyleLayers().filter(
      (l) => l.id !== ARTBOARD_HALO_ID && l.id !== ARTBOARD_OUTLINE_ID,
    );
    const map = makeMockMap(layers);
    expect(() => removeFloatLayers(map as never)).not.toThrow();

    const present = makeMockMap();
    removeFloatLayers(present as never);
    expect(present.removeLayer).toHaveBeenCalledWith(ARTBOARD_HALO_ID);
    expect(present.removeLayer).toHaveBeenCalledWith(ARTBOARD_OUTLINE_ID);
  });
});

describe('applyArtboardFidelity (float/sink composite — item 3b)', () => {
  it('sinks stray layers then adds the float layers above the mask', () => {
    const map = makeMockMap();
    applyArtboardFidelity(map as never, AZ_POLYGON, 'dark');
    // moveLayer (sink) and addLayer (float) both fire.
    expect(map.moveLayer).toHaveBeenCalled();
    expect(map.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: ARTBOARD_HALO_ID }),
      MASK_LAYER_ID, // float added relative to the mask (above it)
    );
    expect(map.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: ARTBOARD_OUTLINE_ID }),
      MASK_LAYER_ID, // outline also inserts just above the fill
    );
  });
});

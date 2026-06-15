import { describe, it, expect, vi } from 'vitest';
import type { MultiPolygon, Polygon, Position } from 'geojson';
import {
  applyLabelIsolation,
  restoreLabelIsolation,
  bufferIsolationPolygon,
  sinkStrayLayersBelowMask,
  moveMaskBelowFirstLabel,
  addFloatLayers,
  removeFloatLayers,
  applyArtboardFidelity,
  MASK_LAYER_ID,
  ARTBOARD_HALO_ID,
  ARTBOARD_OUTLINE_ID,
  ARTBOARD_LINE_SOURCE_ID,
  isIsolatableSymbolLayer,
} from './artboard-layers.js';
import {
  THEME_REGISTRY,
  type BasemapDescriptor,
} from './basemap-style.js';

const POSITRON_DESCRIPTOR: BasemapDescriptor = THEME_REGISTRY.positron;
const DARK_DESCRIPTOR: BasemapDescriptor = THEME_REGISTRY.dark;

/**
 * A short text-field-bearing `layout` so a fixture symbol layer reads as a
 * label under `isLabelLayer` (which checks `layout['text-field'] != null`).
 */
const TEXT_LAYOUT = { 'text-field': ['get', 'name'] } as const;

/**
 * The OLD `SYMBOL_NAME_PATTERN` regex, snapshotted here as the equivalence
 * oracle. The production code DELETED this regex in favor of `isLabelLayer`
 * (text-field introspection); this snapshot lets the fixture-backed test below
 * assert the isolated SET is byte-identical between the regex and `isLabelLayer`
 * over the REAL positron + dark layer lists.
 */
const OLD_SYMBOL_NAME_PATTERN =
  /(^|[-_])(place|settlement|poi|label|town|city|village|state|country|shield|airport)([-_]|$)|[-_]name([-_]|$)/i;

function oldRegexIsolates(layer: {
  id: string;
  type: string;
  source?: string;
}): boolean {
  if (layer.type !== 'symbol') return false;
  if (layer.source === 'observations') return false;
  return OLD_SYMBOL_NAME_PATTERN.test(layer.id);
}

/**
 * Fixture-backed REAL layer lists, trimmed to the fields the detectors read
 * (`id`, `type`, `source`, and `layout['text-field']` presence). Captured from
 * the live OpenFreeMap styles fetched in the C-epic pre-flight:
 *   - https://tiles.openfreemap.org/styles/positron — 55 layers, 19 symbol
 *   - https://tiles.openfreemap.org/styles/dark     — 47 layers, 15 symbol
 * Every symbol layer that carries a `text-field` gets a truthy `layout`; the two
 * icon-only `road_oneway*` arrows in the dark style get NO `layout` (they have
 * no `text-field`). These two facts are the whole equivalence claim: the shields
 * and airport the old regex matched all carry a `text-field`, and the arrows it
 * excluded carry none.
 */
type FixtureLayer = {
  id: string;
  type: string;
  source?: string;
  layout?: Record<string, unknown>;
};
const L = (
  id: string,
  type: string,
  opts: { source?: string; text?: boolean } = {},
): FixtureLayer => {
  const o: FixtureLayer = { id, type };
  if (opts.source != null) o.source = opts.source;
  if (opts.text) o.layout = { ...TEXT_LAYOUT };
  return o;
};
const OMT = 'openmaptiles';
const POSITRON_REAL_LAYERS: FixtureLayer[] = [
  L('background', 'background'),
  L('park', 'fill', { source: OMT }),
  L('water', 'fill', { source: OMT }),
  L('landcover_glacier', 'fill', { source: OMT }),
  L('waterway', 'line', { source: OMT }),
  L('building', 'fill', { source: OMT }),
  L('highway_motorway_inner', 'line', { source: OMT }),
  L('boundary_2', 'line', { source: OMT }),
  // 19 symbol layers — every one carries a text-field in the live style.
  L('waterway_line_label', 'symbol', { source: OMT, text: true }),
  L('water_name_point_label', 'symbol', { source: OMT, text: true }),
  L('water_name_line_label', 'symbol', { source: OMT, text: true }),
  L('highway-name-path', 'symbol', { source: OMT, text: true }),
  L('highway-name-minor', 'symbol', { source: OMT, text: true }),
  L('highway-name-major', 'symbol', { source: OMT, text: true }),
  L('highway-shield-non-us', 'symbol', { source: OMT, text: true }),
  L('highway-shield-us-interstate', 'symbol', { source: OMT, text: true }),
  L('road_shield_us', 'symbol', { source: OMT, text: true }),
  L('airport', 'symbol', { source: OMT, text: true }),
  L('label_other', 'symbol', { source: OMT, text: true }),
  L('label_village', 'symbol', { source: OMT, text: true }),
  L('label_town', 'symbol', { source: OMT, text: true }),
  L('label_state', 'symbol', { source: OMT, text: true }),
  L('label_city', 'symbol', { source: OMT, text: true }),
  L('label_city_capital', 'symbol', { source: OMT, text: true }),
  L('label_country_3', 'symbol', { source: OMT, text: true }),
  L('label_country_2', 'symbol', { source: OMT, text: true }),
  L('label_country_1', 'symbol', { source: OMT, text: true }),
];
const DARK_REAL_LAYERS: FixtureLayer[] = [
  L('background', 'background'),
  L('water', 'fill', { source: OMT }),
  L('landcover_glacier', 'fill', { source: OMT }),
  L('waterway', 'line', { source: OMT }),
  L('building', 'fill', { source: OMT }),
  L('highway_motorway_inner', 'line', { source: OMT }),
  L('boundary_country_z5-', 'line', { source: OMT }),
  // 15 symbol layers — 13 carry a text-field; the two road_oneway* arrows do NOT.
  L('water_name', 'symbol', { source: OMT, text: true }),
  L('road_oneway', 'symbol', { source: OMT }), // icon-only arrow — NO text-field
  L('road_oneway_opposite', 'symbol', { source: OMT }), // icon-only arrow — NO text-field
  L('highway_name_other', 'symbol', { source: OMT, text: true }),
  L('highway_name_motorway', 'symbol', { source: OMT, text: true }),
  L('place_other', 'symbol', { source: OMT, text: true }),
  L('place_suburb', 'symbol', { source: OMT, text: true }),
  L('place_village', 'symbol', { source: OMT, text: true }),
  L('place_town', 'symbol', { source: OMT, text: true }),
  L('place_city', 'symbol', { source: OMT, text: true }),
  L('place_city_large', 'symbol', { source: OMT, text: true }),
  L('place_state', 'symbol', { source: OMT, text: true }),
  L('place_country_other', 'symbol', { source: OMT, text: true }),
  L('place_country_minor', 'symbol', { source: OMT, text: true }),
  L('place_country_major', 'symbol', { source: OMT, text: true }),
];

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
    { id: 'place_country', type: 'symbol', source: 'openmaptiles', layout: { ...TEXT_LAYOUT }, filter: ['==', 'class', 'country'] },
    { id: 'place_city', type: 'symbol', source: 'openmaptiles', layout: { ...TEXT_LAYOUT } },
    { id: 'poi_z14', type: 'symbol', source: 'openmaptiles', layout: { ...TEXT_LAYOUT } },
    // The `<thing>_name` label convention (was bleeding CA/MX freeway names).
    { id: 'highway_name_motorway', type: 'symbol', source: 'openmaptiles', layout: { ...TEXT_LAYOUT } },
    { id: 'water_name', type: 'symbol', source: 'openmaptiles', layout: { ...TEXT_LAYOUT } },
    // A symbol layer that must NOT isolate (no text-field — e.g. an icon-only ref).
    { id: 'transit_route_ref', type: 'symbol', source: 'openmaptiles' },
    // An app-owned observation symbol layer — must NEVER be isolated (even though
    // it paints a text-field, the source guard excludes it).
    { id: 'unclustered-point', type: 'symbol', source: 'observations', layout: { ...TEXT_LAYOUT } },
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
  const sources: Record<string, unknown> = {};
  return {
    layers,
    layersById,
    getStyle: vi.fn(() => ({ layers })),
    getFilter: vi.fn((id: string) => layersById[id]?.filter),
    setFilter: vi.fn((id: string, filter: unknown) => {
      if (layersById[id]) layersById[id].filter = filter;
    }),
    getLayer: vi.fn((id: string) => layersById[id]),
    getSource: vi.fn((id: string) => sources[id]),
    addSource: vi.fn((id: string, src: unknown) => {
      sources[id] = src;
    }),
    removeSource: vi.fn((id: string) => {
      delete sources[id];
    }),
    // moveLayer mutates the in-memory `layers` array so order-sensitive tests
    // (the mask-below-first-label move) can assert final z-order, not just the
    // spy call args. `moveLayer(id)` (no beforeId) moves to the top; with
    // `beforeId` it re-inserts `id` immediately BEFORE `beforeId` (MapLibre
    // semantics: the moved layer is painted UNDER `beforeId`).
    moveLayer: vi.fn((id: string, beforeId?: string) => {
      const from = layers.findIndex((l) => l.id === id);
      if (from === -1) return;
      const [moved] = layers.splice(from, 1);
      if (!moved) return;
      if (beforeId == null) {
        layers.push(moved);
        return;
      }
      const to = layers.findIndex((l) => l.id === beforeId);
      if (to === -1) {
        layers.push(moved);
        return;
      }
      layers.splice(to, 0, moved);
    }),
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

describe('isIsolatableSymbolLayer (delegates to isLabelLayer — text-field introspection)', () => {
  it('matches any text-bearing basemap symbol layer (regardless of its id)', () => {
    // The detector no longer reads the id at all — a `symbol` with a `text-field`
    // is a label. (These ids happen to also have carried a regex token, but the
    // truth now is the text-field, not the name.)
    expect(isIsolatableSymbolLayer({ id: 'place_city', type: 'symbol', layout: TEXT_LAYOUT })).toBe(true);
    expect(isIsolatableSymbolLayer({ id: 'label_country_1', type: 'symbol', layout: TEXT_LAYOUT })).toBe(true);
    expect(isIsolatableSymbolLayer({ id: 'highway_name_motorway', type: 'symbol', layout: TEXT_LAYOUT })).toBe(true);
    expect(isIsolatableSymbolLayer({ id: 'water_name', type: 'symbol', layout: TEXT_LAYOUT })).toBe(true);
    expect(isIsolatableSymbolLayer({ id: 'highway-name-major', type: 'symbol', layout: TEXT_LAYOUT })).toBe(true);
    // A symbol whose id carries NO recognizable token still isolates if it paints
    // text — the introspection is strictly more robust than the id heuristic.
    expect(isIsolatableSymbolLayer({ id: 'some_future_label', type: 'symbol', layout: TEXT_LAYOUT })).toBe(true);
  });

  it('matches the shield/airport label layers (they carry a text-field — route number / airport name)', () => {
    // The old regex matched these by the `shield`/`airport` token; under
    // isLabelLayer they match because they DO paint a text-field. The
    // fixture-backed equivalence test below proves this on the real layer list.
    expect(isIsolatableSymbolLayer({ id: 'road_shield_us', type: 'symbol', layout: TEXT_LAYOUT })).toBe(true);
    expect(isIsolatableSymbolLayer({ id: 'highway-shield-us-interstate', type: 'symbol', layout: TEXT_LAYOUT })).toBe(true);
    expect(isIsolatableSymbolLayer({ id: 'highway-shield-non-us', type: 'symbol', layout: TEXT_LAYOUT })).toBe(true);
    expect(isIsolatableSymbolLayer({ id: 'airport', type: 'symbol', layout: TEXT_LAYOUT })).toBe(true);
  });

  it('does NOT match a symbol layer with NO text-field (road_oneway — icon-only arrow, still excluded)', () => {
    // road_oneway / road_oneway_opposite are icon-only arrow layers with no
    // text-field — both the old regex and isLabelLayer exclude them, so the
    // in-state arrow set is never within-dropped.
    expect(isIsolatableSymbolLayer({ id: 'road_oneway', type: 'symbol' })).toBe(false);
    expect(isIsolatableSymbolLayer({ id: 'road_oneway_opposite', type: 'symbol' })).toBe(false);
    // A text-token-bearing id with NO text-field also does not isolate (truth is
    // the text-field, not the id).
    expect(isIsolatableSymbolLayer({ id: 'transit_route_ref', type: 'symbol' })).toBe(false);
  });

  it('NEVER matches the app observation/cluster symbol layers even with a text-field (source: observations)', () => {
    // The bird data is never isolated — isLabelLayer excludes source:observations.
    expect(
      isIsolatableSymbolLayer({ id: 'unclustered-point', type: 'symbol', source: 'observations', layout: TEXT_LAYOUT }),
    ).toBe(false);
    expect(
      isIsolatableSymbolLayer({ id: 'cluster-count', type: 'symbol', source: 'observations', layout: TEXT_LAYOUT }),
    ).toBe(false);
  });

  it('does NOT match non-symbol layers even when they carry a layout', () => {
    expect(isIsolatableSymbolLayer({ id: 'place_fill', type: 'fill', layout: TEXT_LAYOUT })).toBe(false);
    expect(isIsolatableSymbolLayer({ id: 'boundary_country', type: 'line' })).toBe(false);
  });
});

describe('isLabelLayer equivalence vs SYMBOL_NAME_PATTERN (fixture-backed, REAL layer lists)', () => {
  const isolatedSet = (
    layers: FixtureLayer[],
    predicate: (l: FixtureLayer) => boolean,
  ): string[] => layers.filter(predicate).map((l) => l.id).sort();

  it('positron: the isolated SET is byte-identical between the old regex and isLabelLayer', () => {
    const regexSet = isolatedSet(POSITRON_REAL_LAYERS, oldRegexIsolates);
    const labelSet = isolatedSet(POSITRON_REAL_LAYERS, isIsolatableSymbolLayer);
    expect(labelSet).toEqual(regexSet);
    // Sanity: the set is the full 19-symbol-layer label set (all carry text-field).
    expect(labelSet).toHaveLength(19);
    // The shields + airport are IN the set (the equivalence guard the issue names).
    expect(labelSet).toEqual(
      expect.arrayContaining([
        'road_shield_us',
        'highway-shield-us-interstate',
        'highway-shield-non-us',
        'airport',
      ]),
    );
  });

  it('dark: the isolated SET is byte-identical between the old regex and isLabelLayer', () => {
    const regexSet = isolatedSet(DARK_REAL_LAYERS, oldRegexIsolates);
    const labelSet = isolatedSet(DARK_REAL_LAYERS, isIsolatableSymbolLayer);
    expect(labelSet).toEqual(regexSet);
    // 13 of the 15 symbol layers isolate; the two road_oneway* arrows do NOT.
    expect(labelSet).toHaveLength(13);
    expect(labelSet).not.toContain('road_oneway');
    expect(labelSet).not.toContain('road_oneway_opposite');
  });

  it('road_oneway / road_oneway_opposite are excluded by BOTH detectors (icon-only, no text-field)', () => {
    for (const id of ['road_oneway', 'road_oneway_opposite']) {
      const layer = DARK_REAL_LAYERS.find((l) => l.id === id);
      expect(layer).toBeDefined();
      expect(oldRegexIsolates(layer!)).toBe(false);
      expect(isIsolatableSymbolLayer(layer!)).toBe(false);
    }
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

  it('only touches MATCHING basemap symbol layers, leaving non-matching, non-symbol, and observation layers untouched', () => {
    const map = makeMockMap();
    applyLabelIsolation(map as never, bufferIsolationPolygon(AZ_POLYGON, 8));
    const touched = map.setFilter.mock.calls.map((c) => c[0]);
    expect(touched).toEqual(
      expect.arrayContaining([
        'place_country',
        'place_city',
        'poi_z14',
        'highway_name_motorway',
        'water_name',
      ]),
    );
    expect(touched).not.toContain('transit_route_ref'); // symbol but no token
    expect(touched).not.toContain('unclustered-point'); // observation layer (source guard)
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

describe('moveMaskBelowFirstLabel (isolate mode — interior labels render ON TOP of the gray)', () => {
  // The fixture style places state-mask-fill AFTER all the symbol/label layers
  // (the pre-fix BUG state from #762: the mask <Layer> has no beforeId so
  // react-map-gl appends it above the basemap labels). The first basemap label
  // layer is `place_country` (the first isolatable symbol). The mask must move
  // to sit immediately BELOW it.
  const firstLabelId = 'place_country';

  it('moves state-mask-fill BELOW the first basemap label (symbol) layer', () => {
    const map = makeMockMap();
    // Precondition: the mask starts ABOVE the first label (the bug).
    const before = map.layers.map((l) => l.id);
    expect(before.indexOf(MASK_LAYER_ID)).toBeGreaterThan(before.indexOf(firstLabelId));

    moveMaskBelowFirstLabel(map as never, MASK_LAYER_ID);

    expect(map.moveLayer).toHaveBeenCalledWith(MASK_LAYER_ID, firstLabelId);
    // Final z-order: the mask now sits immediately below the first label layer.
    const after = map.layers.map((l) => l.id);
    expect(after.indexOf(MASK_LAYER_ID)).toBeLessThan(after.indexOf(firstLabelId));
    // …specifically directly beneath it.
    expect(after.indexOf(MASK_LAYER_ID)).toBe(after.indexOf(firstLabelId) - 1);
  });

  it('lands EVERY interior basemap label layer ABOVE the mask (the un-clip invariant)', () => {
    const map = makeMockMap();
    moveMaskBelowFirstLabel(map as never, MASK_LAYER_ID);
    const after = map.layers.map((l) => l.id);
    const maskIdx = after.indexOf(MASK_LAYER_ID);
    // All basemap label symbol layers now paint ABOVE the mask → interior labels
    // (within-filtered) render whole on top of the gray instead of being sliced.
    for (const labelId of ['place_country', 'place_city', 'poi_z14', 'highway_name_motorway', 'water_name']) {
      expect(after.indexOf(labelId)).toBeGreaterThan(maskIdx);
    }
  });

  it('anchors on the first ISOLATABLE symbol layer (never an app observation / float layer)', () => {
    const map = makeMockMap();
    moveMaskBelowFirstLabel(map as never, MASK_LAYER_ID);
    // The anchor is place_country (first isolatable basemap label), NOT the
    // app-owned observation symbol (`unclustered-point`, source: observations)
    // nor a float line layer — so the mask is never lowered below the bird data.
    expect(map.moveLayer).toHaveBeenCalledTimes(1);
    expect(map.moveLayer).toHaveBeenCalledWith(MASK_LAYER_ID, 'place_country');
    expect(map.moveLayer).not.toHaveBeenCalledWith(MASK_LAYER_ID, 'unclustered-point');
    expect(map.moveLayer).not.toHaveBeenCalledWith(MASK_LAYER_ID, ARTBOARD_HALO_ID);
  });

  it('logs (debug) and does NOT move when the mask layer is absent (reconcile-sequencing guard, fail open)', () => {
    const layers = makeStyleLayers().filter((l) => l.id !== MASK_LAYER_ID);
    const map = makeMockMap(layers);
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    moveMaskBelowFirstLabel(map as never, MASK_LAYER_ID);
    expect(map.moveLayer).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalled();
    debugSpy.mockRestore();
  });

  it('leaves the mask where it is when NO basemap label layer exists (fail open, no throw)', () => {
    // A style with the mask but zero isolatable symbol layers.
    const layers = makeStyleLayers().filter((l) => l.type !== 'symbol');
    const map = makeMockMap(layers);
    expect(() => moveMaskBelowFirstLabel(map as never, MASK_LAYER_ID)).not.toThrow();
    expect(map.moveLayer).not.toHaveBeenCalled();
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
    addFloatLayers(map as never, AZ_POLYGON, MASK_LAYER_ID, POSITRON_DESCRIPTOR);
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

  it('anchors the float adds on the first layer ABOVE the mask (so they paint above the gray, not below it)', () => {
    const map = makeMockMap();
    addFloatLayers(map as never, AZ_POLYGON, MASK_LAYER_ID, POSITRON_DESCRIPTOR);
    // addLayer(spec, beforeId) inserts BELOW beforeId. The anchor is the first
    // non-float layer above state-mask-fill (here: boundary_country) → the
    // floats land just above the mask fill, NOT below it.
    const haloCall = map.addLayer.mock.calls.find(
      (c) => (c[0] as { id: string }).id === ARTBOARD_HALO_ID,
    );
    expect(haloCall?.[1]).toBe('boundary_country');
    // Crucially NOT the mask id itself (which would insert BELOW the mask).
    expect(haloCall?.[1]).not.toBe(MASK_LAYER_ID);
  });

  const paintColor = (
    m: ReturnType<typeof makeMockMap>,
    layerId: string,
  ): unknown =>
    (m.addLayer.mock.calls.find((c) => (c[0] as { id: string }).id === layerId)?.[0] as {
      paint: Record<string, unknown>;
    }).paint['line-color'];

  it('descriptor.floatColors drive the outline + halo paint (positron vs dark differ)', () => {
    const lightMap = makeMockMap();
    addFloatLayers(lightMap as never, AZ_POLYGON, MASK_LAYER_ID, POSITRON_DESCRIPTOR);
    const darkMap = makeMockMap();
    addFloatLayers(darkMap as never, AZ_POLYGON, MASK_LAYER_ID, DARK_DESCRIPTOR);
    expect(paintColor(lightMap, ARTBOARD_HALO_ID)).not.toEqual(paintColor(darkMap, ARTBOARD_HALO_ID));
    expect(paintColor(lightMap, ARTBOARD_OUTLINE_ID)).not.toEqual(paintColor(darkMap, ARTBOARD_OUTLINE_ID));
  });

  it('reproduces TODAY\'s exact float hexes — positron outline #1a1d24 / halo #3a3f4a (byte-identical refactor)', () => {
    const map = makeMockMap();
    addFloatLayers(map as never, AZ_POLYGON, MASK_LAYER_ID, POSITRON_DESCRIPTOR);
    expect(paintColor(map, ARTBOARD_OUTLINE_ID)).toBe('#1a1d24');
    expect(paintColor(map, ARTBOARD_HALO_ID)).toBe('#3a3f4a');
  });

  it('reproduces TODAY\'s exact float hexes — dark outline #e8edf4 / halo #7fd0ff (byte-identical refactor)', () => {
    const map = makeMockMap();
    addFloatLayers(map as never, AZ_POLYGON, MASK_LAYER_ID, DARK_DESCRIPTOR);
    expect(paintColor(map, ARTBOARD_OUTLINE_ID)).toBe('#e8edf4');
    expect(paintColor(map, ARTBOARD_HALO_ID)).toBe('#7fd0ff');
  });

  it('adds ONE explicit named source shared by both layers (no per-layer inline source → no orphan on setStyle)', () => {
    const map = makeMockMap();
    addFloatLayers(map as never, AZ_POLYGON, MASK_LAYER_ID, POSITRON_DESCRIPTOR);
    expect(map.addSource).toHaveBeenCalledWith(
      ARTBOARD_LINE_SOURCE_ID,
      expect.objectContaining({ type: 'geojson' }),
    );
    // Both layers reference the named source by id (string), not an inline object.
    const added = map.addLayer.mock.calls.map((c) => c[0] as { id: string; source: unknown });
    expect(added.find((l) => l.id === ARTBOARD_HALO_ID)?.source).toBe(ARTBOARD_LINE_SOURCE_ID);
    expect(added.find((l) => l.id === ARTBOARD_OUTLINE_ID)?.source).toBe(ARTBOARD_LINE_SOURCE_ID);
  });

  it('is idempotent — guarded removal of an already-present layer before re-add', () => {
    const map = makeMockMap();
    // Float layers already present in the style (post theme-swap re-apply).
    addFloatLayers(map as never, AZ_POLYGON, MASK_LAYER_ID, POSITRON_DESCRIPTOR);
    // getLayer returns the existing halo/outline → addFloatLayers removes first.
    expect(map.removeLayer).toHaveBeenCalledWith(ARTBOARD_HALO_ID);
    expect(map.removeLayer).toHaveBeenCalledWith(ARTBOARD_OUTLINE_ID);
  });

  it('removeFloatLayers removes both float layers AND the shared source (guarded, no throw if absent)', () => {
    const layers = makeStyleLayers().filter(
      (l) => l.id !== ARTBOARD_HALO_ID && l.id !== ARTBOARD_OUTLINE_ID,
    );
    const map = makeMockMap(layers);
    expect(() => removeFloatLayers(map as never)).not.toThrow();

    // A map where the floats + source ARE present: remove both layers + source.
    const present = makeMockMap();
    addFloatLayers(present as never, AZ_POLYGON, MASK_LAYER_ID, POSITRON_DESCRIPTOR);
    present.removeLayer.mockClear();
    present.removeSource.mockClear();
    removeFloatLayers(present as never);
    expect(present.removeLayer).toHaveBeenCalledWith(ARTBOARD_HALO_ID);
    expect(present.removeLayer).toHaveBeenCalledWith(ARTBOARD_OUTLINE_ID);
    expect(present.removeSource).toHaveBeenCalledWith(ARTBOARD_LINE_SOURCE_ID);
  });
});

describe('applyArtboardFidelity (mask-move + float/sink composite — item 3b)', () => {
  it('moves the mask below the first label, sinks stray layers, then adds the float layers above the mask', () => {
    const map = makeMockMap();
    applyArtboardFidelity(map as never, AZ_POLYGON, DARK_DESCRIPTOR);
    // Step 1: the mask moved below the first basemap label layer (place_country).
    expect(map.moveLayer).toHaveBeenCalledWith(MASK_LAYER_ID, 'place_country');
    // moveLayer (mask-move + sink) and addLayer (float) both fire.
    expect(map.moveLayer).toHaveBeenCalled();
    // Float layers are added (anchored above the mask, NOT below it).
    const haloCall = map.addLayer.mock.calls.find(
      (c) => (c[0] as { id: string }).id === ARTBOARD_HALO_ID,
    );
    const outlineCall = map.addLayer.mock.calls.find(
      (c) => (c[0] as { id: string }).id === ARTBOARD_OUTLINE_ID,
    );
    expect(haloCall).toBeDefined();
    expect(outlineCall).toBeDefined();
    expect(haloCall?.[1]).not.toBe(MASK_LAYER_ID); // never inserted BELOW the mask
  });

  it('runs the mask-move BEFORE the float/sink (interior labels end up above the mask)', () => {
    const map = makeMockMap();
    applyArtboardFidelity(map as never, AZ_POLYGON, DARK_DESCRIPTOR);
    // After the composite, every basemap label layer paints ABOVE the lowered
    // mask — the interior-label un-clip invariant.
    const after = map.layers.map((l) => l.id);
    const maskIdx = after.indexOf(MASK_LAYER_ID);
    for (const labelId of ['place_country', 'place_city', 'poi_z14']) {
      expect(after.indexOf(labelId)).toBeGreaterThan(maskIdx);
    }
  });
});

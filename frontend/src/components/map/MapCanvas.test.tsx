import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { forwardRef, useEffect, useImperativeHandle } from 'react';
import type { FamilySilhouette, Observation } from '@bird-watch/shared-types';
import type { MultiPolygon as MultiPolygonGeom } from 'geojson';
// #762: assert the padded clamp / colors / built mask feature against mask.ts as
// the single source of truth — never re-literal the padded value or colors.
import {
  buildMaskFeature,
  padBounds,
  ARTBOARD_PAD,
  MASK_FILL_LIGHT,
  MASK_FILL_DARK,
} from './mask.js';

/* ── Mock react-map-gl/maplibre ─────────────────────────────────────────────
   jsdom has no WebGL context so we stub Map, Source, and Layer as thin
   pass-through components that expose their props for assertion.
   Map is wrapped in forwardRef because MapCanvas passes a ref to it. */

let capturedSourceProps: Record<string, unknown> = {};
let capturedLayerFilters: Record<string, unknown> = {};
// #762: a single OVERWRITTEN capturedSourceProps cannot distinguish the
// observations <Source> from the state-mask <Source>. Capture sources into an
// id-keyed map so the mask-source presence/absence clause can target by id.
let capturedSourcesById: Record<string, Record<string, unknown>> = {};
// #762: per-layer `paint` capture (the mask-fill theme-repaint clause reads the
// captured `fill-color` for state-mask-fill before/after a [data-theme] flip).
let capturedLayerPaint: Record<string, unknown> = {};

let registeredHandlers: Record<string, (e: { point: [number, number] }) => void> = {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let fakeMap: any = null;
let bareHandlers: Record<string, () => void | Promise<void>> = {};
let bareHandlersAll: Record<string, Array<() => void | Promise<void>>> = {};
// When true, MockMap does NOT auto-fire `onLoad` on mount — a test captures
// the callback in `deferredOnLoad` and fires it manually to drive the
// `mapReady` load-gate (#736 load-gating test). Defaults false so the 30
// existing tests keep their synchronous-load behavior.
let deferMapLoad = false;
let deferredOnLoad: (() => void) | null = null;

function makeFakeMap() {
  const canvas = { style: { cursor: '' }, clientWidth: 1440, clientHeight: 900 };
  const container = {
    getBoundingClientRect: vi.fn(() => ({
      x: 0,
      y: 0,
      width: 1440,
      height: 900,
      top: 0,
      left: 0,
      right: 1440,
      bottom: 900,
    })),
  };
  const sprites = new Set<string>();
  // #765 — back the renderWorldCopies imperative reassertion effect with a
  // stateful pair (maplibre's default is `true`). Lets tests both exercise the
  // effect without throwing AND assert the imperative value it lands on.
  let renderWorldCopiesState = true;
  // #763 — a representative style.layers list for the artboard-fidelity
  // imperative work (label isolation, sink, float). Mixes symbol layers (some
  // matching the place/label heuristic, some NOT — to assert the heuristic is
  // selective and fails open) with basemap fill/line layers (to assert
  // sinking) and the #762 mask fill (the z-order anchor). The state-mask-fill
  // entry is conditionally present so a test can simulate the
  // reconcile-sequencing window where the mask layer does NOT yet exist (the
  // moveLayer guard).
  let styleHasMaskLayer = true;
  const baseStyleLayers = () => {
    const layers: Array<{ id: string; type: string; source?: string; filter?: unknown }> = [
      { id: 'background', type: 'background' },
      { id: 'water', type: 'fill' },
      { id: 'place_country', type: 'symbol', source: 'openmaptiles', filter: ['==', 'class', 'country'] },
      { id: 'place_city', type: 'symbol', source: 'openmaptiles' },
      { id: 'poi_z14', type: 'symbol', source: 'openmaptiles' },
      { id: 'highway_name_motorway', type: 'symbol', source: 'openmaptiles' }, // _name label
      { id: 'transit_route_ref', type: 'symbol', source: 'openmaptiles' }, // symbol, no token
    ];
    if (styleHasMaskLayer) layers.push({ id: 'state-mask-fill', type: 'fill' });
    // Stray basemap line/fill layers painted ABOVE the mask (sink targets).
    layers.push({ id: 'boundary_country', type: 'line' });
    layers.push({ id: 'landcover_glacier', type: 'fill' });
    return layers;
  };
  let styleLayers = baseStyleLayers();
  const layersById = () =>
    Object.fromEntries(styleLayers.map((l) => [l.id, l]));
  return {
    // #763 test affordances (not part of the maplibre API surface): let a test
    // simulate the reconcile window where state-mask-fill is absent, and reset
    // the style layer list between style swaps.
    __setMaskLayerPresent: (present: boolean) => {
      styleHasMaskLayer = present;
      styleLayers = baseStyleLayers();
    },
    __resetStyleLayers: () => {
      styleLayers = baseStyleLayers();
    },
    on: vi.fn(
      (
        event: string,
        layerOrCb: string | ((e?: unknown) => void | Promise<void>),
        maybeCb?: (e: { point: [number, number] }) => void,
      ) => {
        if (typeof layerOrCb === 'string' && maybeCb) {
          registeredHandlers[`${event}:${layerOrCb}`] = maybeCb;
        } else if (typeof layerOrCb === 'function') {
          bareHandlers[event] = layerOrCb as () => void | Promise<void>;
          (bareHandlersAll[event] ??= []).push(
            layerOrCb as () => void | Promise<void>,
          );
        }
        if (typeof layerOrCb === 'function') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          registeredHandlers[event] = layerOrCb as any;
        }
      },
    ),
    off: vi.fn(),
    queryRenderedFeatures: vi.fn(),
    querySourceFeatures: vi.fn(() => []),
    getSource: vi.fn(),
    // #763 — getLayer resolves against the in-memory style layer list so the
    // moveLayer/float guards and original-filter capture are testable. (The
    // #762 cluster tests that call getLayer.mockReturnValue still override it.)
    getLayer: vi.fn((id?: string) => (id ? layersById()[id] : undefined)),
    // #763 — style introspection + imperative layer ops for artboard fidelity.
    getStyle: vi.fn(() => ({ layers: styleLayers })),
    getFilter: vi.fn((id: string) => layersById()[id]?.filter),
    setFilter: vi.fn((id: string, filter: unknown) => {
      const layer = layersById()[id];
      if (layer) layer.filter = filter;
    }),
    moveLayer: vi.fn(),
    triggerRepaint: vi.fn(),
    getCanvas: vi.fn(() => canvas),
    getContainer: vi.fn(() => container),
    // #737/S3 — corrective resize on the flex→fixed container transition. Spied
    // so the ResizeObserver effect's camera-neutral resize() is assertable AND
    // so the fitBounds/flyTo camera spies can be checked unchanged after a fire.
    resize: vi.fn(),
    easeTo: vi.fn(),
    // Camera-contract spies (#736). fitBounds/flyTo are the scope-driven
    // imperative moves; setMaxBounds is asserted to be NEVER called (maxBounds
    // is a reactive prop, finding (a)).
    fitBounds: vi.fn(),
    flyTo: vi.fn(),
    setMaxBounds: vi.fn(),
    getZoom: vi.fn(() => 6),
    getBounds: vi.fn(() => ({
      getWest: () => -112,
      getSouth: () => 32,
      getEast: () => -110,
      getNorth: () => 35,
      contains: (_p: [number, number]) => true,
    })),
    // Project coords into a deterministic pixel grid so the deconflict
    // layer (#554) sees distinct screen positions per cluster. The mock
    // uses an arbitrary linear transform — only relative distance matters.
    // A naive constant `{x: 700, y: 400}` collapsed every cluster into
    // one bbox and broke the multi-cluster reconciler tests.
    //
    // The 1000x multiplier guarantees that ANY two lng/lat tuples ≥0.01
    // apart project to non-overlapping bboxes (>100px gap, larger than
    // the worst-case 4×4 grid bbox).
    project: vi.fn(
      (coords: [number, number] | undefined) => {
        const [lng = 0, lat = 0] = coords ?? [0, 0];
        return { x: (lng + 180) * 1000, y: (90 - lat) * 1000 };
      },
    ),
    unproject: vi.fn(() => [-111, 34]),
    addSource: vi.fn(),
    removeSource: vi.fn(),
    // #763 — addLayer/removeLayer mutate the in-memory style layer list so the
    // float-layer lifecycle is realistic: an imperatively-added halo/outline is
    // then visible to getLayer, and removeFloatLayers can guard-and-remove it.
    addLayer: vi.fn((layer: { id?: string; type?: string }) => {
      if (layer?.id && !styleLayers.some((l) => l.id === layer.id)) {
        styleLayers.push({ id: layer.id, type: layer.type ?? 'line' });
      }
    }),
    removeLayer: vi.fn((id: string) => {
      styleLayers = styleLayers.filter((l) => l.id !== id);
    }),
    addImage: vi.fn((id: string) => {
      sprites.add(id);
    }),
    hasImage: vi.fn((id: string) => sprites.has(id)),
    removeImage: vi.fn((id: string) => sprites.delete(id)),
    setStyle: vi.fn(),
    getRenderWorldCopies: vi.fn(() => renderWorldCopiesState),
    setRenderWorldCopies: vi.fn((v: boolean) => {
      renderWorldCopiesState = v;
    }),
  };
}

const MockMap = forwardRef(function MockMap(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  { children, onLoad, ...rest }: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ref: any,
) {
  useImperativeHandle(ref, () => ({ getMap: () => fakeMap }), []);
  useEffect(() => {
    if (!onLoad) return;
    if (deferMapLoad) {
      // Hold the load callback so a test can fire it after asserting the
      // pre-`load` (gated) state.
      deferredOnLoad = onLoad;
      return;
    }
    onLoad();
  }, [onLoad]);
  return (
    <div data-testid="mock-map" data-props={JSON.stringify(rest)}>
      {children}
    </div>
  );
});

vi.mock('react-map-gl/maplibre', () => ({
  Map: MockMap,
  Source: ({ children, ...rest }: Record<string, unknown>) => {
    capturedSourceProps = rest;
    if (typeof rest.id === 'string') {
      capturedSourcesById[rest.id] = rest;
    }
    return (
      <div
        data-testid="mock-source"
        data-source-id={rest.id as string}
        data-props={JSON.stringify(rest)}
      >
        {children as React.ReactNode}
      </div>
    );
  },
  Layer: (props: Record<string, unknown>) => {
    if (typeof props.id === 'string') {
      capturedLayerFilters[props.id] = props.filter;
      capturedLayerPaint[props.id] = props.paint;
    }
    return <div data-testid="mock-layer" data-layer-id={props.id} />;
  },
  // #830: the standalone <AttributionControl> was removed from MapCanvas — no
  // mock needed. attributionControl={false} keeps MapLibre auto-attribution off.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Marker: ({ children, longitude, latitude }: any) => (
    <div
      data-testid="mock-marker"
      data-lng={longitude}
      data-lat={latitude}
    >
      {children}
    </div>
  ),
}));

vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));

/* ── Controllable ResizeObserver + rAF stubs (#737/S3) ──────────────────────
   jsdom has no ResizeObserver. MapCanvas's corrective resize effect guards on
   `typeof ResizeObserver === 'undefined'` and no-ops without it, so to exercise
   the camera-neutral `map.resize()` we install a stub that records each observer
   instance and lets a test fire its callback. requestAnimationFrame is stubbed to
   run synchronously so the rAF-coalesced resize lands within `act()`. */
const resizeObservers: Array<{ cb: ResizeObserverCallback; fire: () => void }> = [];
class StubResizeObserver {
  cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
    resizeObservers.push({
      cb,
      // Simulate a box-size change notification to this observer.
      fire: () => cb([] as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver),
    });
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).ResizeObserver = StubResizeObserver;
// Run rAF callbacks synchronously so the resize effect's coalescing frame fires
// inside the test's act() flush (return a non-zero id so the `frame !== 0` guard
// and cancelAnimationFrame cleanup behave like the real API).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback): number => {
  cb(0);
  return 1;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).cancelAnimationFrame = () => {};

class FakeImage {
  src = '';
  onload: (() => void) | null = null;
  width = 32;
  height = 32;
  decode(): Promise<void> { return Promise.resolve(); }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).Image = FakeImage;
if (typeof URL.createObjectURL === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (URL as any).createObjectURL = vi.fn(() => 'blob:fake-url');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (URL as any).revokeObjectURL = vi.fn();
}

/* ── Import after mocks ───────────────────────────────────────────────── */
const { MapCanvas, __resetAdaptiveGridCacheForTesting } = await import('./MapCanvas.js');

/* ── Helpers ──────────────────────────────────────────────────────────── */

function makeObs(partial: Partial<Observation> = {}): Observation {
  return {
    subId: partial.subId ?? 'S001',
    speciesCode: partial.speciesCode ?? 'houfin',
    comName: partial.comName ?? 'House Finch',
    lat: partial.lat ?? 32.2,
    lng: partial.lng ?? -110.9,
    obsDt: partial.obsDt ?? '2026-04-15T10:00:00Z',
    locId: partial.locId ?? 'L001',
    locName: partial.locName ?? 'Sabino Canyon',
    howMany: partial.howMany ?? 3,
    isNotable: partial.isNotable ?? false,
    silhouetteId: 'silhouetteId' in partial ? (partial.silhouetteId as string | null) : null,
    familyCode: 'familyCode' in partial ? (partial.familyCode as string | null) : null,
  };
}

const SILHOUETTES: FamilySilhouette[] = [
  {
    familyCode: 'tyrannidae',
    color: '#c3772d',
    colorDark: '#C77A2E',
    svgData: 'M0 0L1 1Z',
    svgUrl: null,
    source: 'placeholder',
    license: 'CC0',
    commonName: 'Tyrant Flycatchers',
    creator: null,
  },
  {
    familyCode: 'trochilidae',
    color: '#9637ad',
    colorDark: '#9637ad',
    svgData: 'M2 2L3 3Z',
    svgUrl: null,
    source: 'placeholder',
    license: 'CC0',
    commonName: 'Hummingbirds',
    creator: null,
  },
  {
    familyCode: 'picidae',
    color: '#FF0808',
    colorDark: '#FF0808',
    svgData: 'M4 4L5 5Z',
    svgUrl: null,
    source: 'placeholder',
    license: 'CC0',
    commonName: 'Woodpeckers',
    creator: null,
  },
  {
    familyCode: 'uncurated',
    color: '#888888',
    colorDark: '#888888',
    svgData: null,
    svgUrl: null,
    source: null,
    license: null,
    commonName: null,
    creator: null,
  },
];

/**
 * Fire every registered bare `idle` handler in registration order.
 * Multiple subsystems (adaptive-grid reconciler, ClusterPillOverlay,
 * MapMarkerHitLayer, viewport-change) each register their own listener —
 * `bareHandlers` is last-writer-wins, so we use `bareHandlersAll` to
 * capture them all and invoke each in sequence (matches what maplibre
 * would do).
 */
async function fireAllIdleHandlers() {
  const handlers = bareHandlersAll['idle'] ?? [];
  for (const h of handlers) {
    await h();
  }
}

describe('MapCanvas', () => {
  beforeEach(() => {
    capturedSourceProps = {};
    capturedLayerFilters = {};
    capturedSourcesById = {};
    capturedLayerPaint = {};
    registeredHandlers = {};
    bareHandlers = {};
    bareHandlersAll = {};
    deferMapLoad = false;
    deferredOnLoad = null;
    fakeMap = makeFakeMap();
    document.documentElement.removeAttribute('data-theme');
    __resetAdaptiveGridCacheForTesting();
  });

  it('renders the map-canvas wrapper with data-testid', () => {
    render(<MapCanvas observations={[]} />);
    expect(screen.getByTestId('map-canvas')).toBeInTheDocument();
  });

  it('passes a GeoJSON FeatureCollection to the Source component', () => {
    render(<MapCanvas observations={[makeObs()]} silhouettes={SILHOUETTES} />);
    const data = capturedSourceProps['data'] as { type: string; features: unknown[] };
    expect(data.type).toBe('FeatureCollection');
    expect(data.features).toHaveLength(1);
  });

  it('Source carries cluster + clusterMaxZoom=22 + maxzoom=24 (epic #539 F4)', () => {
    render(<MapCanvas observations={[makeObs()]} silhouettes={SILHOUETTES} />);
    expect(capturedSourceProps['cluster']).toBe(true);
    expect(capturedSourceProps['clusterMaxZoom']).toBe(22);
    expect(capturedSourceProps['maxzoom']).toBe(24);
  });

  it('renders EXACTLY the five observation Layers (no maskPolygon → no state-mask-fill leak)', async () => {
    render(<MapCanvas observations={[]} silhouettes={SILHOUETTES} />);
    await waitFor(() => {
      const ids = screen
        .getAllByTestId('mock-layer')
        .map((el) => el.getAttribute('data-layer-id'));
      // #762: exact ordered toEqual (not arrayContaining) so a 6th
      // unconditional-mask layer cannot silently pass.
      expect(ids).toEqual([
        'clusters',
        'cluster-count',
        'clusters-hit',
        'notable-ring',
        'unclustered-point',
      ]);
    });
  });

  it('does NOT render a maplibre AttributionControl over the map (#830 — consolidated to the ⓘ modal)', () => {
    render(<MapCanvas observations={[]} />);
    // Item A: the bottom-right attribution bar is gone. The mock module no
    // longer exports AttributionControl, and attributionControl={false} on the
    // <Map> keeps MapLibre's own auto-attribution suppressed.
    expect(screen.queryByTestId('mock-attribution-control')).toBeNull();
  });

  /* ── Sprite registration (issue #246, preserved) ────────────────── */

  it('registers an addImage sprite for each silhouette row + the _FALLBACK sentinel', async () => {
    const silhouettes: FamilySilhouette[] = [
      ...SILHOUETTES,
      {
        familyCode: '_FALLBACK',
        color: '#626262',
        colorDark: '#626262',
        svgData: 'M5 5L6 6Z',
        svgUrl: null,
        source: null,
        license: null,
        commonName: null,
        creator: null,
      },
    ];
    render(<MapCanvas observations={[]} silhouettes={silhouettes} />);
    await waitFor(() => {
      // 3 with svgData + _FALLBACK = 4 addImage calls; uncurated (svgData null) skipped.
      const ids = (fakeMap.addImage.mock.calls as Array<[string]>).map((c) => c[0]);
      expect(ids).toEqual(
        expect.arrayContaining(['tyrannidae', 'trochilidae', 'picidae', '_FALLBACK']),
      );
    });
  });

  it('does not call addImage when silhouettes prop is empty', () => {
    render(<MapCanvas observations={[]} silhouettes={[]} />);
    expect(fakeMap.addImage).not.toHaveBeenCalled();
  });

  /* ── Cluster-click handler (preserved, but no zoom-cap gate) ─────── */

  it('zooms to cluster when cluster click fires (Promise API)', async () => {
    render(<MapCanvas observations={[makeObs()]} silhouettes={SILHOUETTES} />);
    await waitFor(() =>
      expect(registeredHandlers['click:clusters']).toBeTypeOf('function'),
    );

    const getClusterExpansionZoom = vi.fn().mockResolvedValue(12);
    fakeMap.getSource.mockReturnValue({ getClusterExpansionZoom });

    fakeMap.queryRenderedFeatures.mockReturnValue([
      {
        properties: { cluster_id: 42 },
        geometry: { type: 'Point', coordinates: [-111.1, 34.0] },
      },
    ]);

    const handler = registeredHandlers['click:clusters'];
    if (!handler) throw new Error('click:clusters handler missing');
    await act(async () => {
      handler({ point: [100, 100] });
    });

    expect(getClusterExpansionZoom).toHaveBeenCalledWith(42);
    expect(getClusterExpansionZoom.mock.calls[0]).toHaveLength(1);

    await waitFor(() =>
      expect(fakeMap.easeTo).toHaveBeenCalledWith({
        center: [-111.1, 34.0],
        zoom: 12,
      }),
    );
  });

  it('swallows cluster-expansion Promise rejections (no throw)', async () => {
    render(<MapCanvas observations={[makeObs()]} silhouettes={SILHOUETTES} />);
    await waitFor(() =>
      expect(registeredHandlers['click:clusters']).toBeTypeOf('function'),
    );

    const getClusterExpansionZoom = vi.fn().mockRejectedValue(new Error('boom'));
    fakeMap.getSource.mockReturnValue({ getClusterExpansionZoom });

    fakeMap.queryRenderedFeatures.mockReturnValue([
      {
        properties: { cluster_id: 7 },
        geometry: { type: 'Point', coordinates: [0, 0] },
      },
    ]);

    const handler = registeredHandlers['click:clusters'];
    if (!handler) throw new Error('click:clusters handler missing');
    await act(async () => {
      expect(() => handler({ point: [0, 0] })).not.toThrow();
    });
    expect(fakeMap.easeTo).not.toHaveBeenCalled();
  });

  /* ── Adaptive-grid reconciler (epic #539) ───────────────────────── */

  it('does NOT materialize adaptive-grid markers when silhouettes prop is empty', async () => {
    const small = {
      id: 1,
      properties: { cluster_id: 1, point_count: 3 },
      geometry: { type: 'Point', coordinates: [-110.9, 32.2] },
    };
    fakeMap.queryRenderedFeatures.mockReturnValue([small]);
    fakeMap.getSource.mockReturnValue({
      getClusterLeaves: vi.fn().mockResolvedValue([]),
    });
    const { container } = render(
      <MapCanvas observations={[makeObs()]} silhouettes={[]} />,
    );
    await act(async () => {
      await bareHandlers['idle']?.();
    });
    expect(container.querySelector('[data-testid="adaptive-grid-marker"]')).toBeNull();
  });

  it('renders an AdaptiveGridMarker for every cluster (no point_count gate)', async () => {
    const clusterA = {
      id: 1,
      properties: { cluster_id: 1, point_count: 3 },
      geometry: { type: 'Point', coordinates: [-110.9, 32.2] },
    };
    const clusterB = {
      id: 2,
      properties: { cluster_id: 2, point_count: 8 },
      geometry: { type: 'Point', coordinates: [-111.5, 33.0] },
    };
    const clusterC = {
      id: 3,
      properties: { cluster_id: 3, point_count: 25 },
      geometry: { type: 'Point', coordinates: [-112.0, 34.5] },
    };

    fakeMap.queryRenderedFeatures.mockImplementation(
      (_: unknown, opts?: { layers?: string[] }) => {
        if (opts?.layers?.includes('clusters-hit')) {
          return [clusterA, clusterB, clusterC];
        }
        return [];
      },
    );
    fakeMap.getSource.mockReturnValue({
      getClusterLeaves: vi.fn().mockResolvedValue([
        { type: 'Feature', properties: { familyCode: 'tyrannidae' } },
      ]),
      getClusterExpansionZoom: vi.fn().mockResolvedValue(12),
    });

    render(<MapCanvas observations={[makeObs()]} silhouettes={SILHOUETTES} />);
    await waitFor(() => expect(bareHandlers['idle']).toBeTypeOf('function'));

    await act(async () => {
      await bareHandlers['idle']?.();
    });

    await waitFor(() => {
      const markers = screen.getAllByTestId('adaptive-grid-marker');
      // All three clusters become grid markers (each has 1 family → 1×1 grid).
      expect(markers).toHaveLength(3);
    });
  });

  it('reconciler runs on both load and idle events', async () => {
    fakeMap.queryRenderedFeatures.mockReturnValue([]);
    fakeMap.getSource.mockReturnValue({
      getClusterLeaves: vi.fn().mockResolvedValue([]),
    });

    render(<MapCanvas observations={[makeObs()]} silhouettes={SILHOUETTES} />);
    await waitFor(() => {
      expect(bareHandlers['load']).toBeTypeOf('function');
      expect(bareHandlers['idle']).toBeTypeOf('function');
    });
  });

  it('aggregates leaves via getClusterLeaves(id, 64, 0) — epic #539 raised limit from 8 → 64', async () => {
    const cluster = {
      id: 99,
      properties: { cluster_id: 99, point_count: 5 },
      geometry: { type: 'Point', coordinates: [-110, 33] },
    };
    fakeMap.queryRenderedFeatures.mockReturnValue([cluster]);

    const getClusterLeaves = vi.fn().mockResolvedValue([
      { type: 'Feature', properties: { familyCode: 'tyrannidae' } },
      { type: 'Feature', properties: { familyCode: 'tyrannidae' } },
      { type: 'Feature', properties: { familyCode: 'trochilidae' } },
      { type: 'Feature', properties: { familyCode: null } },
      { type: 'Feature', properties: { familyCode: 'picidae' } },
    ]);
    fakeMap.getSource.mockReturnValue({ getClusterLeaves });

    render(<MapCanvas observations={[makeObs()]} silhouettes={SILHOUETTES} />);
    await waitFor(() => expect(bareHandlers['idle']).toBeTypeOf('function'));
    await act(async () => {
      await bareHandlers['idle']?.();
    });

    await waitFor(() => {
      expect(getClusterLeaves).toHaveBeenCalledWith(99, 64, 0);
    });
  });

  it('reconciler swallows getClusterLeaves rejections (no throw)', async () => {
    const cluster = {
      id: 1,
      properties: { cluster_id: 1, point_count: 3 },
      geometry: { type: 'Point', coordinates: [-110, 33] },
    };
    fakeMap.queryRenderedFeatures.mockReturnValue([cluster]);
    const getClusterLeaves = vi
      .fn()
      .mockRejectedValue(new Error('cluster expired'));
    fakeMap.getSource.mockReturnValue({ getClusterLeaves });

    render(<MapCanvas observations={[makeObs()]} silhouettes={SILHOUETTES} />);
    await waitFor(() => expect(bareHandlers['idle']).toBeTypeOf('function'));

    await act(async () => {
      expect(() => bareHandlers['idle']?.()).not.toThrow();
    });
  });

  /* ── Three-layer memoization (spec §5.3 — Concerns A/B/C) ─────────
     Four tests pin the load-bearing invariants from issue #542. */

  it('Concern B cache: rejected getClusterLeaves promise is evicted, retry invokes the underlying call', async () => {
    const cluster = {
      id: 7,
      properties: { cluster_id: 7, point_count: 3 },
      geometry: { type: 'Point', coordinates: [-110, 33] },
    };
    fakeMap.queryRenderedFeatures.mockReturnValue([cluster]);

    let callCount = 0;
    const getClusterLeaves = vi.fn().mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) return Promise.reject(new Error('first-fail'));
      return Promise.resolve([
        { type: 'Feature', properties: { familyCode: 'tyrannidae' } },
      ]);
    });
    fakeMap.getSource.mockReturnValue({ getClusterLeaves });

    // Suppress the expected console.warn from rejection logging.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(<MapCanvas observations={[makeObs()]} silhouettes={SILHOUETTES} />);
    await waitFor(() => expect(bareHandlers['idle']).toBeTypeOf('function'));

    // Idle #1: leaves rejects. The cache entry must be evicted in the
    // same microtask via the `.catch()` cleanup at insert time. Fire ALL
    // idle handlers — the adaptive-grid reconciler is one of several
    // (the ClusterPillOverlay and onViewportChange also register on idle).
    await act(async () => {
      await fireAllIdleHandlers();
    });
    // Allow the rejection microtask to run.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Idle #2: cache evicted → reconciler must re-invoke getClusterLeaves.
    await act(async () => {
      await fireAllIdleHandlers();
    });

    expect(callCount).toBe(2);
    expect(warnSpy).toHaveBeenCalledWith(
      '[adaptive-grid] getClusterLeaves rejected',
      expect.stringContaining('7'),
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it('reconcile does not commit tiles when cacheGeneration advanced mid-flight', async () => {
    // The reconciler captures `myGen` at top; if a silhouettes change
    // triggers a re-registration before the await resolves, the prior
    // commit must drop. We simulate this by holding the getClusterLeaves
    // Promise open across a silhouettes change.
    const cluster = {
      id: 3,
      properties: { cluster_id: 3, point_count: 4 },
      geometry: { type: 'Point', coordinates: [-110, 33] },
    };
    fakeMap.queryRenderedFeatures.mockReturnValue([cluster]);

    // First call: returns a pending Promise we control.
    // Subsequent calls: return a never-resolving Promise so reconcile #2
    // (post-rerender, fresh cacheGeneration) stays in-flight and doesn't
    // commit either. Only the race-safe commit check is under test.
    let resolveLeaves1: ((v: unknown) => void) | null = null;
    const leavesPromise1 = new Promise<unknown>((res) => {
      resolveLeaves1 = res;
    });
    const neverResolving = new Promise<unknown>(() => { /* hang forever */ });
    let callCount = 0;
    const getClusterLeaves = vi.fn().mockImplementation(() => {
      callCount += 1;
      return callCount === 1 ? leavesPromise1 : neverResolving;
    });
    fakeMap.getSource.mockReturnValue({ getClusterLeaves });

    const { rerender } = render(
      <MapCanvas observations={[makeObs()]} silhouettes={SILHOUETTES} />,
    );
    await waitFor(() => expect(bareHandlers['idle']).toBeTypeOf('function'));

    // Reconcile #1 already fired on mount (effect's immediate `void reconcile()`).
    // Yield microtasks so it enters its await on leavesPromise1.
    await act(async () => {
      await Promise.resolve();
    });
    expect(callCount).toBe(1);

    // Trigger a fresh silhouettes catalogue identity → effect re-registers
    // → cacheGeneration increments and clears cache → reconcile #2 fires
    // immediately and grabs neverResolving (call #2).
    rerender(
      <MapCanvas observations={[makeObs()]} silhouettes={[...SILHOUETTES]} />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(callCount).toBe(2);

    // Now resolve reconcile #1's leaves. The race-safe commit check
    // (`myGen !== cacheGeneration`) should detect generation advanced
    // and SKIP setGrids. Reconcile #2 is still awaiting neverResolving.
    await act(async () => {
      resolveLeaves1?.([
        { type: 'Feature', properties: { familyCode: 'tyrannidae' } },
      ]);
      await Promise.resolve();
      await Promise.resolve();
    });

    // No adaptive-grid marker — reconcile #1's commit was suppressed and
    // reconcile #2 is still pending.
    expect(
      document.querySelectorAll('[data-testid="adaptive-grid-marker"]').length,
    ).toBe(0);
  });

  it('silhouettesVersion bump invalidates memo even when silhouettes.length is unchanged', async () => {
    // Spec §5.3 Concern C, point 2: in-place catalogue replacement (same
    // length, different rows) must invalidate the cache. We assert this
    // by confirming a re-render with a new silhouettes-array identity
    // (same length) re-fires the effect (visible in addSource calls or
    // in `map.on('load', ...)` re-registration via bareHandlers).
    fakeMap.queryRenderedFeatures.mockReturnValue([]);
    fakeMap.getSource.mockReturnValue({
      getClusterLeaves: vi.fn().mockResolvedValue([]),
    });

    const { rerender } = render(
      <MapCanvas observations={[makeObs()]} silhouettes={SILHOUETTES} />,
    );
    await waitFor(() => expect(bareHandlers['idle']).toBeTypeOf('function'));

    // Count `map.on('load', ...)` registrations from the reconciler effect.
    const loadOnsBefore = (fakeMap.on.mock.calls as Array<[string, unknown]>)
      .filter((c) => c[0] === 'load' && typeof c[1] === 'function')
      .length;

    // Re-render with a fresh silhouettes array of the SAME length but a
    // different identity. The reconciler effect's dep `silhouettes` is
    // identity-keyed; the new identity bumps silhouettesVersionRef too.
    const replaced: FamilySilhouette[] = SILHOUETTES.map((s) => ({ ...s }));
    rerender(
      <MapCanvas observations={[makeObs()]} silhouettes={replaced} />,
    );

    await waitFor(() => {
      const loadOnsAfter = (fakeMap.on.mock.calls as Array<[string, unknown]>)
        .filter((c) => c[0] === 'load' && typeof c[1] === 'function')
        .length;
      expect(loadOnsAfter).toBeGreaterThan(loadOnsBefore);
    });
  });

  it('zoom-prefix cache key prevents collisions across zoom levels', async () => {
    // Distinct floor(zoom) values → distinct cache keys for the same
    // (cluster_id, point_count) pair. We exercise the reconciler at zoom
    // 8 and zoom 12 with the same cluster_id and assert getClusterLeaves
    // gets called twice (once per zoom-keyed cache slot).
    const cluster = {
      id: 5,
      properties: { cluster_id: 5, point_count: 4 },
      geometry: { type: 'Point', coordinates: [-110, 33] },
    };
    fakeMap.queryRenderedFeatures.mockReturnValue([cluster]);

    const getClusterLeaves = vi.fn().mockResolvedValue([
      { type: 'Feature', properties: { familyCode: 'tyrannidae' } },
    ]);
    fakeMap.getSource.mockReturnValue({ getClusterLeaves });

    fakeMap.getZoom.mockReturnValue(8);
    render(<MapCanvas observations={[makeObs()]} silhouettes={SILHOUETTES} />);
    await waitFor(() => expect(bareHandlers['idle']).toBeTypeOf('function'));

    await act(async () => {
      await fireAllIdleHandlers();
    });
    const callsAfterZoom8 = getClusterLeaves.mock.calls.length;
    expect(callsAfterZoom8).toBeGreaterThanOrEqual(1);

    // Simulate a zoom-in: zoom 12 → different floor → different cache key.
    fakeMap.getZoom.mockReturnValue(12);
    await act(async () => {
      await fireAllIdleHandlers();
    });

    // The reconciler must have re-invoked getClusterLeaves under the new
    // zoom-prefixed key — NOT served from the zoom=8 cache slot.
    expect(getClusterLeaves.mock.calls.length).toBeGreaterThan(callsAfterZoom8);
  });

  /* ── onViewportChange (preserved) ───────────────────────────────── */

  it('does NOT throw when onViewportChange is omitted (optional prop)', async () => {
    render(<MapCanvas observations={[makeObs()]} silhouettes={SILHOUETTES} />);
    await waitFor(() =>
      expect(bareHandlersAll['idle']?.length ?? 0).toBeGreaterThan(0),
    );
    await act(async () => {
      await expect(fireAllIdleHandlers()).resolves.not.toThrow();
    });
  });

  it('invokes onViewportChange with map.getBounds() on each idle event', async () => {
    const onViewportChange = vi.fn();
    const stubBounds = {
      getWest: () => -111.2,
      getSouth: () => 32.0,
      getEast: () => -110.6,
      getNorth: () => 32.5,
      contains: () => true,
    };
    fakeMap.getBounds.mockReturnValue(stubBounds);

    render(
      <MapCanvas
        observations={[makeObs()]}
        silhouettes={SILHOUETTES}
        onViewportChange={onViewportChange}
      />,
    );
    await waitFor(() =>
      expect(bareHandlersAll['idle']?.length ?? 0).toBeGreaterThan(0),
    );
    await act(async () => { await fireAllIdleHandlers(); });

    // #627 — onViewportChange now also forwards the integer floor of the
    // current zoom so App.tsx can pass it to /api/observations.
    expect(onViewportChange).toHaveBeenCalledWith(stubBounds, expect.any(Number));
  });

  /* ── [data-theme] MutationObserver (preserved) ──────────────────── */

  describe('[data-theme] MutationObserver swaps basemap', () => {
    it('calls map.setStyle when data-theme changes to dark', async () => {
      document.documentElement.setAttribute('data-theme', 'light');
      render(<MapCanvas observations={[]} silhouettes={SILHOUETTES} />);
      await waitFor(() => expect(fakeMap).not.toBeNull());
      (fakeMap.setStyle as ReturnType<typeof vi.fn>).mockClear();

      act(() => {
        document.documentElement.setAttribute('data-theme', 'dark');
      });
      await waitFor(() => {
        expect(fakeMap.setStyle).toHaveBeenCalled();
      });
    });

    it('does NOT call map.setStyle when data-theme is set to its current value', async () => {
      document.documentElement.setAttribute('data-theme', 'light');
      render(<MapCanvas observations={[]} silhouettes={SILHOUETTES} />);
      await waitFor(() => expect(fakeMap).not.toBeNull());
      (fakeMap.setStyle as ReturnType<typeof vi.fn>).mockClear();

      act(() => {
        document.documentElement.setAttribute('data-theme', 'light');
      });
      // Same value — observer no-ops.
      await new Promise((r) => setTimeout(r, 0));
      expect(fakeMap.setStyle).not.toHaveBeenCalled();
    });

    // O8 (#784): prevThemeRef dedup — a genuine light→dark flip fires setStyle
    // EXACTLY ONCE (not twice, not zero). Guards the MutationObserver
    // short-circuit: a single attribute write must produce a single setStyle call.
    it('O8: a light→dark flip fires map.setStyle EXACTLY ONCE (prevThemeRef dedup)', async () => {
      document.documentElement.setAttribute('data-theme', 'light');
      render(<MapCanvas observations={[]} silhouettes={SILHOUETTES} />);
      await waitFor(() => expect(fakeMap).not.toBeNull());
      (fakeMap.setStyle as ReturnType<typeof vi.fn>).mockClear();

      act(() => {
        document.documentElement.setAttribute('data-theme', 'dark');
      });
      await waitFor(() => {
        expect(fakeMap.setStyle).toHaveBeenCalledTimes(1);
      });
    });

    // O8 (#784): a redundant same-value setAttribute fires setStyle ZERO times.
    // The prevThemeRef guard prevents re-painting when the attribute is written
    // but the value hasn't changed (e.g. a second `data-theme="light"` write
    // while the map is already in light mode).
    it('O8: a redundant same-value mutation fires map.setStyle ZERO times', async () => {
      document.documentElement.setAttribute('data-theme', 'light');
      render(<MapCanvas observations={[]} silhouettes={SILHOUETTES} />);
      await waitFor(() => expect(fakeMap).not.toBeNull());
      (fakeMap.setStyle as ReturnType<typeof vi.fn>).mockClear();

      // Write the same value twice — both should be no-ops.
      act(() => {
        document.documentElement.setAttribute('data-theme', 'light');
        document.documentElement.setAttribute('data-theme', 'light');
      });
      await new Promise((r) => setTimeout(r, 0));
      expect(fakeMap.setStyle).toHaveBeenCalledTimes(0);
    });
  });

  /* ── ClusterPillOverlay (preserved, post-cutover semantics) ─────── */

  describe('ClusterPillOverlay', () => {
    it('renders ClusterPill only for clusters NOT promoted to grid (pill-shape per pickGridShape)', async () => {
      // Cluster with 1 family and 5 points → adaptive grid (1×1).
      // Cluster with 20 families and 100 points → pill (uniqueFamilies > 16).
      // We mock different leaf shapes per cluster_id to produce each case.
      const small = {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-110, 32] },
        properties: { cluster: true, cluster_id: 10, point_count: 5 },
      };
      const big = {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-111, 33] },
        properties: { cluster: true, cluster_id: 20, point_count: 100 },
      };
      fakeMap.queryRenderedFeatures.mockReturnValue([small, big]);

      const getClusterLeaves = vi.fn().mockImplementation((id: number) => {
        if (id === 10) {
          return Promise.resolve([
            { type: 'Feature', properties: { familyCode: 'tyrannidae' } },
          ]);
        }
        // Cluster 20: 20 unique families → pill fallback.
        const leaves = [];
        for (let i = 0; i < 20; i++) {
          leaves.push({ type: 'Feature', properties: { familyCode: `fam${i}` } });
        }
        return Promise.resolve(leaves);
      });
      fakeMap.getSource.mockReturnValue({
        getClusterLeaves,
        getClusterExpansionZoom: vi.fn().mockResolvedValue(11),
      });

      render(<MapCanvas observations={[makeObs()]} silhouettes={SILHOUETTES} />);
      await waitFor(() => expect(bareHandlers['idle']).toBeTypeOf('function'));
      await act(async () => { await bareHandlers['idle']?.(); });
      // Let async per-cluster lookups settle.
      await act(async () => { await Promise.resolve(); });

      const pills = screen
        .queryAllByRole('button', { name: /sightings$/ })
        .filter((p) => p.classList.contains('cluster-pill'));
      // Only the 20-family cluster falls through to pill.
      expect(pills).toHaveLength(1);
      expect(pills[0]).toHaveAttribute('aria-label', '100 sightings');
    });

    /* ── #717: max-zoom pill click opens ClusterListPopover ─────────── */

    /**
     * Sets up a single pill-shape cluster (uniqueFamilies > 16) at known
     * coordinates and returns a settled render where the pill is in the DOM.
     * The fakeMap is wired so getClusterExpansionZoom resolves to `expZoom`
     * and the current map zoom is `currentZoom`.
     */
    async function renderPillAtMaxZoom(opts: {
      currentZoom: number;
      expansionZoom: number | typeof NaN;
    }) {
      const big = {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-110.95, 32.25] },
        properties: { cluster: true, cluster_id: 77, point_count: 50 },
      };
      fakeMap.queryRenderedFeatures.mockReturnValue([big]);

      // 20 unique families → pill fallback (uniqueFamilies > 16). Three of
      // them have full species data so the popover aggregator has rows to
      // group + render.
      const leaves = [
        {
          type: 'Feature',
          properties: {
            familyCode: 'tyrannidae',
            speciesCode: 'wewp',
            comName: 'Western Wood-Pewee',
          },
        },
        {
          type: 'Feature',
          properties: {
            familyCode: 'tyrannidae',
            speciesCode: 'sayphoebe',
            comName: "Say's Phoebe",
          },
        },
        {
          type: 'Feature',
          properties: {
            familyCode: 'trochilidae',
            speciesCode: 'annhum',
            comName: "Anna's Hummingbird",
          },
        },
      ];
      for (let i = 0; i < 17; i++) {
        leaves.push({
          type: 'Feature',
          properties: {
            familyCode: `fam${i}`,
            speciesCode: `sp${i}`,
            comName: `Species ${i}`,
          },
        });
      }

      const getClusterLeaves = vi.fn().mockResolvedValue(leaves);
      const getClusterExpansionZoom = vi
        .fn()
        .mockResolvedValue(opts.expansionZoom);
      fakeMap.getSource.mockReturnValue({
        getClusterLeaves,
        getClusterExpansionZoom,
      });
      fakeMap.getZoom.mockReturnValue(opts.currentZoom);

      render(<MapCanvas observations={[makeObs()]} silhouettes={SILHOUETTES} />);
      await waitFor(() => expect(bareHandlers['idle']).toBeTypeOf('function'));
      await act(async () => { await bareHandlers['idle']?.(); });
      await act(async () => { await Promise.resolve(); });

      const pill = await waitFor(() => {
        const found = screen
          .queryAllByRole('button', { name: /sightings$/ })
          .find((p) => p.classList.contains('cluster-pill'));
        if (!found) throw new Error('cluster-pill not rendered');
        return found;
      });

      return { pill, getClusterExpansionZoom, getClusterLeaves };
    }

    it('#717 — max-zoom pill click opens ClusterListPopover (targetZoom <= currentZoom)', async () => {
      // Camera at CLUSTER_MAX_ZOOM (22); supercluster has exhausted its
      // expansion budget → returns 22 as well. The old code would silently
      // no-op here.
      const { pill, getClusterExpansionZoom } = await renderPillAtMaxZoom({
        currentZoom: 22,
        expansionZoom: 22,
      });

      await act(async () => {
        fireEvent.click(pill);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(getClusterExpansionZoom).toHaveBeenCalled();
      // The popover is mounted by MapCanvas at the new mount point — same
      // data-testid as the AdaptiveGridMarker-internal mount.
      await waitFor(() => {
        expect(screen.getByTestId('cluster-list-popover')).toBeInTheDocument();
      });
      // The camera must NOT have moved — the pill is already at max zoom.
      expect(fakeMap.easeTo).not.toHaveBeenCalled();
    });

    it('#717 — easeTo still fires when targetZoom > currentZoom (regression guard)', async () => {
      // Camera at zoom 8; supercluster says break at 12 → easeTo fires.
      // ClusterListPopover must NOT mount in this case (camera is moving).
      const { pill } = await renderPillAtMaxZoom({
        currentZoom: 8,
        expansionZoom: 12,
      });

      await act(async () => {
        fireEvent.click(pill);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(fakeMap.easeTo).toHaveBeenCalledWith(
        expect.objectContaining({
          zoom: 12,
          center: [-110.95, 32.25],
        }),
      );
      expect(screen.queryByTestId('cluster-list-popover')).toBeNull();
    });

    it('#717 — library-error guard: getClusterExpansionZoom resolves to NaN → popover opens', async () => {
      // Library/state error: supercluster/maplibre returns NaN. Without
      // Number.isFinite guard, Math.max(NaN) === NaN, the > comparison
      // is false, and the click silently no-ops. Treat as "open popover".
      const { pill } = await renderPillAtMaxZoom({
        currentZoom: 10,
        expansionZoom: NaN,
      });

      await act(async () => {
        fireEvent.click(pill);
        await Promise.resolve();
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(screen.getByTestId('cluster-list-popover')).toBeInTheDocument();
      });
      expect(fakeMap.easeTo).not.toHaveBeenCalled();
    });
  });
});

// Popover-originated onSelectSpecies wire.
// These tests run in a separate describe block that resets modules to
// pick up the pointer:fine matchMedia stub for AdaptiveGridMarker.
describe('onSelectSpecies popover wire', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let MapCanvasFresh: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let resetCacheFresh: any;

  beforeEach(async () => {
    capturedSourceProps = {};
    capturedLayerFilters = {};
    capturedSourcesById = {};
    capturedLayerPaint = {};
    registeredHandlers = {};
    bareHandlers = {};
    bareHandlersAll = {};
    fakeMap = makeFakeMap();
    document.documentElement.removeAttribute('data-theme');

    // Stub matchMedia: pointer:fine = true so AdaptiveGridMarker renders
    // per-cell <button> elements (perCellInteractive = isPointerFine).
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: q === '(pointer: fine)',
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    vi.resetModules();

    // Dynamically import after modules reset so hooks re-evaluate correctly.
    const mod = await import('./MapCanvas.js');
    MapCanvasFresh = mod.MapCanvas;
    resetCacheFresh = mod.__resetAdaptiveGridCacheForTesting;
    resetCacheFresh();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('calls onSelectSpecies with only the species code (no bbox arg) when a species row is clicked', async () => {
    const cluster = {
      id: 1,
      properties: { cluster_id: 1, point_count: 3 },
      geometry: { type: 'Point', coordinates: [-110.9, 32.2] },
    };
    fakeMap.queryRenderedFeatures.mockImplementation(
      (_: unknown, opts?: { layers?: string[] }) =>
        opts?.layers?.includes('clusters-hit') ? [cluster] : [],
    );
    fakeMap.getSource.mockReturnValue({
      getClusterLeaves: vi.fn().mockResolvedValue([
        {
          type: 'Feature',
          properties: {
            familyCode: 'trochilidae',
            speciesCode: 'annhum',
            comName: "Anna's Hummingbird",
          },
        },
      ]),
      getClusterExpansionZoom: vi.fn().mockResolvedValue(12),
    });

    const onSelectSpecies = vi.fn();
    render(
      <MapCanvasFresh
        observations={[makeObs()]}
        silhouettes={SILHOUETTES}
        onSelectSpecies={onSelectSpecies}
        isCoarsePointer={false}
      />,
    );
    await waitFor(() => expect(bareHandlers['idle']).toBeTypeOf('function'));
    await act(async () => { await bareHandlers['idle']?.(); });
    await act(async () => { await Promise.resolve(); });

    // Wait for the AdaptiveGridMarker cell to render as a <button>.
    await waitFor(() => {
      const cells = screen.queryAllByTestId('adaptive-grid-marker-cell-rendered');
      expect(cells.length).toBeGreaterThan(0);
    });

    const cell = screen.getByTestId('adaptive-grid-marker-cell-rendered');
    // Hover → open CellHoverPreview, then click → open CellPopover.
    fireEvent.mouseEnter(cell);
    fireEvent.click(cell);

    // Species row in the CellPopover.
    await waitFor(() => {
      expect(screen.getByTestId('cell-popover')).toBeInTheDocument();
    });
    const speciesRow = screen.getByTestId('cell-popover-row');
    fireEvent.click(speciesRow);

    // The wrapper calls onSelectSpecies with ONLY the species code — no
    // bbox argument (the dead ?bbox= path was removed).
    expect(onSelectSpecies).toHaveBeenCalledOnce();
    expect(onSelectSpecies).toHaveBeenCalledWith('annhum');
    expect(onSelectSpecies.mock.calls[0]).toHaveLength(1);
  });

  it('onSelectSpecies is NOT called when no species row is clicked (defensive)', async () => {
    const cluster = {
      id: 1,
      properties: { cluster_id: 1, point_count: 3 },
      geometry: { type: 'Point', coordinates: [-110.9, 32.2] },
    };
    fakeMap.queryRenderedFeatures.mockImplementation(
      (_: unknown, opts?: { layers?: string[] }) =>
        opts?.layers?.includes('clusters-hit') ? [cluster] : [],
    );
    fakeMap.getSource.mockReturnValue({
      getClusterLeaves: vi.fn().mockResolvedValue([
        {
          type: 'Feature',
          properties: {
            familyCode: 'trochilidae',
            speciesCode: 'annhum',
            comName: "Anna's Hummingbird",
          },
        },
      ]),
      getClusterExpansionZoom: vi.fn().mockResolvedValue(12),
    });

    const onSelectSpecies = vi.fn();
    render(
      <MapCanvasFresh
        observations={[makeObs()]}
        silhouettes={SILHOUETTES}
        onSelectSpecies={onSelectSpecies}
        isCoarsePointer={false}
      />,
    );
    await waitFor(() => expect(bareHandlers['idle']).toBeTypeOf('function'));
    await act(async () => { await bareHandlers['idle']?.(); });
    await act(async () => { await Promise.resolve(); });

    await waitFor(() => {
      expect(screen.queryAllByTestId('adaptive-grid-marker-cell-rendered').length).toBeGreaterThan(0);
    });

    // Click the cell to open the popover, but do NOT click a species row.
    const cell = screen.getByTestId('adaptive-grid-marker-cell-rendered');
    fireEvent.mouseEnter(cell);
    fireEvent.click(cell);

    await waitFor(() => {
      expect(screen.getByTestId('cell-popover')).toBeInTheDocument();
    });

    // No species row clicked — onSelectSpecies must NOT have been called.
    expect(onSelectSpecies).not.toHaveBeenCalled();
  });
});

// Issue #718 — displaced silhouette popover projection contract.
//
// The displaced-silhouette button at the bottom of MapCanvas
// (silhouetteOffsets.entries() render block) MUST project the popover
// from `entry.longitude/entry.latitude` (the DISPLACED visual position),
// NOT from `obs.lng/obs.lat` (the canvas-hidden original survey point).
//
// Without this contract the popover would land next to the invisible
// original — defeating the entire fix at this site.
describe('ObservationPopover anchoring — displaced silhouette regression (#718)', () => {
  beforeEach(() => {
    capturedSourceProps = {};
    capturedLayerFilters = {};
    capturedSourcesById = {};
    capturedLayerPaint = {};
    registeredHandlers = {};
    bareHandlers = {};
    bareHandlersAll = {};
    fakeMap = makeFakeMap();
    document.documentElement.removeAttribute('data-theme');
    __resetAdaptiveGridCacheForTesting();
  });

  it('projects from entry.longitude/entry.latitude (NOT obs.lng/obs.lat) when the silhouette is displaced', async () => {
    // Cluster anchor at one position; unclustered point at a near-by
    // position so the silhouette AABB overlaps the cluster anchor AABB
    // and `displaceSilhouettes` shifts the silhouette outward. The
    // shift produces an `entry.longitude/entry.latitude` that differs
    // from the obs's original lng/lat — this divergence is what the
    // bug at line 1607 would project from the wrong side of.
    const obsLng = -110.9;
    const obsLat = 32.2;
    const clusterLng = -110.9; // co-located → forces displacement
    const clusterLat = 32.2;
    const obs = makeObs({
      subId: 'S-DISPLACED',
      lng: obsLng,
      lat: obsLat,
      familyCode: 'tyrannidae',
    });

    fakeMap.queryRenderedFeatures.mockImplementation(
      (_: unknown, opts?: { layers?: string[] }) => {
        if (opts?.layers?.includes('clusters-hit')) {
          return [
            {
              id: 7,
              properties: { cluster_id: 7, point_count: 4, cluster: true },
              geometry: { type: 'Point', coordinates: [clusterLng, clusterLat] },
            },
          ];
        }
        if (opts?.layers?.includes('unclustered-point')) {
          return [
            {
              properties: { subId: obs.subId },
              geometry: { type: 'Point', coordinates: [obsLng, obsLat] },
              id: 1,
            },
          ];
        }
        return [];
      },
    );
    fakeMap.getLayer.mockReturnValue({ id: 'unclustered-point' });
    fakeMap.getSource.mockReturnValue({
      getClusterLeaves: vi.fn().mockResolvedValue([
        { type: 'Feature', properties: { familyCode: 'tyrannidae' } },
      ]),
      getClusterExpansionZoom: vi.fn().mockResolvedValue(12),
    });

    // setFeatureState / removeFeatureState are invoked by the displaced-
    // silhouette reconcile path to hide the canvas-painted twin. The
    // default fakeMap doesn't ship these stubs (they're not used by any
    // other test); add them inline so the test's reconcile doesn't
    // produce an unhandled-rejection warning.
    fakeMap.setFeatureState = vi.fn();
    fakeMap.removeFeatureState = vi.fn();

    // unproject mock derives a lng/lat from the projected pixel —
    // displaceSilhouettes calls map.unproject([displacedPx, displacedPy])
    // to produce the entry.longitude/entry.latitude. The default
    // fakeMap.unproject returns a constant; override here so the
    // displaced lng/lat depends on the input pixel and is observably
    // different from the obs's original lng/lat.
    fakeMap.unproject.mockImplementation((px: [number, number]) => {
      const [x, y] = px;
      // Inverse of the project mock: lng = x / 1000 - 180; lat = 90 - y / 1000.
      return { lng: x / 1000 - 180, lat: 90 - y / 1000 } as unknown as [number, number];
    });

    render(
      <MapCanvas observations={[obs]} silhouettes={SILHOUETTES} />,
    );
    await waitFor(() => expect(bareHandlers['idle']).toBeTypeOf('function'));
    await act(async () => { await fireAllIdleHandlers(); });
    // Let async per-cluster lookups settle before the next reconcile commit.
    await act(async () => { await Promise.resolve(); });

    const displaced = await screen.findByTestId('displaced-silhouette');
    expect(displaced).toHaveAttribute('data-subid', obs.subId);

    // Read the displaced lng/lat off the PresentationMarker wrapper that
    // sits on the displaced position. The mock react-map-gl Marker
    // exposes data-lng / data-lat so we can read what the render block
    // used as the displaced coords.
    const markerWrapper = displaced.closest('[data-testid="mock-marker"]');
    expect(markerWrapper).not.toBeNull();
    const entryLng = parseFloat(
      markerWrapper!.getAttribute('data-lng') as string,
    );
    const entryLat = parseFloat(
      markerWrapper!.getAttribute('data-lat') as string,
    );

    // Sanity — displacement MUST have moved the silhouette off the
    // obs's original lng/lat. If this fails, the setup didn't trigger
    // `displaceSilhouettes` and the regression assertion below has no
    // signal.
    expect(entryLng !== obsLng || entryLat !== obsLat).toBe(true);

    // Click the displaced silhouette button. The popover should render
    // with inline left/top derived from project([entryLng, entryLat]),
    // NOT project([obsLng, obsLat]).
    fireEvent.click(displaced);

    const popover = await screen.findByRole('dialog');
    const left = parseFloat(popover.style.left);
    const top = parseFloat(popover.style.top);

    // Expected projection: project mock yields x = (lng + 180) * 1000;
    // y = (90 - lat) * 1000. Plus the popover OFFSET of 12 (default
    // branch — viewport innerWidth/innerHeight in jsdom are 1024×768,
    // so the click at projected entry coords ≈ (lng+180)*1000 stays
    // within the right edge as long as the displaced position is in
    // jsdom's viewport).
    const expectedProjectedX = (entryLng + 180) * 1000;
    const expectedProjectedY = (90 - entryLat) * 1000;
    const wrongProjectedX = (obsLng + 180) * 1000;
    const wrongProjectedY = (90 - obsLat) * 1000;

    // The popover's left/top is `projected + OFFSET` in the no-flip
    // case OR `projected - OFFSET - POPOVER_W/H` in the flipped case.
    // Either way the BASE projected pixel must come from entry, not obs.
    // Test the invariant: |left - expectedX| < |left - wrongX| (the
    // rendered position is closer to the entry projection than to the
    // obs projection).
    const distToEntry = Math.min(
      Math.abs(left - (expectedProjectedX + 12)),
      Math.abs(left - (expectedProjectedX - 12 - 280)),
    );
    const distToWrong = Math.min(
      Math.abs(left - (wrongProjectedX + 12)),
      Math.abs(left - (wrongProjectedX - 12 - 280)),
    );
    expect(distToEntry).toBeLessThan(distToWrong);

    const distToEntryY = Math.min(
      Math.abs(top - (expectedProjectedY + 12)),
      Math.abs(top - (expectedProjectedY - 12 - 180)),
    );
    const distToWrongY = Math.min(
      Math.abs(top - (wrongProjectedY + 12)),
      Math.abs(top - (wrongProjectedY - 12 - 180)),
    );
    expect(distToEntryY).toBeLessThan(distToWrongY);
  });
});

/* ── Controllable camera (#736 — C3) ─────────────────────────────────────
   The scope-driven camera contract proven by the C0 prototype
   (frontend/prototypes/scope-prototype/ScopedMap.tsx) + the C1 maplibre-5.x
   ctx7 notes. Exercises:
     (1) reduced-motion duration:0 (+ essential:true)   — plan P3 gate
     (2) flyTo-preference over fitBounds on the same cycle — finding (f)
     (3) load-gating (no camera move before the `load` event)
     (4) maxBounds reactivity (prop, never imperative setMaxBounds) — finding (a)
     (5) ?scope=us bounds resolve to CONUS [[-130,20],[-65,52]]
   The map is accessed via getMap() (same as every other MapCanvas camera
   call, e.g. the cluster-click easeTo); fitBounds/flyTo/setMaxBounds are
   spies on `fakeMap`. */

const AZ_BOUNDS: [[number, number], [number, number]] = [
  [-114.815, 31.332],
  [-109.045, 37.004],
];
const CA_BOUNDS: [[number, number], [number, number]] = [
  [-124.482, 32.529],
  [-114.131, 42.009],
];
const CONUS_PROD_BOUNDS: [[number, number], [number, number]] = [
  [-130, 20],
  [-65, 52],
];

/** Stub window.matchMedia so a given query matches (the rest don't). */
function stubMatchMedia(matchingQuery: string | null) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: matchingQuery !== null && q === matchingQuery,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

describe('MapCanvas controllable camera (#736)', () => {
  const origMatchMedia = window.matchMedia;

  beforeEach(() => {
    capturedSourceProps = {};
    capturedLayerFilters = {};
    capturedSourcesById = {};
    capturedLayerPaint = {};
    registeredHandlers = {};
    bareHandlers = {};
    bareHandlersAll = {};
    deferMapLoad = false;
    deferredOnLoad = null;
    fakeMap = makeFakeMap();
    resizeObservers.length = 0; // #737/S3 — reset captured RO instances per test.
    document.documentElement.removeAttribute('data-theme');
    // Default: nothing matches (no reduced motion, fine pointer path is fine).
    stubMatchMedia(null);
    __resetAdaptiveGridCacheForTesting();
  });

  afterEach(() => {
    window.matchMedia = origMatchMedia;
  });

  it('fitBounds(state) on scope change uses asymmetric padding (top > bottom/left/right=48) + maxZoom 12 + essential:true + duration 600 (no reduced motion)', async () => {
    stubMatchMedia(null); // prefers-reduced-motion: reduce → false
    render(
      <MapCanvas observations={[]} bounds={AZ_BOUNDS} boundsKey="US-AZ" />,
    );
    await waitFor(() => expect(fakeMap.fitBounds).toHaveBeenCalled());
    const [bounds, opts] = fakeMap.fitBounds.mock.calls.at(-1);
    expect(bounds).toEqual(AZ_BOUNDS);
    // #737/S3: padding is now an asymmetric object — a larger TOP inset clears
    // the floating AppHeader + ScopeControl chrome that stacks over the
    // full-bleed canvas top edge post-#761/S2; the other three edges keep 48.
    expect(typeof opts.padding).toBe('object');
    expect(opts.padding.top).toBeGreaterThan(opts.padding.bottom);
    expect(opts.padding.top).toBeGreaterThan(opts.padding.left);
    expect(opts.padding.top).toBeGreaterThan(opts.padding.right);
    expect(opts.padding.bottom).toBe(48);
    expect(opts.padding.left).toBe(48);
    expect(opts.padding.right).toBe(48);
    expect(opts.maxZoom).toBe(12);
    expect(opts.essential).toBe(true);
    expect(opts.duration).toBe(600);
    expect(fakeMap.flyTo).not.toHaveBeenCalled();
  });

  it('mount-frame deep-link uses the same asymmetric fitBounds padding (initialViewState.fitBoundsOptions)', async () => {
    stubMatchMedia(null);
    render(
      <MapCanvas observations={[]} bounds={AZ_BOUNDS} boundsKey="US-AZ" />,
    );
    // Read the props the MockMap captured into data-props — the mount-frame
    // `initialViewState` carries `fitBoundsOptions` so a deep-linked scoped
    // landing (?state=US-AZ) frames with the same asymmetric padding, not the
    // legacy scalar 48.
    const mockMap = await screen.findByTestId('mock-map');
    const props = JSON.parse(mockMap.getAttribute('data-props') ?? '{}');
    const fitOpts = props.initialViewState?.fitBoundsOptions;
    expect(fitOpts).toBeTruthy();
    expect(typeof fitOpts.padding).toBe('object');
    expect(fitOpts.padding.top).toBeGreaterThan(fitOpts.padding.bottom);
    expect(fitOpts.padding.bottom).toBe(48);
    expect(fitOpts.padding.left).toBe(48);
    expect(fitOpts.padding.right).toBe(48);
    expect(fitOpts.maxZoom).toBe(12);
  });

  it('fitBounds duration is 0 (still essential:true + asymmetric padding) under prefers-reduced-motion (plan P3 gate)', async () => {
    stubMatchMedia('(prefers-reduced-motion: reduce)');
    render(
      <MapCanvas observations={[]} bounds={AZ_BOUNDS} boundsKey="US-AZ" />,
    );
    await waitFor(() => expect(fakeMap.fitBounds).toHaveBeenCalled());
    const [, opts] = fakeMap.fitBounds.mock.calls.at(-1);
    expect(opts.duration).toBe(0);
    expect(opts.essential).toBe(true);
    // #737/S3: reduced motion still lands the asymmetric camera instantly.
    expect(typeof opts.padding).toBe('object');
    expect(opts.padding.top).toBeGreaterThan(opts.padding.bottom);
  });

  it('prefers flyTo over fitBounds when both a state bounds AND a ZIP flyTo are present on the same cycle (finding f)', async () => {
    stubMatchMedia(null);
    render(
      <MapCanvas
        observations={[]}
        bounds={AZ_BOUNDS}
        boundsKey="US-AZ"
        flyTo={{ center: [-110.974, 32.222], zoom: 10, key: 'zip:85701' }}
      />,
    );
    await waitFor(() => expect(fakeMap.flyTo).toHaveBeenCalled());
    expect(fakeMap.fitBounds).not.toHaveBeenCalled();
    const [opts] = fakeMap.flyTo.mock.calls.at(-1);
    expect(opts.center).toEqual([-110.974, 32.222]);
    expect(opts.zoom).toBe(10); // ZIP_FLYTO_ZOOM
    expect(opts.essential).toBe(true);
    expect(opts.duration).toBe(800);
  });

  it('ZIP flyTo duration is 0 under prefers-reduced-motion', async () => {
    stubMatchMedia('(prefers-reduced-motion: reduce)');
    render(
      <MapCanvas
        observations={[]}
        bounds={AZ_BOUNDS}
        boundsKey="US-AZ"
        flyTo={{ center: [-110.974, 32.222], zoom: 10, key: 'zip:85701' }}
      />,
    );
    await waitFor(() => expect(fakeMap.flyTo).toHaveBeenCalled());
    const [opts] = fakeMap.flyTo.mock.calls.at(-1);
    expect(opts.duration).toBe(0);
    expect(opts.essential).toBe(true);
  });

  it('does NOT move the camera before the maplibre `load` event; fires the pending move after load (load-gating)', async () => {
    stubMatchMedia(null);
    deferMapLoad = true; // hold onLoad so mapReady stays false
    render(
      <MapCanvas observations={[]} bounds={AZ_BOUNDS} boundsKey="US-AZ" />,
    );
    // The ref is live (mapRef.current non-null) but `load` hasn't fired.
    await waitFor(() => expect(deferredOnLoad).toBeTypeOf('function'));
    expect(fakeMap.fitBounds).not.toHaveBeenCalled();

    // Fire the load event → mapReady flips true → the gated move runs.
    act(() => {
      deferredOnLoad!();
    });
    await waitFor(() => expect(fakeMap.fitBounds).toHaveBeenCalled());
    expect(fakeMap.fitBounds.mock.calls.at(-1)[0]).toEqual(AZ_BOUNDS);
  });

  it('calls map.resize() on a container box change (S2 flex→fixed transition) and is camera-neutral — no fitBounds/flyTo (#737/S3 gap 8)', async () => {
    stubMatchMedia(null);
    // No scope bounds → no scope-reframe fitBounds; isolates the resize path so a
    // fitBounds/flyTo call could only come from the resize handler (it must not).
    render(<MapCanvas observations={[]} />);
    await waitFor(() => expect(resizeObservers.length).toBeGreaterThan(0));
    const fitBefore = fakeMap.fitBounds.mock.calls.length;
    const flyBefore = fakeMap.flyTo.mock.calls.length;

    // Simulate the flex→fixed container box change. rAF is synchronous in this
    // suite, so the coalesced resize lands within act().
    act(() => {
      resizeObservers.at(-1)!.fire();
    });

    expect(fakeMap.resize).toHaveBeenCalled();
    // Camera-neutral: the resize handler must NOT schedule a camera move (which
    // would risk a bbox refetch — the S4 scope-gate invariant, report R1).
    expect(fakeMap.fitBounds.mock.calls.length).toBe(fitBefore);
    expect(fakeMap.flyTo.mock.calls.length).toBe(flyBefore);
  });

  it('isMobile cluster tier reads the full-bleed container width: 767 → mobile (3×3 grid-overflow), 768 → desktop (4×4 grid)', async () => {
    stubMatchMedia(null);
    // A 10-unique-family / 30-point cluster: pickGridShape returns
    // grid-overflow (3×3 + hiddenCount) when isMobile, but a 4×4 grid when
    // desktop (10–16 families) — so the rendered marker shape distinguishes the
    // tier at the 768px boundary the full-bleed read now sees.
    const cluster = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-110, 32] },
      properties: { cluster: true, cluster_id: 42, point_count: 30 },
    };
    fakeMap.queryRenderedFeatures.mockReturnValue([cluster]);
    const leaves = Array.from({ length: 10 }, (_, i) => ({
      type: 'Feature',
      properties: { familyCode: `fam${i}` },
    }));
    fakeMap.getSource.mockReturnValue({
      getClusterLeaves: vi.fn().mockResolvedValue(leaves),
      getClusterExpansionZoom: vi.fn().mockResolvedValue(11),
    });

    // 767px → mobile: pickGridShape caps families>8 at a 3×3 grid-overflow that
    // surfaces a "+N" hidden-count affordance.
    fakeMap.getContainer.mockReturnValue({
      getBoundingClientRect: () => ({ width: 767, height: 900 }),
    });
    const { unmount } = render(
      <MapCanvas observations={[makeObs()]} silhouettes={SILHOUETTES} />,
    );
    await waitFor(() => expect(bareHandlers['idle']).toBeTypeOf('function'));
    await act(async () => { await bareHandlers['idle']?.(); });
    await act(async () => { await Promise.resolve(); });
    // grid-overflow renders the hidden-count overflow cell.
    expect(
      screen.queryByTestId('adaptive-grid-marker-overflow'),
    ).not.toBeNull();
    unmount();

    // 768px → desktop: families 10–16 → a full 4×4 grid, NO overflow "+N".
    __resetAdaptiveGridCacheForTesting();
    fakeMap.getContainer.mockReturnValue({
      getBoundingClientRect: () => ({ width: 768, height: 900 }),
    });
    render(<MapCanvas observations={[makeObs()]} silhouettes={SILHOUETTES} />);
    await waitFor(() => expect(bareHandlers['idle']).toBeTypeOf('function'));
    await act(async () => { await bareHandlers['idle']?.(); });
    await act(async () => { await Promise.resolve(); });
    expect(
      screen.queryByTestId('adaptive-grid-marker-overflow'),
    ).toBeNull();
  });

  it('passes maxBounds as a reactive prop and NEVER calls setMaxBounds imperatively (finding a)', async () => {
    stubMatchMedia(null);
    const { rerender } = render(
      <MapCanvas observations={[]} bounds={AZ_BOUNDS} boundsKey="US-AZ" />,
    );
    const readMaxBounds = () => {
      const el = screen.getByTestId('mock-map');
      const props = JSON.parse(el.getAttribute('data-props') ?? '{}');
      return props.maxBounds;
    };
    expect(readMaxBounds()).toEqual(AZ_BOUNDS);

    // Change scope AZ→CA: the rendered maxBounds prop must update with no
    // imperative setMaxBounds call.
    rerender(
      <MapCanvas observations={[]} bounds={CA_BOUNDS} boundsKey="US-CA" />,
    );
    await waitFor(() => expect(readMaxBounds()).toEqual(CA_BOUNDS));
    expect(fakeMap.setMaxBounds).not.toHaveBeenCalled();
  });

  it('?scope=us bounds resolve to CONUS [[-130,20],[-65,52]] for both maxBounds and fitBounds', async () => {
    stubMatchMedia(null);
    render(
      <MapCanvas observations={[]} bounds={CONUS_PROD_BOUNDS} boundsKey="us" />,
    );
    const el = screen.getByTestId('mock-map');
    const props = JSON.parse(el.getAttribute('data-props') ?? '{}');
    expect(props.maxBounds).toEqual(CONUS_PROD_BOUNDS);
    await waitFor(() => expect(fakeMap.fitBounds).toHaveBeenCalled());
    expect(fakeMap.fitBounds.mock.calls.at(-1)[0]).toEqual(CONUS_PROD_BOUNDS);
  });

  it('defaults to the legacy CONUS view when no bounds prop is supplied (no-regression for existing callers)', () => {
    stubMatchMedia(null);
    // Existing callers (MapSurface, demo harnesses) pass no scope props.
    render(<MapCanvas observations={[makeObs()]} silhouettes={SILHOUETTES} />);
    expect(screen.getByTestId('map-canvas')).toBeInTheDocument();
    // No scope bounds → no imperative scope reframe (legacy initialViewState
    // frames CONUS). And maxBounds falls back to the CONUS constant.
    expect(fakeMap.fitBounds).not.toHaveBeenCalled();
    expect(fakeMap.flyTo).not.toHaveBeenCalled();
    const el = screen.getByTestId('mock-map');
    const props = JSON.parse(el.getAttribute('data-props') ?? '{}');
    expect(props.maxBounds).toEqual(CONUS_PROD_BOUNDS);
  });

  it('cluster-click easeTo is unchanged by the scope-camera layer', async () => {
    stubMatchMedia(null);
    render(
      <MapCanvas
        observations={[makeObs()]}
        silhouettes={SILHOUETTES}
        bounds={AZ_BOUNDS}
        boundsKey="US-AZ"
      />,
    );
    await waitFor(() =>
      expect(registeredHandlers['click:clusters']).toBeTypeOf('function'),
    );
    const getClusterExpansionZoom = vi.fn().mockResolvedValue(12);
    fakeMap.getSource.mockReturnValue({ getClusterExpansionZoom });
    fakeMap.queryRenderedFeatures.mockReturnValue([
      {
        properties: { cluster_id: 1 },
        geometry: { type: 'Point', coordinates: [-111, 34] },
      },
    ]);
    await act(async () => {
      registeredHandlers['click:clusters']({ point: [10, 10] } as never);
      await Promise.resolve();
    });
    await waitFor(() => expect(fakeMap.easeTo).toHaveBeenCalled());
    const [easeOpts] = fakeMap.easeTo.mock.calls.at(-1);
    expect(easeOpts.center).toEqual([-111, 34]);
    expect(easeOpts.zoom).toBe(12);
  });
});

/* ── State-artboard inverse mask (#760 / #762) ───────────────────────────────
   The mask is a single fill <Layer id="state-mask-fill"> inside a <Source
   id="state-mask"> rendered BEFORE the observations <Source>, so it sits above
   the basemap and below the cluster/observation layers (birds render inside the
   state on top of the gray). maskPolygon/clampPad are the two new props. The
   clamp (padded maxBounds) is decoupled from the fit target (tight bbox);
   renderWorldCopies:false is conditional on maskPolygon; MIN_ZOOM is 2.

   padBounds / ARTBOARD_PAD / MASK_FILL_* / buildMaskFeature are imported from
   mask.ts (single source of truth — do NOT re-literal the padded value). */

// A minimal 1-part MultiPolygon standing in for a state's render-only geometry.
const AZ_POLYGON: MultiPolygonGeom = {
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

describe('MapCanvas state-artboard mask (#762)', () => {
  const origMatchMedia = window.matchMedia;

  beforeEach(() => {
    capturedSourceProps = {};
    capturedLayerFilters = {};
    capturedSourcesById = {};
    capturedLayerPaint = {};
    registeredHandlers = {};
    bareHandlers = {};
    bareHandlersAll = {};
    deferMapLoad = false;
    deferredOnLoad = null;
    fakeMap = makeFakeMap();
    document.documentElement.removeAttribute('data-theme');
    stubMatchMedia(null);
    __resetAdaptiveGridCacheForTesting();
  });

  afterEach(() => {
    window.matchMedia = origMatchMedia;
  });

  const readMapProps = () => {
    const el = screen.getByTestId('mock-map');
    return JSON.parse(el.getAttribute('data-props') ?? '{}');
  };

  it('absent maskPolygon: NO state-mask source/layer; renderWorldCopies not forced (us / chooser unchanged)', async () => {
    render(
      <MapCanvas observations={[]} bounds={CONUS_PROD_BOUNDS} boundsKey="us" />,
    );
    // Source clause: no state-mask source.
    expect(capturedSourcesById['state-mask']).toBeUndefined();
    // Layer clause: state-mask-fill must not leak into the rendered layers.
    await waitFor(() => {
      const ids = screen
        .getAllByTestId('mock-layer')
        .map((el) => el.getAttribute('data-layer-id'));
      expect(ids).not.toContain('state-mask-fill');
    });
    // renderWorldCopies must NOT be forced false on the unmasked nationwide view
    // (must remain undefined/truthy so the world repeats at low zoom there).
    expect(readMapProps().renderWorldCopies).not.toBe(false);
  });

  it('with maskPolygon: state-mask-fill is the FIRST layer (mask <Source> before observations)', async () => {
    render(
      <MapCanvas
        observations={[]}
        silhouettes={SILHOUETTES}
        bounds={AZ_BOUNDS}
        boundsKey="US-AZ"
        maskPolygon={AZ_POLYGON}
        clampPad={ARTBOARD_PAD}
      />,
    );
    await waitFor(() => {
      const ids = screen
        .getAllByTestId('mock-layer')
        .map((el) => el.getAttribute('data-layer-id'));
      // Exact ordered 6-layer list: state-mask-fill FIRST, then the 5 obs layers.
      expect(ids).toEqual([
        'state-mask-fill',
        'clusters',
        'cluster-count',
        'clusters-hit',
        'notable-ring',
        'unclustered-point',
      ]);
    });
    // Source clause: the state-mask source IS present. Narrow to a local
    // before reading `.data` so `noUncheckedIndexedAccess` (tsconfig.test.json)
    // does not flag the bracket access as possibly-undefined.
    const maskSource = capturedSourcesById['state-mask'];
    expect(maskSource).toBeDefined();
    // The mask source carries the built inverse-mask Feature<Polygon>.
    expect(maskSource?.data).toEqual(buildMaskFeature(AZ_POLYGON));
  });

  it('with maskPolygon: renderWorldCopies === false (forward-compat invariant, #761)', () => {
    render(
      <MapCanvas
        observations={[]}
        bounds={AZ_BOUNDS}
        boundsKey="US-AZ"
        maskPolygon={AZ_POLYGON}
        clampPad={ARTBOARD_PAD}
      />,
    );
    expect(readMapProps().renderWorldCopies).toBe(false);
  });

  // Regression guard for the `state→us` in-place transition (PR #765 bot
  // review): `renderWorldCopies` must be an EXPLICIT prop on BOTH branches.
  // react-map-gl/maplibre does NOT reset an absent setting to its default — it
  // retains the last applied value. A spread-conditional that REMOVES the prop
  // when `maskPolygon` goes null would therefore leave world copies stuck at
  // `false` after leaving a state scope for `?scope=us`. The two fresh-mount
  // tests above do NOT catch this leak; only a RERENDER of the SAME instance
  // (no remount) reproduces it.
  it('rerender state→us flips renderWorldCopies false→true (no remount leak, #765)', () => {
    const { rerender } = render(
      <MapCanvas
        observations={[]}
        bounds={AZ_BOUNDS}
        boundsKey="US-AZ"
        maskPolygon={AZ_POLYGON}
        clampPad={ARTBOARD_PAD}
      />,
    );
    // Mask set → world copies OFF (declarative prop).
    expect(readMapProps().renderWorldCopies).toBe(false);

    // In-place prop update to the SAME instance: drop the mask (state→us).
    rerender(
      <MapCanvas
        observations={[]}
        bounds={CONUS_PROD_BOUNDS}
        boundsKey="us"
        maskPolygon={null}
      />,
    );
    // The explicit prop must reactively flip back ON — NOT retain stale false.
    expect(readMapProps().renderWorldCopies).toBe(true);
  });

  // Second regression guard (PR #765 live repro): the declarative prop alone is
  // necessary but NOT sufficient. The `state→us` switch also changes boundsKey,
  // which fires a `fitBounds` animation whose transform CLONE re-applies the old
  // `renderWorldCopies: false` every frame, clobbering react-map-gl's set. The
  // imperative reassertion effect (keyed on maskPolygon, re-asserted on
  // `moveend`) must set the live value back to `true` and KEEP it there after a
  // post-switch `moveend`. Asserts against the fakeMap's stateful getter/setter.
  it('rerender state→us imperatively reasserts renderWorldCopies=true and survives moveend (#765)', () => {
    const { rerender } = render(
      <MapCanvas
        observations={[]}
        bounds={AZ_BOUNDS}
        boundsKey="US-AZ"
        maskPolygon={AZ_POLYGON}
        clampPad={ARTBOARD_PAD}
      />,
    );
    // Mask set: the imperative effect drove the live map to world-copies OFF.
    expect(fakeMap.getRenderWorldCopies()).toBe(false);

    rerender(
      <MapCanvas
        observations={[]}
        bounds={CONUS_PROD_BOUNDS}
        boundsKey="us"
        maskPolygon={null}
      />,
    );
    // Imperative reassertion flipped the live map back ON.
    expect(fakeMap.getRenderWorldCopies()).toBe(true);

    // Simulate the camera animation clobbering the live value back to false…
    fakeMap.setRenderWorldCopies(false);
    // …then a `moveend` (animation finished): the reassertion handler must win.
    act(() => {
      bareHandlersAll['moveend']?.forEach((cb) => cb());
    });
    expect(fakeMap.getRenderWorldCopies()).toBe(true);
  });

  it('captured minZoom === 2 (backstop floor lowered for small states)', () => {
    render(
      <MapCanvas
        observations={[]}
        bounds={AZ_BOUNDS}
        boundsKey="US-AZ"
        maskPolygon={AZ_POLYGON}
        clampPad={ARTBOARD_PAD}
      />,
    );
    expect(readMapProps().minZoom).toBe(2);
  });

  it('clamp/fit decouple: maxBounds === padBounds(bounds, ARTBOARD_PAD); fit target stays the tight bbox (finding 1)', async () => {
    render(
      <MapCanvas
        observations={[]}
        bounds={AZ_BOUNDS}
        boundsKey="US-AZ"
        maskPolygon={AZ_POLYGON}
        clampPad={ARTBOARD_PAD}
      />,
    );
    // The reactive maxBounds prop is the PADDED clamp (single source of truth).
    expect(readMapProps().maxBounds).toEqual(padBounds(AZ_BOUNDS, ARTBOARD_PAD));
    // ...and is NOT the tight bbox (proves the decouple).
    expect(readMapProps().maxBounds).not.toEqual(AZ_BOUNDS);
    // The fit target stays the raw tight bbox.
    await waitFor(() => expect(fakeMap.fitBounds).toHaveBeenCalled());
    expect(fakeMap.fitBounds.mock.calls.at(-1)[0]).toEqual(AZ_BOUNDS);
  });

  it('no clampPad: maxBounds stays the raw bounds (legacy / us unchanged)', () => {
    render(
      <MapCanvas observations={[]} bounds={AZ_BOUNDS} boundsKey="US-AZ" />,
    );
    expect(readMapProps().maxBounds).toEqual(AZ_BOUNDS);
  });

  it('state-mask-fill paints fill-opacity 1 and the LIGHT color; repaints DARK on [data-theme] flip', async () => {
    render(
      <MapCanvas
        observations={[]}
        bounds={AZ_BOUNDS}
        boundsKey="US-AZ"
        maskPolygon={AZ_POLYGON}
        clampPad={ARTBOARD_PAD}
      />,
    );
    await waitFor(() =>
      expect(capturedLayerPaint['state-mask-fill']).toBeDefined(),
    );
    const lightPaint = capturedLayerPaint['state-mask-fill'] as Record<string, unknown>;
    expect(lightPaint['fill-opacity']).toBe(1);
    expect(lightPaint['fill-color']).toBe(MASK_FILL_LIGHT);

    // Flip [data-theme] → dark. The existing basemap MutationObserver also
    // drives setMaskTheme(next), so the <Layer> paint diffs to the dark color
    // with no remount.
    await act(async () => {
      document.documentElement.setAttribute('data-theme', 'dark');
      await Promise.resolve();
    });
    await waitFor(() => {
      const darkPaint = capturedLayerPaint['state-mask-fill'] as Record<string, unknown>;
      expect(darkPaint['fill-color']).toBe(MASK_FILL_DARK);
    });
  });

  it('state→state re-fit (fitBounds) inherits the reduced-motion guard (duration 600, essential:true)', async () => {
    stubMatchMedia(null);
    const { rerender } = render(
      <MapCanvas
        observations={[]}
        bounds={AZ_BOUNDS}
        boundsKey="US-AZ"
        maskPolygon={AZ_POLYGON}
        clampPad={ARTBOARD_PAD}
      />,
    );
    await waitFor(() => expect(fakeMap.fitBounds).toHaveBeenCalled());
    // Switch AZ→CA: a net-new artboard move (state→state re-fit).
    rerender(
      <MapCanvas
        observations={[]}
        bounds={CA_BOUNDS}
        boundsKey="US-CA"
        maskPolygon={AZ_POLYGON}
        clampPad={ARTBOARD_PAD}
      />,
    );
    await waitFor(() =>
      expect(fakeMap.fitBounds.mock.calls.at(-1)[0]).toEqual(CA_BOUNDS),
    );
    const [, opts] = fakeMap.fitBounds.mock.calls.at(-1);
    expect(opts.duration).toBe(600);
    expect(opts.essential).toBe(true);
  });

  it('state→state re-fit is instant (duration 0, essential:true) under prefers-reduced-motion', async () => {
    stubMatchMedia('(prefers-reduced-motion: reduce)');
    const { rerender } = render(
      <MapCanvas
        observations={[]}
        bounds={AZ_BOUNDS}
        boundsKey="US-AZ"
        maskPolygon={AZ_POLYGON}
        clampPad={ARTBOARD_PAD}
      />,
    );
    await waitFor(() => expect(fakeMap.fitBounds).toHaveBeenCalled());
    rerender(
      <MapCanvas
        observations={[]}
        bounds={CA_BOUNDS}
        boundsKey="US-CA"
        maskPolygon={AZ_POLYGON}
        clampPad={ARTBOARD_PAD}
      />,
    );
    await waitFor(() =>
      expect(fakeMap.fitBounds.mock.calls.at(-1)[0]).toEqual(CA_BOUNDS),
    );
    const [, opts] = fakeMap.fitBounds.mock.calls.at(-1);
    expect(opts.duration).toBe(0);
    expect(opts.essential).toBe(true);
  });

  it('ZIP flyTo within a masked state inherits the reduced-motion guard (duration 0, essential:true)', async () => {
    stubMatchMedia('(prefers-reduced-motion: reduce)');
    render(
      <MapCanvas
        observations={[]}
        bounds={AZ_BOUNDS}
        boundsKey="US-AZ"
        maskPolygon={AZ_POLYGON}
        clampPad={ARTBOARD_PAD}
        flyTo={{ center: [-110.974, 32.222], zoom: 10, key: 'zip:85701' }}
      />,
    );
    await waitFor(() => expect(fakeMap.flyTo).toHaveBeenCalled());
    const [opts] = fakeMap.flyTo.mock.calls.at(-1);
    expect(opts.duration).toBe(0);
    expect(opts.essential).toBe(true);
  });

  /* ── Artboard FIDELITY wiring (#763) ──────────────────────────────────────
     These assert the imperative work is WIRED through MapCanvas (the helper's
     own behavior is unit-tested in artboard-layers.test.ts). The label-bleed
     regression guard proper lives in the helper test (the within-shape
     assertion); here we confirm the reconcile-sequencing split, the guard, the
     teardown, and that the float/sink + isolation fire on an active mask. */

  it('with maskPolygon: label isolation merges ["within", buffered] into matching symbol layers only', async () => {
    render(
      <MapCanvas
        observations={[]}
        silhouettes={SILHOUETTES}
        bounds={AZ_BOUNDS}
        boundsKey="US-AZ"
        maskPolygon={AZ_POLYGON}
        clampPad={ARTBOARD_PAD}
      />,
    );
    await waitFor(() => expect(fakeMap.setFilter).toHaveBeenCalled());
    const touched = (fakeMap.setFilter.mock.calls as Array<[string, unknown]>).map(
      (c) => c[0],
    );
    // Matching symbol layers isolated…
    expect(touched).toEqual(
      expect.arrayContaining(['place_country', 'place_city', 'poi_z14']),
    );
    // …non-matching symbol + non-symbol layers untouched.
    expect(touched).not.toContain('transit_route_ref');
    expect(touched).not.toContain('water');

    // place_city had no original filter → merged filter is just ['within', geom].
    const cityCall = (fakeMap.setFilter.mock.calls as Array<[string, unknown[]]>).find(
      (c) => c[0] === 'place_city',
    );
    expect((cityCall?.[1] as unknown[])[0]).toBe('within');
    // place_country had an original → ['all', original, ['within', geom]].
    const countryCall = (fakeMap.setFilter.mock.calls as Array<[string, unknown[]]>).find(
      (c) => c[0] === 'place_country',
    );
    expect((countryCall?.[1] as unknown[])[0]).toBe('all');

    // The within geometry is the BUFFERED polygon (bbox strictly larger than the
    // exact maskPolygon the #762 fill uses) — the near-border-survival contract.
    const withinGeom = ((cityCall?.[1] as unknown[])[1]) as {
      coordinates: number[][][][];
    };
    const flatX = (g: { coordinates: number[][][][] }) =>
      g.coordinates.flat(3).filter((_, i) => i % 2 === 0);
    const exactMinX = Math.min(...flatX(AZ_POLYGON as never));
    const bufMinX = Math.min(...flatX(withinGeom));
    expect(bufMinX).toBeLessThan(exactMinX);

    // Defensive idle-map flush fired.
    expect(fakeMap.triggerRepaint).toHaveBeenCalled();
  });

  it('absent maskPolygon: NO label isolation, NO float layers (us/chooser untouched)', async () => {
    render(
      <MapCanvas observations={[]} bounds={CONUS_PROD_BOUNDS} boundsKey="us" />,
    );
    await waitFor(() => expect(fakeMap).not.toBeNull());
    // No within-merge on the unmasked nationwide view.
    expect(fakeMap.setFilter).not.toHaveBeenCalled();
    // No float layers added.
    const addedFloatIds = (fakeMap.addLayer.mock.calls as Array<[{ id?: string }]>)
      .map((c) => c[0]?.id)
      .filter((id): id is string => id === 'state-artboard-halo' || id === 'state-artboard-outline');
    expect(addedFloatIds).toHaveLength(0);
  });

  it('with maskPolygon: float layers (halo + crisp outline) add above the mask; stray basemap layers sunk', async () => {
    render(
      <MapCanvas
        observations={[]}
        silhouettes={SILHOUETTES}
        bounds={AZ_BOUNDS}
        boundsKey="US-AZ"
        maskPolygon={AZ_POLYGON}
        clampPad={ARTBOARD_PAD}
      />,
    );
    await waitFor(() => {
      const ids = (fakeMap.addLayer.mock.calls as Array<[{ id?: string }]>).map(
        (c) => c[0]?.id,
      );
      expect(ids).toContain('state-artboard-halo');
      expect(ids).toContain('state-artboard-outline');
    });
    // Float layers inserted ABOVE the mask: addLayer(spec, beforeId) inserts
    // BELOW beforeId, so the anchor is the first layer above state-mask-fill
    // (here: boundary_country) — NOT the mask id itself (which would put the
    // floats UNDER the gray).
    const haloCall = (fakeMap.addLayer.mock.calls as Array<[{ id?: string }, string?]>).find(
      (c) => c[0]?.id === 'state-artboard-halo',
    );
    expect(haloCall?.[1]).not.toBe('state-mask-fill');
    expect(haloCall?.[1]).toBe('boundary_country');
    // Stray basemap fill/line layers above the mask were sunk beneath it.
    const moved = (fakeMap.moveLayer.mock.calls as Array<[string, string]>).map(
      (c) => [c[0], c[1]],
    );
    expect(moved).toEqual(
      expect.arrayContaining([
        ['boundary_country', 'state-mask-fill'],
        ['landcover_glacier', 'state-mask-fill'],
      ]),
    );
  });

  it('with maskPolygon: state-mask-fill is moved BELOW the first basemap label layer (interior-label un-clip)', async () => {
    render(
      <MapCanvas
        observations={[]}
        silhouettes={SILHOUETTES}
        bounds={AZ_BOUNDS}
        boundsKey="US-AZ"
        maskPolygon={AZ_POLYGON}
        clampPad={ARTBOARD_PAD}
      />,
    );
    await waitFor(() => expect(fakeMap.moveLayer).toHaveBeenCalled());
    // The fidelity composite lowers state-mask-fill below the FIRST basemap
    // label (symbol) layer (here `place_country`, the first isolatable symbol),
    // so within-filtered INTERIOR labels paint ON TOP of the gray and a
    // near-border label is no longer sliced by the opaque mask.
    const moved = (fakeMap.moveLayer.mock.calls as Array<[string, string?]>);
    expect(moved).toEqual(
      expect.arrayContaining([['state-mask-fill', 'place_country']]),
    );
    // The mask is NEVER lowered below the app observation symbol layer or a
    // float layer (it anchors on the first ISOLATABLE basemap label only).
    expect(moved).not.toEqual(
      expect.arrayContaining([['state-mask-fill', 'transit_route_ref']]),
    );
  });

  it('[blocker guard] moveLayer is NOT called when state-mask-fill is absent at reconcile time', async () => {
    // Simulate the reconcile-sequencing window: react-map-gl has not re-added
    // the mask layer yet, so getLayer('state-mask-fill') returns undefined. The
    // float/sink effect must warn-and-return, NEVER call moveLayer (which would
    // throw `Cannot move layer before non-existing layer`).
    fakeMap.__setMaskLayerPresent(false);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(
      <MapCanvas
        observations={[]}
        silhouettes={SILHOUETTES}
        bounds={AZ_BOUNDS}
        boundsKey="US-AZ"
        maskPolygon={AZ_POLYGON}
        clampPad={ARTBOARD_PAD}
      />,
    );
    await waitFor(() => expect(fakeMap.setFilter).toHaveBeenCalled()); // isolation still ran
    // No moveLayer / float-add against the missing mask anchor.
    expect(fakeMap.moveLayer).not.toHaveBeenCalled();
    const addedFloatIds = (fakeMap.addLayer.mock.calls as Array<[{ id?: string }]>)
      .map((c) => c[0]?.id)
      .filter((id): id is string => id === 'state-artboard-halo' || id === 'state-artboard-outline');
    expect(addedFloatIds).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('state-mask-fill not yet reconciled'),
    );
    warnSpy.mockRestore();
  });

  it('[reconcile split] the style.load HANDLER re-invokes setFilter only — never moveLayer (the stray-sink lives in the post-reconcile maskPolygon effect)', async () => {
    render(
      <MapCanvas
        observations={[]}
        silhouettes={SILHOUETTES}
        bounds={AZ_BOUNDS}
        boundsKey="US-AZ"
        maskPolygon={AZ_POLYGON}
        clampPad={ARTBOARD_PAD}
      />,
    );
    await waitFor(() => expect(fakeMap.setFilter).toHaveBeenCalled());
    // Confirm a style.load handler was registered (the once-per-mount listener).
    expect((bareHandlersAll['style.load'] ?? []).length).toBeGreaterThan(0);
    // Clear the initial-apply spies so we observe ONLY the style.load re-apply.
    fakeMap.setFilter.mockClear();
    fakeMap.moveLayer.mockClear();

    // Simulate the reconcile WINDOW: react-map-gl has not re-added the mask
    // layer yet (getLayer('state-mask-fill') → undefined). Now fire style.load.
    // The handler re-applies LABEL isolation (setFilter); the styleEpoch bump it
    // emits re-runs the (3b) effect, which — because the mask is still absent —
    // warn-and-returns WITHOUT moveLayer. So across the whole flush, the ONLY
    // imperative op is setFilter: the handler never sinks, proving the split.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await act(async () => {
      fakeMap.__setMaskLayerPresent(false);
      (bareHandlersAll['style.load'] ?? []).forEach((cb) => cb());
      await Promise.resolve();
    });
    expect(fakeMap.setFilter).toHaveBeenCalled(); // label isolation re-applied
    expect(fakeMap.moveLayer).not.toHaveBeenCalled(); // never from the handler
    warnSpy.mockRestore();
  });

  it('[theme swap] float layers are RE-ADDED after a style.load (styleEpoch re-fires the float effect once the mask is back)', async () => {
    render(
      <MapCanvas
        observations={[]}
        silhouettes={SILHOUETTES}
        bounds={AZ_BOUNDS}
        boundsKey="US-AZ"
        maskPolygon={AZ_POLYGON}
        clampPad={ARTBOARD_PAD}
      />,
    );
    await waitFor(() => {
      const ids = (fakeMap.addLayer.mock.calls as Array<[{ id?: string }]>).map((c) => c[0]?.id);
      expect(ids).toContain('state-artboard-halo');
    });
    fakeMap.addLayer.mockClear();
    fakeMap.moveLayer.mockClear();

    // A style.load reload (the mask layer IS present, mirroring react-map-gl
    // having reconciled it by the time the styleEpoch effect re-runs).
    await act(async () => {
      fakeMap.__resetStyleLayers(); // mask present
      (bareHandlersAll['style.load'] ?? []).forEach((cb) => cb());
      await Promise.resolve();
    });

    // The styleEpoch bump re-ran the float/sink effect: floats re-added + sunk.
    const reAdded = (fakeMap.addLayer.mock.calls as Array<[{ id?: string }]>)
      .map((c) => c[0]?.id)
      .filter((id): id is string => id === 'state-artboard-halo' || id === 'state-artboard-outline');
    expect(reAdded).toEqual(
      expect.arrayContaining(['state-artboard-halo', 'state-artboard-outline']),
    );
    expect(fakeMap.moveLayer).toHaveBeenCalled();
  });

  it('teardown (state→us): restores captured original filters and removes float layers', async () => {
    const { rerender } = render(
      <MapCanvas
        observations={[]}
        silhouettes={SILHOUETTES}
        bounds={AZ_BOUNDS}
        boundsKey="US-AZ"
        maskPolygon={AZ_POLYGON}
        clampPad={ARTBOARD_PAD}
      />,
    );
    await waitFor(() => expect(fakeMap.setFilter).toHaveBeenCalled());
    fakeMap.setFilter.mockClear();
    fakeMap.removeLayer.mockClear();

    // state → us: maskPolygon → null. Teardown effect cleanup fires.
    rerender(
      <MapCanvas observations={[]} bounds={CONUS_PROD_BOUNDS} boundsKey="us" maskPolygon={null} />,
    );

    await waitFor(() => {
      // place_country restored to its ORIGINAL filter (not a within-merge).
      const restoreCall = (fakeMap.setFilter.mock.calls as Array<[string, unknown[]]>).find(
        (c) => c[0] === 'place_country',
      );
      expect(restoreCall).toBeDefined();
      expect((restoreCall?.[1] as unknown[])?.[0]).not.toBe('all');
    });
    // Float layers removed.
    const removed = (fakeMap.removeLayer.mock.calls as Array<[string]>).map((c) => c[0]);
    expect(removed).toEqual(
      expect.arrayContaining(['state-artboard-halo', 'state-artboard-outline']),
    );
  });
});

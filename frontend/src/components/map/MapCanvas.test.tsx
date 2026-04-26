import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { forwardRef, useEffect, useImperativeHandle } from 'react';
import type { FamilySilhouette, Observation } from '@bird-watch/shared-types';

/* ── Mock react-map-gl/maplibre ─────────────────────────────────────────────
   jsdom has no WebGL context so we stub Map, Source, and Layer as thin
   pass-through components that expose their props for assertion.
   Map is wrapped in forwardRef because MapCanvas passes a ref to it. */

let capturedSourceProps: Record<string, unknown> = {};
let capturedAttributionProps: Record<string, unknown> = {};

/* Handlers registered via map.on(event, layerId, cb). Keyed as `event:layer`. */
let registeredHandlers: Record<string, (e: { point: [number, number] }) => void> =
  {};
/* The fake MapLibre map instance exposed via mapRef.current.getMap(). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let fakeMap: any = null;

/**
 * Bare-event handlers (no layerId), keyed by event name. The reconciler
 * registers `map.on('load', cb)` and `map.on('idle', cb)` — both bare —
 * which the layer-keyed handler map can't capture.
 */
let bareHandlers: Record<string, () => void | Promise<void>> = {};

function makeFakeMap() {
  const canvas = { style: { cursor: '' }, clientWidth: 1440, clientHeight: 900 };
  // Sprite registry — addImage records here; hasImage looks up.
  const sprites = new Set<string>();
  return {
    on: vi.fn(
      (
        event: string,
        layerOrCb: string | ((e?: unknown) => void | Promise<void>),
        maybeCb?: (e: { point: [number, number] }) => void,
      ) => {
        if (typeof layerOrCb === 'string' && maybeCb) {
          registeredHandlers[`${event}:${layerOrCb}`] = maybeCb;
        } else if (typeof layerOrCb === 'function') {
          // Bare-event handler (load, idle, etc.). Last writer wins —
          // there's only one reconciler effect, but the test occasionally
          // re-renders, which will re-register.
          bareHandlers[event] = layerOrCb as () => void | Promise<void>;
        }
        // Support 2-arg form (event, listener) — used by MapMarkerHitLayer
        // for `move` / `idle` re-projection, and by the spiderfy outside-
        // click teardown for the bare `click` event.
        if (typeof layerOrCb === 'function') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          registeredHandlers[event] = layerOrCb as any;
        }
      },
    ),
    off: vi.fn(),
    queryRenderedFeatures: vi.fn(),
    getSource: vi.fn(),
    getLayer: vi.fn(),
    getCanvas: vi.fn(() => canvas),
    easeTo: vi.fn(),
    getZoom: vi.fn(() => 6),
    project: vi.fn(() => ({ x: 700, y: 400 })),
    unproject: vi.fn(() => [-111, 34]),
    addSource: vi.fn(),
    removeSource: vi.fn(),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    // Sprite registration (issue #246). Tests assert that addImage is
    // called for each silhouette + the _FALLBACK row, and that layers
    // are added AFTER all addImage calls resolve.
    addImage: vi.fn((id: string) => {
      sprites.add(id);
    }),
    hasImage: vi.fn((id: string) => sprites.has(id)),
    removeImage: vi.fn((id: string) => sprites.delete(id)),
  };
}

// Forward-ref mock factory shared between Map and MapView. MapCanvas now
// imports the maplibre Map component as `MapView` to keep the global
// `Map` constructor available; export both names so the mock survives
// future renames or wrapper additions.
const MockMap = forwardRef(function MockMap(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  { children, onLoad, ...rest }: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ref: any,
) {
  useImperativeHandle(ref, () => ({ getMap: () => fakeMap }), []);
  useEffect(() => {
    if (onLoad) onLoad();
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
    return (
      <div data-testid="mock-source" data-props={JSON.stringify(rest)}>
        {children as React.ReactNode}
      </div>
    );
  },
  Layer: (props: Record<string, unknown>) => (
    <div data-testid="mock-layer" data-layer-id={props.id} />
  ),
  AttributionControl: (props: Record<string, unknown>) => {
    capturedAttributionProps = props;
    return (
      <div
        data-testid="mock-attribution-control"
        data-props={JSON.stringify(props)}
      />
    );
  },
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

/* ── jsdom shims: SVG → image conversion needs Blob, URL.createObjectURL,
   and HTMLImageElement.decode. jsdom's Image polyfill never triggers
   `onload` because no real image loader runs. Override `Image` with a
   stub that resolves decode() synchronously; stub URL.createObjectURL +
   URL.revokeObjectURL to no-op since the data: URI never gets fetched. */
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

/* ── Import after mocks ───────���───────────────────────────────────────── */
const { MapCanvas } = await import('./MapCanvas.js');

/* ── Helpers ─────────────────��─────────────────────────────────────────── */

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
    regionId: null,
    silhouetteId: 'silhouetteId' in partial ? (partial.silhouetteId as string | null) : null,
    familyCode: 'familyCode' in partial ? (partial.familyCode as string | null) : null,
  };
}

function makeSilhouette(partial: Partial<FamilySilhouette> & { familyCode: string }): FamilySilhouette {
  return {
    familyCode: partial.familyCode,
    color: partial.color ?? '#123456',
    svgData: 'svgData' in partial ? (partial.svgData as string | null) : 'M0 0 L1 1',
    source: partial.source ?? null,
    license: partial.license ?? null,
    commonName: partial.commonName ?? null,
    creator: partial.creator ?? null,
  };
}

/**
 * Default silhouettes prop. Three families with curated svgData; one
 * uncurated to exercise the fallback tile path.
 */
const SILHOUETTES: FamilySilhouette[] = [
  {
    familyCode: 'tyrannidae',
    color: '#C77A2E',
    svgData: 'M0 0L1 1Z',
    source: 'placeholder',
    license: 'CC0',
    commonName: 'Tyrant Flycatchers',
    creator: null,
  },
  {
    familyCode: 'trochilidae',
    color: '#7B2D8E',
    svgData: 'M2 2L3 3Z',
    source: 'placeholder',
    license: 'CC0',
    commonName: 'Hummingbirds',
    creator: null,
  },
  {
    familyCode: 'picidae',
    color: '#FF0808',
    svgData: 'M4 4L5 5Z',
    source: 'placeholder',
    license: 'CC0',
    commonName: 'Woodpeckers',
    creator: null,
  },
  {
    familyCode: 'uncurated',
    color: '#888888',
    svgData: null,
    source: null,
    license: null,
    commonName: null,
    creator: null,
  },
];

describe('MapCanvas', () => {
  beforeEach(() => {
    capturedSourceProps = {};
    capturedAttributionProps = {};
    registeredHandlers = {};
    bareHandlers = {};
    fakeMap = makeFakeMap();
  });

  it('renders the map-canvas wrapper with data-testid', () => {
    const obs = Array.from({ length: 10 }, (_, i) =>
      makeObs({ subId: `S${String(i).padStart(3, '0')}` }),
    );
    render(<MapCanvas observations={obs} silhouettes={SILHOUETTES} />);
    expect(screen.getByTestId('map-canvas')).toBeInTheDocument();
  });

  it('passes a GeoJSON FeatureCollection to the Source component', () => {
    const obs = Array.from({ length: 10 }, (_, i) =>
      makeObs({ subId: `S${String(i).padStart(3, '0')}` }),
    );
    render(<MapCanvas observations={obs} silhouettes={SILHOUETTES} />);

    expect(capturedSourceProps.type).toBe('geojson');
    expect(capturedSourceProps.cluster).toBe(true);
    expect(capturedSourceProps.clusterMaxZoom).toBe(14);
    expect(capturedSourceProps.clusterRadius).toBe(50);

    const data = capturedSourceProps.data as { type: string; features: unknown[] };
    expect(data.type).toBe('FeatureCollection');
    expect(data.features).toHaveLength(10);
  });

  it('renders five Layer components: clusters, cluster-count, clusters-hit, notable-ring, unclustered-point', async () => {
    render(<MapCanvas observations={[makeObs()]} silhouettes={SILHOUETTES} />);

    // The unclustered-point symbol layer is gated on `spritesReady` —
    // mounted only after the addImage Promise.all resolves. Without
    // this gate, MapLibre would paint the symbol layer before any
    // sprite is registered and emit `missing-image` warnings on cold
    // load. Wait for the layer to appear before asserting the layer
    // count + ordering.
    await waitFor(() =>
      expect(
        screen
          .getAllByTestId('mock-layer')
          .map((el) => el.getAttribute('data-layer-id')),
      ).toContain('unclustered-point'),
    );

    const layers = screen.getAllByTestId('mock-layer');
    const layerIds = layers.map((el) => el.getAttribute('data-layer-id'));

    expect(layerIds).toContain('clusters');
    expect(layerIds).toContain('cluster-count');
    // Issue #248: invisible hit-test layer for small-cluster reconciliation.
    expect(layerIds).toContain('clusters-hit');
    // Issue #246: notable-ring is the new circle layer that paints amber
    // halos behind notable observations. Source-order matters — notable-ring
    // must come BEFORE unclustered-point so the ring renders BEHIND the
    // silhouette, preserving the family-color signal in the silhouette
    // body (an amber-tinted SDF would lose it).
    expect(layerIds).toContain('notable-ring');

    const ringIdx = layerIds.indexOf('notable-ring');
    const unclusteredIdx = layerIds.indexOf('unclustered-point');
    expect(ringIdx).toBeLessThan(unclusteredIdx);
  });

  it('renders the ObservationPopover (initially null / hidden)', () => {
    render(<MapCanvas observations={[makeObs()]} silhouettes={SILHOUETTES} />);
    // Popover renders nothing when observation is null.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders an AttributionControl crediting OpenStreetMap and OpenFreeMap', () => {
    // ODbL compliance: OSM-derived data must be attributed. The built-in
    // MapLibre attribution control is disabled on <Map> so that the standalone
    // <AttributionControl> can be configured with compact=false and custom
    // credit strings.
    render(<MapCanvas observations={[makeObs()]} silhouettes={SILHOUETTES} />);

    expect(screen.getByTestId('mock-attribution-control')).toBeInTheDocument();
    expect(capturedAttributionProps.compact).toBe(false);

    const custom = capturedAttributionProps.customAttribution as string[];
    expect(Array.isArray(custom)).toBe(true);
    expect(custom.join(' ')).toMatch(/OpenStreetMap/);
    expect(custom.join(' ')).toMatch(/OpenFreeMap/);
    expect(custom.join(' ')).toMatch(
      /openstreetmap\.org\/copyright/,
    );
    expect(custom.join(' ')).toMatch(/openfreemap\.org/);
  });

  it('credits eBird (Cornell Lab of Ornithology) in the AttributionControl (eBird ToU §3)', () => {
    // The map view is the only surface where the eBird credit is rendered
    // *inside* maplibre's AttributionControl rather than via SurfaceFooter,
    // because adding both would be redundant and visually noisy. The credit
    // must link to https://ebird.org and use rel="noopener" — matching the
    // OSM and OpenFreeMap entries in the same array. Do NOT introduce a
    // rel="noopener noreferrer" divergence inside this array.
    render(<MapCanvas observations={[makeObs()]} silhouettes={SILHOUETTES} />);
    const custom = capturedAttributionProps.customAttribution as string[];
    const ebirdEntry = custom.find((s) => /ebird/i.test(s));
    expect(ebirdEntry).toBeDefined();
    expect(ebirdEntry).toMatch(/https:\/\/ebird\.org/);
    expect(ebirdEntry).toMatch(/rel="noopener"/);
    expect(ebirdEntry).not.toMatch(/noreferrer/);
    expect(ebirdEntry).toMatch(/Cornell Lab/i);
  });

  /**
   * Regression test for the MapLibre 3.x→4.x cluster-click bug (PR #165,
   * issue #166): `GeoJSONSource.getClusterExpansionZoom` became Promise-based
   * in 4.x and silently ignores the legacy `(err, zoom)` callback, so cluster
   * clicks never zoomed the map. The fix awaits the returned Promise.
   *
   * This test mocks the source with the *new* Promise signature; if the
   * handler regresses back to callback-style, `easeTo` won't be called and
   * the assertion fails. That's the guardrail the prior unit tests lacked.
   */
  it('zooms to cluster when cluster click fires (Promise API)', async () => {
    render(<MapCanvas observations={[makeObs()]} silhouettes={SILHOUETTES} />);
    await waitFor(() =>
      expect(registeredHandlers['click:clusters']).toBeTypeOf('function'),
    );

    // Mock source returns a Promise — matches maplibre-gl 4.x signature.
    const getClusterExpansionZoom = vi.fn().mockResolvedValue(12);
    fakeMap.getSource.mockReturnValue({ getClusterExpansionZoom });

    // Mock the feature the cluster handler will look up.
    const clusterFeature = {
      properties: { cluster_id: 42 },
      geometry: { type: 'Point', coordinates: [-111.1, 34.0] },
    };
    fakeMap.queryRenderedFeatures.mockReturnValue([clusterFeature]);

    const handler = registeredHandlers['click:clusters'];
    if (!handler) throw new Error('click:clusters handler missing');
    await act(async () => {
      handler({ point: [100, 100] });
    });

    expect(getClusterExpansionZoom).toHaveBeenCalledWith(42);
    // Critically: arity must be 1 (clusterId only). In the buggy pre-fix
    // code the call was `getClusterExpansionZoom(id, cb)` — arity 2. Pinning
    // the argument count here is the guardrail that would have caught the
    // regression.
    expect(getClusterExpansionZoom.mock.calls[0]).toHaveLength(1);

    await waitFor(() =>
      expect(fakeMap.easeTo).toHaveBeenCalledWith({
        center: [-111.1, 34.0],
        zoom: 12,
      }),
    );
  });

  /* ── Cluster-click behavior (Spider v2) ──────────────────────────────
     Spider v2 auto-spider reconciler handles fanning at zoom >=
     CLUSTER_MAX_ZOOM. The cluster-click handler is now simplified:
       - zoom < CLUSTER_MAX_ZOOM → easeTo (zoom in).
       - zoom >= CLUSTER_MAX_ZOOM → NO-OP (auto-spider already fanned). */

  it('cluster click is a no-op at zoom >= CLUSTER_MAX_ZOOM (auto-spider already fanned)', async () => {
    render(<MapCanvas observations={[makeObs()]} silhouettes={[]} />);
    await waitFor(() =>
      expect(registeredHandlers['click:clusters']).toBeTypeOf('function'),
    );

    fakeMap.getZoom.mockReturnValue(15); // ≥ CLUSTER_MAX_ZOOM (14)
    const getClusterLeaves = vi.fn();
    const getClusterExpansionZoom = vi.fn();
    fakeMap.getSource.mockReturnValue({
      getClusterLeaves,
      getClusterExpansionZoom,
    });

    fakeMap.queryRenderedFeatures.mockReturnValue([
      {
        properties: { cluster_id: 7, point_count: 5 },
        geometry: { type: 'Point', coordinates: [-111, 34] },
      },
    ]);

    const handler = registeredHandlers['click:clusters'];
    if (!handler) throw new Error('click:clusters handler missing');
    await act(async () => {
      handler({ point: [100, 100] });
    });

    // At max zoom: no getClusterLeaves (removed), no getClusterExpansionZoom.
    expect(getClusterLeaves).not.toHaveBeenCalled();
    expect(getClusterExpansionZoom).not.toHaveBeenCalled();
    expect(fakeMap.easeTo).not.toHaveBeenCalled();
  });

  it('zooms in when zoom < CLUSTER_MAX_ZOOM regardless of point_count', async () => {
    render(<MapCanvas observations={[makeObs()]} silhouettes={[]} />);
    await waitFor(() =>
      expect(registeredHandlers['click:clusters']).toBeTypeOf('function'),
    );

    fakeMap.getZoom.mockReturnValue(10); // < 14
    const getClusterLeaves = vi.fn();
    const getClusterExpansionZoom = vi.fn().mockResolvedValue(11);
    fakeMap.getSource.mockReturnValue({
      getClusterLeaves,
      getClusterExpansionZoom,
    });

    fakeMap.queryRenderedFeatures.mockReturnValue([
      {
        properties: { cluster_id: 3, point_count: 3 },
        geometry: { type: 'Point', coordinates: [-111, 34] },
      },
    ]);

    const handler = registeredHandlers['click:clusters'];
    if (!handler) throw new Error('click:clusters handler missing');
    await act(async () => {
      handler({ point: [0, 0] });
    });

    expect(getClusterExpansionZoom).toHaveBeenCalled();
    expect(getClusterLeaves).not.toHaveBeenCalled();
  });

  it('swallows cluster-expansion Promise rejections (no throw)', async () => {
    render(<MapCanvas observations={[makeObs()]} silhouettes={SILHOUETTES} />);
    await waitFor(() =>
      expect(registeredHandlers['click:clusters']).toBeTypeOf('function'),
    );

    const getClusterExpansionZoom = vi
      .fn()
      .mockRejectedValue(new Error('boom'));
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
      // Must not throw even though the Promise rejects.
      expect(() => handler({ point: [0, 0] })).not.toThrow();
    });

    expect(fakeMap.easeTo).not.toHaveBeenCalled();
  });

  /* ── Issue #246: SDF silhouette pipeline ──────────────────────────────
     The MapCanvas.handleLoad flow registers one sprite per silhouette
     row (with non-null svgData) PLUS a `_FALLBACK` sprite. The symbol
     layer references those sprites by id via `icon-image: ['get',
     'silhouetteId']`. Tests below verify:
       (a) addImage is called for every silhouette + _FALLBACK,
       (b) the GeoJSON source data round-trips silhouetteId/color,
       (c) the popover's detail link wires through onSelectSpecies. */

  it('registers an addImage sprite for each silhouette row + the _FALLBACK sentinel', async () => {
    const sils = [
      makeSilhouette({ familyCode: 'tyrannidae' }),
      makeSilhouette({ familyCode: 'fringillidae' }),
      // svgData null — should NOT trigger addImage (no usable Phylopic).
      // _FALLBACK is registered separately below regardless.
      makeSilhouette({ familyCode: 'cuculidae', svgData: null }),
      makeSilhouette({ familyCode: '_FALLBACK' }),
    ];
    render(<MapCanvas observations={[makeObs()]} silhouettes={sils} />);

    await waitFor(() => {
      // Must have registered tyrannidae + fringillidae + _FALLBACK.
      const ids = fakeMap.addImage.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(ids).toContain('tyrannidae');
      expect(ids).toContain('fringillidae');
      expect(ids).toContain('_FALLBACK');
      // cuculidae has svgData null — no sprite. Its observations fall
      // back to the _FALLBACK sprite via the GeoJSON join.
      expect(ids).not.toContain('cuculidae');
    });

    // Each addImage call passes `{ sdf: true }` so the icon-color paint
    // expression in the symbol layer can tint the silhouette.
    for (const call of fakeMap.addImage.mock.calls) {
      const opts = call[2] as Record<string, unknown> | undefined;
      expect(opts?.sdf).toBe(true);
    }
  });

  it('does not call addImage when silhouettes prop is empty', () => {
    render(<MapCanvas observations={[makeObs()]} silhouettes={[]} />);
    // No silhouettes → no sprite registration. The symbol layer mounts
    // with `icon-image: ['get', 'silhouetteId']` looking up sprites that
    // don't exist; that surfaces as a missing-image warning at runtime,
    // which would be a Tier-1 dirty-console finding. The fix is to mount
    // MapCanvas only after silhouettes resolve — but that's a caller
    // concern; this test just confirms the no-silhouettes default is a
    // no-op (no spurious addImage calls).
    expect(fakeMap.addImage).not.toHaveBeenCalled();
  });

  it('GeoJSON features carry familyCode + silhouetteId + color from the silhouettes prop', async () => {
    const sils = [
      makeSilhouette({ familyCode: 'tyrannidae', color: '#C77A2E' }),
      makeSilhouette({ familyCode: '_FALLBACK', color: '#555555' }),
    ];
    const obs = [
      makeObs({
        subId: 'S100',
        familyCode: 'tyrannidae',
        silhouetteId: 'tyrannidae',
      }),
    ];
    render(<MapCanvas observations={obs} silhouettes={sils} />);

    const data = capturedSourceProps.data as { features: Array<{ properties: Record<string, unknown> }> };
    expect(data.features).toHaveLength(1);
    const props = data.features[0]!.properties;
    expect(props.familyCode).toBe('tyrannidae');
    expect(props.silhouetteId).toBe('tyrannidae');
    expect(props.color).toBe('#C77A2E');
  });

  it('clicking an unclustered point + clicking the popover detail link calls onSelectSpecies(speciesCode)', async () => {
    const onSelectSpecies = vi.fn();
    const obs = makeObs({
      subId: 'S200',
      speciesCode: 'gilwoo',
      comName: 'Gila Woodpecker',
    });
    render(
      <MapCanvas
        observations={[obs]}
        silhouettes={[makeSilhouette({ familyCode: '_FALLBACK' })]}
        onSelectSpecies={onSelectSpecies}
      />,
    );

    await waitFor(() =>
      expect(registeredHandlers['click:unclustered-point']).toBeTypeOf('function'),
    );

    // Simulate click on the unclustered-point layer with the obs feature.
    fakeMap.queryRenderedFeatures.mockReturnValue([
      { properties: { subId: 'S200' }, geometry: { type: 'Point', coordinates: [-110.9, 32.2] } },
    ]);
    const handler = registeredHandlers['click:unclustered-point']!;
    await act(async () => { handler({ point: [100, 100] }); });

    // Popover opens. Click the detail link.
    const link = await screen.findByRole('button', { name: /see species details/i });
    link.click();
    expect(onSelectSpecies).toHaveBeenCalledWith('gilwoo');
  });

  /* ── Issue #248: cluster-mosaic reconciler ─────────────────────────────
     The reconciler queries rendered cluster features on `load` and `idle`,
     and renders an HTML <Marker> per cluster with point_count <= 8. The
     mocked Marker component above renders a [data-testid=mock-marker] div
     so the tests can assert on which clusters got materialized. */

  it('does NOT materialize mosaic markers when silhouettes prop is empty', async () => {
    // Defensive: with no silhouettes (cache miss / API failure), the mosaic
    // would be all-fallback and add visual noise. Skip the whole reconciler
    // path so the existing colored-circle behavior takes over.
    //
    // NOTE: prior to #247, this asserted `bareHandlers['idle']` is
    // undefined. After #247 landed, MapMarkerHitLayer registers its own
    // bare `idle` handler for marker re-projection — unrelated to the
    // mosaic reconciler. Switched the assertion to the user-visible
    // outcome: no `<MosaicMarker>` (mocked as `data-testid=mock-marker`)
    // is mounted, even after firing the idle handler.
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
    expect(container.querySelector('[data-testid=mock-marker]')).toBeNull();
  });

  it('renders an HTML <Marker> for each cluster with point_count <= 8', async () => {
    // Stub queryRenderedFeatures to return three clusters: two small (mosaic
    // candidates) and one large (NOT a mosaic candidate — keeps colored
    // circle).
    const smallClusterA = {
      id: 1,
      properties: { cluster_id: 1, point_count: 3 },
      geometry: { type: 'Point', coordinates: [-110.9, 32.2] },
    };
    const smallClusterB = {
      id: 2,
      properties: { cluster_id: 2, point_count: 8 },
      geometry: { type: 'Point', coordinates: [-111.5, 33.0] },
    };
    const largeCluster = {
      id: 3,
      properties: { cluster_id: 3, point_count: 25 },
      geometry: { type: 'Point', coordinates: [-112.0, 34.5] },
    };

    fakeMap.queryRenderedFeatures.mockImplementation(
      (_: unknown, opts?: { layers?: string[] }) => {
        // Reconciler queries the invisible 'clusters-hit' layer to pick up
        // small clusters that are filtered out of the visible 'clusters'
        // circle layer.
        if (opts?.layers?.includes('clusters-hit')) {
          return [smallClusterA, smallClusterB, largeCluster];
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

    render(
      <MapCanvas observations={[makeObs()]} silhouettes={SILHOUETTES} />,
    );
    await waitFor(() => expect(bareHandlers['idle']).toBeTypeOf('function'));

    await act(async () => {
      await bareHandlers['idle']?.();
    });

    await waitFor(() => {
      const markers = screen.getAllByTestId('mock-marker');
      // 2 small clusters render as mosaics; the 25-point cluster is NOT a
      // candidate and stays as the colored cluster circle (filtered in via
      // the layer spec, not rendered as a Marker here).
      expect(markers).toHaveLength(2);
    });
  });

  it('reconciler runs on both load and idle events', async () => {
    fakeMap.queryRenderedFeatures.mockReturnValue([]);
    fakeMap.getSource.mockReturnValue({
      getClusterLeaves: vi.fn().mockResolvedValue([]),
    });

    render(
      <MapCanvas observations={[makeObs()]} silhouettes={SILHOUETTES} />,
    );

    // Both handlers must be registered — the issue spec calls out load AND
    // idle so the markers reconcile both at first paint and on every
    // pan/zoom settle. Missing 'load' = empty initial render until first
    // pan; missing 'idle' = stale markers after pan/zoom.
    await waitFor(() => {
      expect(bareHandlers['load']).toBeTypeOf('function');
      expect(bareHandlers['idle']).toBeTypeOf('function');
    });
  });

  it('aggregates leaves by familyCode via getClusterLeaves(id, 8, 0) Promise API', async () => {
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

    render(
      <MapCanvas observations={[makeObs()]} silhouettes={SILHOUETTES} />,
    );
    await waitFor(() => expect(bareHandlers['idle']).toBeTypeOf('function'));

    await act(async () => {
      await bareHandlers['idle']?.();
    });

    // Pin the call signature: maplibre-gl 5.x takes (clusterId, limit,
    // offset) and returns Promise<Feature[]>. The issue spec mandates
    // (8, 0) for the top-N pull. Bumping any of these args without
    // updating the unit test risks the same Promise-vs-callback regression
    // class as PR #165.
    await waitFor(() => {
      expect(getClusterLeaves).toHaveBeenCalledWith(99, 8, 0);
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

    render(
      <MapCanvas observations={[makeObs()]} silhouettes={SILHOUETTES} />,
    );
    await waitFor(() => expect(bareHandlers['idle']).toBeTypeOf('function'));

    // Handlers are void-returning (fire-and-forget) — invoking them must
    // not throw even when getClusterLeaves rejects. The internal try/catch
    // turns Promise rejections into silent drops; assert direct invocation
    // doesn't bubble.
    await act(async () => {
      expect(() => bareHandlers['idle']?.()).not.toThrow();
    });
  });

  /* ── Auto-spider reconciler (issue #277, Spider v2 Task 3) ─────────────
     The auto-spider effect queries 'unclustered-point' features on every
     idle, groups co-located obs via groupOverlapping, and renders
     StackedSilhouetteMarker leaves at fanned positions with a leader-line
     source. All four sub-cases in the Task 3 AC are covered here. */

  it('auto-spider: silhouettes empty → no stacked-silhouette-marker rendered', async () => {
    // AC #2: when silhouettes.length === 0, the reconciler short-circuits
    // before doing any projection work. No markers, no leader source.
    fakeMap.queryRenderedFeatures.mockReturnValue([]);
    fakeMap.getSource.mockReturnValue(null);

    render(<MapCanvas observations={[makeObs()]} silhouettes={[]} />);
    await act(async () => {
      await bareHandlers['idle']?.();
    });

    expect(
      document.querySelectorAll('[data-testid="stacked-silhouette-marker"]'),
    ).toHaveLength(0);
    // addSource should NOT have been called for the auto-spider leader source
    expect(
      fakeMap.addSource.mock.calls.some(
        (c: unknown[]) => c[0] === 'auto-spider-leader-lines',
      ),
    ).toBe(false);
  });

  it('auto-spider: 2 obs > threshold apart → no stacks, no markers, no leader data', async () => {
    // AC #3: when no stacks detected, state is []; no markers rendered; no
    // leader-line source update.
    // project returns distinct screen coords far apart so groupOverlapping
    // treats them as singletons.
    let callCount = 0;
    fakeMap.project.mockImplementation(() => {
      callCount += 1;
      return callCount % 2 === 0 ? { x: 0, y: 0 } : { x: 500, y: 500 };
    });

    const features = [
      {
        properties: {
          subId: 'SA1',
          comName: 'Bird A',
          familyCode: 'tyrannidae',
          locName: 'Loc A',
          obsDt: '2026-04-15T10:00:00Z',
          isNotable: false,
          color: '#C77A2E',
          silhouetteId: 'tyrannidae',
        },
        geometry: { type: 'Point', coordinates: [-111.0, 34.0] },
      },
      {
        properties: {
          subId: 'SA2',
          comName: 'Bird B',
          familyCode: 'picidae',
          locName: 'Loc B',
          obsDt: '2026-04-15T11:00:00Z',
          isNotable: false,
          color: '#FF0808',
          silhouetteId: 'picidae',
        },
        geometry: { type: 'Point', coordinates: [-112.0, 35.0] },
      },
    ];

    fakeMap.queryRenderedFeatures.mockImplementation(
      (_: unknown, opts?: { layers?: string[] }) => {
        if (opts?.layers?.includes('unclustered-point')) return features;
        return [];
      },
    );
    fakeMap.getSource.mockReturnValue(null);
    fakeMap.getLayer.mockReturnValue(null);

    render(<MapCanvas observations={[makeObs()]} silhouettes={SILHOUETTES} />);
    await waitFor(() => expect(bareHandlers['idle']).toBeTypeOf('function'));

    await act(async () => {
      await bareHandlers['idle']?.();
    });

    expect(
      document.querySelectorAll('[data-testid="stacked-silhouette-marker"]'),
    ).toHaveLength(0);
  });

  it('auto-spider: 5 obs at identical coords → 5 stacked-silhouette-marker elements + leader-line source with 5 LineStrings', async () => {
    // AC #4: 5 obs at same screen position → one stack → fanPositions gives
    // 5 leaf positions → 5 Marker+StackedSilhouetteMarker elements; leader-
    // line source setData called with 5 LineString features.
    fakeMap.project.mockReturnValue({ x: 700, y: 400 }); // all identical
    fakeMap.unproject.mockReturnValue({ lng: -111.0, lat: 34.0 });

    const makeFeature = (subId: string, familyCode: string) => ({
      properties: {
        subId,
        comName: `Bird ${subId}`,
        familyCode,
        locName: 'Same Hotspot',
        obsDt: '2026-04-15T10:00:00Z',
        isNotable: false,
        color: '#C77A2E',
        silhouetteId: familyCode,
      },
      geometry: { type: 'Point', coordinates: [-111.0, 34.0] },
    });

    const features = [
      makeFeature('SB1', 'tyrannidae'),
      makeFeature('SB2', 'tyrannidae'),
      makeFeature('SB3', 'trochilidae'),
      makeFeature('SB4', 'picidae'),
      makeFeature('SB5', 'tyrannidae'),
    ];

    fakeMap.queryRenderedFeatures.mockImplementation(
      (_: unknown, opts?: { layers?: string[] }) => {
        if (opts?.layers?.includes('unclustered-point')) return features;
        return [];
      },
    );

    // First getSource call (check if source exists) returns null → reconciler
    // calls addSource. Subsequent getSource calls return a mock with setData.
    const mockSetData = vi.fn();
    let sourceCallCount = 0;
    fakeMap.getSource.mockImplementation((id: string) => {
      if (id === 'auto-spider-leader-lines') {
        sourceCallCount += 1;
        // First call (existence check) → null. After addSource called, return
        // mock. Use a simple counter: first check is null, later ones return mock.
        return sourceCallCount <= 1 ? null : { setData: mockSetData };
      }
      return null;
    });
    fakeMap.getLayer.mockReturnValue(null); // layer not yet added

    render(<MapCanvas observations={[makeObs()]} silhouettes={SILHOUETTES} />);
    await waitFor(() => expect(bareHandlers['idle']).toBeTypeOf('function'));

    await act(async () => {
      await bareHandlers['idle']?.();
    });

    await waitFor(() => {
      const markers = document.querySelectorAll('[data-testid="stacked-silhouette-marker"]');
      expect(markers).toHaveLength(5);
    });

    // Leader-line source should have been added or setData called with
    // 5 LineString features.
    const addSourceCalls = fakeMap.addSource.mock.calls.filter(
      (c: unknown[]) => c[0] === 'auto-spider-leader-lines',
    );
    expect(addSourceCalls).toHaveLength(1);
    const sourceData = addSourceCalls[0]?.[1] as { data: { features: unknown[] } };
    expect(sourceData.data.features).toHaveLength(5);
  });

  it('auto-spider: cleanup unbinds load and idle listeners', async () => {
    // Verifies the effect cleanup function fires map.off for both 'load' and
    // 'idle' so reconcile stops running after the component is removed.
    // (The `cancelled` flag in the impl is defensive for future async yields —
    // reconcile is currently synchronous so the flag itself never fires;
    // listener removal is the real guard.)
    fakeMap.queryRenderedFeatures.mockReturnValue([]);
    fakeMap.getSource.mockReturnValue(null);

    const { unmount } = render(
      <MapCanvas observations={[makeObs()]} silhouettes={SILHOUETTES} />,
    );

    // Wait for the effect to register its listeners.
    await waitFor(() => expect(bareHandlers['idle']).toBeTypeOf('function'));

    // Trigger idle once so the listeners are confirmed attached.
    await act(async () => {
      await bareHandlers['idle']?.();
    });

    // Unmount — should fire the cleanup function.
    unmount();

    // Both 'load' and 'idle' must have been unregistered.
    const offCalls: [string, unknown][] = fakeMap.off.mock.calls as [string, unknown][];
    const removedEvents = offCalls.map((c) => c[0]);
    expect(removedEvents).toContain('load');
    expect(removedEvents).toContain('idle');
  });
});

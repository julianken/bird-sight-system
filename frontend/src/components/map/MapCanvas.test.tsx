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
  const canvas = { style: { cursor: '' } };
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
      },
    ),
    off: vi.fn(),
    queryRenderedFeatures: vi.fn(),
    getSource: vi.fn(),
    getCanvas: vi.fn(() => canvas),
    easeTo: vi.fn(),
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
    silhouetteId: null,
    familyCode: null,
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
  },
  {
    familyCode: 'trochilidae',
    color: '#7B2D8E',
    svgData: 'M2 2L3 3Z',
    source: 'placeholder',
    license: 'CC0',
    commonName: 'Hummingbirds',
  },
  {
    familyCode: 'picidae',
    color: '#FF0808',
    svgData: 'M4 4L5 5Z',
    source: 'placeholder',
    license: 'CC0',
    commonName: 'Woodpeckers',
  },
  {
    familyCode: 'uncurated',
    color: '#888888',
    svgData: null,
    source: null,
    license: null,
    commonName: null,
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

  it('renders four Layer components: clusters, cluster-count, clusters-hit, unclustered-point', () => {
    render(<MapCanvas observations={[makeObs()]} silhouettes={SILHOUETTES} />);

    const layers = screen.getAllByTestId('mock-layer');
    const layerIds = layers.map((el) => el.getAttribute('data-layer-id'));

    expect(layerIds).toContain('clusters');
    expect(layerIds).toContain('cluster-count');
    // Issue #248: invisible hit-test layer for small-cluster reconciliation.
    expect(layerIds).toContain('clusters-hit');
    expect(layerIds).toContain('unclustered-point');
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

  /* ── Issue #248: cluster-mosaic reconciler ─────────────────────────────
     The reconciler queries rendered cluster features on `load` and `idle`,
     and renders an HTML <Marker> per cluster with point_count <= 8. The
     mocked Marker component above renders a [data-testid=mock-marker] div
     so the tests can assert on which clusters got materialized. */

  it('does NOT register an idle/load reconciler when silhouettes prop is empty', async () => {
    // Defensive: with no silhouettes (cache miss / API failure), the mosaic
    // would be all-fallback and add visual noise. Skip the whole reconciler
    // path so the existing colored-circle behavior takes over.
    render(<MapCanvas observations={[makeObs()]} silhouettes={[]} />);
    // Layer-bound handlers still register; bare handlers should not.
    expect(bareHandlers['idle']).toBeUndefined();
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
});

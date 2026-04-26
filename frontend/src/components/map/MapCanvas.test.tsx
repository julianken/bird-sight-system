import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { forwardRef, useEffect, useImperativeHandle } from 'react';
import type { Observation } from '@bird-watch/shared-types';

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

function makeFakeMap() {
  const canvas = { style: { cursor: '' } };
  return {
    on: vi.fn(
      (
        event: string,
        layerOrCb: string | (() => void),
        maybeCb?: (e: { point: [number, number] }) => void,
      ) => {
        if (typeof layerOrCb === 'string' && maybeCb) {
          registeredHandlers[`${event}:${layerOrCb}`] = maybeCb;
        }
      },
    ),
    queryRenderedFeatures: vi.fn(),
    getSource: vi.fn(),
    getCanvas: vi.fn(() => canvas),
    easeTo: vi.fn(),
  };
}

vi.mock('react-map-gl/maplibre', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Map: forwardRef(function MockMap({ children, onLoad, ...rest }: any, ref: any) {
    useImperativeHandle(ref, () => ({ getMap: () => fakeMap }), []);
    useEffect(() => {
      if (onLoad) onLoad();
    }, [onLoad]);
    return (
      <div data-testid="mock-map" data-props={JSON.stringify(rest)}>
        {children}
      </div>
    );
  }),
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

describe('MapCanvas', () => {
  beforeEach(() => {
    capturedSourceProps = {};
    capturedAttributionProps = {};
    registeredHandlers = {};
    fakeMap = makeFakeMap();
  });

  it('renders the map-canvas wrapper with data-testid', () => {
    const obs = Array.from({ length: 10 }, (_, i) =>
      makeObs({ subId: `S${String(i).padStart(3, '0')}` }),
    );
    render(<MapCanvas observations={obs} />);
    expect(screen.getByTestId('map-canvas')).toBeInTheDocument();
  });

  it('passes a GeoJSON FeatureCollection to the Source component', () => {
    const obs = Array.from({ length: 10 }, (_, i) =>
      makeObs({ subId: `S${String(i).padStart(3, '0')}` }),
    );
    render(<MapCanvas observations={obs} />);

    expect(capturedSourceProps.type).toBe('geojson');
    expect(capturedSourceProps.cluster).toBe(true);
    expect(capturedSourceProps.clusterMaxZoom).toBe(14);
    expect(capturedSourceProps.clusterRadius).toBe(50);

    const data = capturedSourceProps.data as { type: string; features: unknown[] };
    expect(data.type).toBe('FeatureCollection');
    expect(data.features).toHaveLength(10);
  });

  it('renders three Layer components: clusters, cluster-count, unclustered-point', () => {
    render(<MapCanvas observations={[makeObs()]} />);

    const layers = screen.getAllByTestId('mock-layer');
    const layerIds = layers.map((el) => el.getAttribute('data-layer-id'));

    expect(layerIds).toContain('clusters');
    expect(layerIds).toContain('cluster-count');
    expect(layerIds).toContain('unclustered-point');
  });

  it('renders the ObservationPopover (initially null / hidden)', () => {
    render(<MapCanvas observations={[makeObs()]} />);
    // Popover renders nothing when observation is null.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders an AttributionControl crediting OpenStreetMap and OpenFreeMap', () => {
    // ODbL compliance: OSM-derived data must be attributed. The built-in
    // MapLibre attribution control is disabled on <Map> so that the standalone
    // <AttributionControl> can be configured with compact=false and custom
    // credit strings.
    render(<MapCanvas observations={[makeObs()]} />);

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
    render(<MapCanvas observations={[makeObs()]} />);
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
    render(<MapCanvas observations={[makeObs()]} />);
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
    render(<MapCanvas observations={[makeObs()]} />);
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
    await act(async () => {
      // Must not throw even though the Promise rejects.
      expect(() => handler({ point: [0, 0] })).not.toThrow();
    });

    expect(fakeMap.easeTo).not.toHaveBeenCalled();
  });
});

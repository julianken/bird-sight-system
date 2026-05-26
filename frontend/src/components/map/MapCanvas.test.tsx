import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { forwardRef, useEffect, useImperativeHandle } from 'react';
import type { FamilySilhouette, Observation } from '@bird-watch/shared-types';

/* ── Mock react-map-gl/maplibre ─────────────────────────────────────────────
   jsdom has no WebGL context so we stub Map, Source, and Layer as thin
   pass-through components that expose their props for assertion.
   Map is wrapped in forwardRef because MapCanvas passes a ref to it. */

let capturedSourceProps: Record<string, unknown> = {};
let capturedAttributionProps: Record<string, unknown> = {};
let capturedLayerFilters: Record<string, unknown> = {};

let registeredHandlers: Record<string, (e: { point: [number, number] }) => void> = {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let fakeMap: any = null;
let bareHandlers: Record<string, () => void | Promise<void>> = {};
let bareHandlersAll: Record<string, Array<() => void | Promise<void>>> = {};

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
    getLayer: vi.fn(),
    getCanvas: vi.fn(() => canvas),
    getContainer: vi.fn(() => container),
    easeTo: vi.fn(),
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
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    addImage: vi.fn((id: string) => {
      sprites.add(id);
    }),
    hasImage: vi.fn((id: string) => sprites.has(id)),
    removeImage: vi.fn((id: string) => sprites.delete(id)),
    setStyle: vi.fn(),
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
  Layer: (props: Record<string, unknown>) => {
    if (typeof props.id === 'string') {
      capturedLayerFilters[props.id] = props.filter;
    }
    return <div data-testid="mock-layer" data-layer-id={props.id} />;
  },
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
    capturedAttributionProps = {};
    capturedLayerFilters = {};
    registeredHandlers = {};
    bareHandlers = {};
    bareHandlersAll = {};
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

  it('renders five Layer components: clusters, cluster-count, clusters-hit, notable-ring, unclustered-point', async () => {
    render(<MapCanvas observations={[]} silhouettes={SILHOUETTES} />);
    await waitFor(() => {
      const ids = screen
        .getAllByTestId('mock-layer')
        .map((el) => el.getAttribute('data-layer-id'));
      expect(ids).toEqual(
        expect.arrayContaining([
          'clusters',
          'cluster-count',
          'clusters-hit',
          'notable-ring',
          'unclustered-point',
        ]),
      );
    });
  });

  it('renders the AttributionControl with OSM + OpenFreeMap + eBird (ToU §3)', () => {
    render(<MapCanvas observations={[]} />);
    const attribution = capturedAttributionProps['customAttribution'] as string[];
    expect(attribution.join(' ')).toMatch(/OpenStreetMap/);
    expect(attribution.join(' ')).toMatch(/OpenFreeMap/);
    expect(attribution.join(' ')).toMatch(/eBird/);
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

// Phase 3 (#560) — popover-originated onSelectSpecies attaches bbox
// These tests run in a separate describe block that resets modules to
// pick up the pointer:fine matchMedia stub for AdaptiveGridMarker.
describe('onSelectSpecies popover-bbox wire (Phase 3, #560)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let MapCanvasFresh: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let resetCacheFresh: any;

  beforeEach(async () => {
    capturedSourceProps = {};
    capturedAttributionProps = {};
    capturedLayerFilters = {};
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

  it('calls set with bbox derived from cluster coordinates when a species row is clicked', async () => {
    // Cluster at known coordinates — getClusterBbox will return
    // [lng, lat, lng, lat] (degenerate bbox for a single-member group).
    const clusterLng = -110.9;
    const clusterLat = 32.2;
    const cluster = {
      id: 1,
      properties: { cluster_id: 1, point_count: 3 },
      geometry: { type: 'Point', coordinates: [clusterLng, clusterLat] },
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

    // The wrapper must have called onSelectSpecies with the bbox from
    // getClusterBbox(group). For a single-member group whose anchor is at
    // (clusterLng, clusterLat), the bbox is the degenerate tuple
    // [lngMin, latMin, lngMax, latMax] = [clusterLng, clusterLat, clusterLng, clusterLat]
    // (rounded to 6 decimals).
    expect(onSelectSpecies).toHaveBeenCalledOnce();
    const [code, bbox] = onSelectSpecies.mock.calls[0];
    expect(code).toBe('annhum');
    expect(Array.isArray(bbox)).toBe(true);
    expect(bbox).toHaveLength(4);
    // All four values are the cluster's center coordinates (degenerate single-leaf bbox).
    expect(bbox[0]).toBeCloseTo(clusterLng, 5);
    expect(bbox[1]).toBeCloseTo(clusterLat, 5);
    expect(bbox[2]).toBeCloseTo(clusterLng, 5);
    expect(bbox[3]).toBeCloseTo(clusterLat, 5);
  });

  it('bbox matches THIS cluster leaves, not a neighboring cluster', async () => {
    // Two clusters at distinct coordinates. Click the first → bbox must
    // match the first cluster, not the second.
    const clusterA = {
      id: 1,
      properties: { cluster_id: 1, point_count: 2 },
      geometry: { type: 'Point', coordinates: [-110.0, 32.0] },
    };
    const clusterB = {
      id: 2,
      properties: { cluster_id: 2, point_count: 2 },
      geometry: { type: 'Point', coordinates: [-112.0, 34.0] },
    };
    fakeMap.queryRenderedFeatures.mockImplementation(
      (_: unknown, opts?: { layers?: string[] }) =>
        opts?.layers?.includes('clusters-hit') ? [clusterA, clusterB] : [],
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
      const markers = screen.queryAllByTestId('adaptive-grid-marker');
      expect(markers.length).toBeGreaterThanOrEqual(2);
    });

    // Click the first rendered cell (corresponds to clusterA at lng=-110, lat=32).
    const cells = screen.queryAllByTestId('adaptive-grid-marker-cell-rendered');
    expect(cells.length).toBeGreaterThanOrEqual(1);
    fireEvent.mouseEnter(cells[0]);
    fireEvent.click(cells[0]);

    await waitFor(() => {
      expect(screen.getByTestId('cell-popover')).toBeInTheDocument();
    });
    const speciesRows = screen.queryAllByTestId('cell-popover-row');
    expect(speciesRows.length).toBeGreaterThan(0);
    fireEvent.click(speciesRows[0]);

    expect(onSelectSpecies).toHaveBeenCalledOnce();
    const [code, bbox] = onSelectSpecies.mock.calls[0];
    expect(code).toBe('annhum');
    // bbox must NOT be the second cluster's coordinates.
    expect(bbox[0]).not.toBeCloseTo(-112.0, 1);
    // bbox must be within the range of valid coordinates (finite, bounded).
    expect(Number.isFinite(bbox[0])).toBe(true);
    expect(Number.isFinite(bbox[1])).toBe(true);
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

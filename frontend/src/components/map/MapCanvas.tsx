import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Map, Source, Layer, AttributionControl } from 'react-map-gl/maplibre';
import type { MapLayerMouseEvent, MapRef } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Observation } from '@bird-watch/shared-types';
import { basemapStyle } from './basemap-style.js';
import {
  observationsToGeoJson,
  buildClusterLayerSpec,
  buildClusterCountLayerSpec,
  buildUnclusteredPointLayerSpec,
  CLUSTER_MAX_ZOOM,
  CLUSTER_RADIUS,
} from './observation-layers.js';
import { ObservationPopover } from './ObservationPopover.js';
import {
  spiderfyCluster,
  SPIDERFY_MAX_LEAVES,
  type SpiderfyState,
} from './spiderfy.js';
import {
  MapMarkerHitLayer,
  type HitTargetMarker,
} from './MapMarkerHitLayer.js';

export interface MapCanvasProps {
  observations: Observation[];
}

/** Arizona center — default initial view. */
const INITIAL_VIEW = {
  longitude: -111.0937,
  latitude: 34.0489,
  zoom: 6,
} as const;

/**
 * MapLibre GL JS map instance wrapped via react-map-gl/maplibre.
 *
 * Click handling uses the raw MapLibre `map.on('click', layerId, ...)` API
 * instead of react-map-gl's `interactiveLayerIds` + `onClick` — the JSX
 * abstraction doesn't populate `e.features` when layers are added via
 * `<Source>`/`<Layer>` children (prototype learnings #1, #5).
 *
 * Spiderfy (issue #247): when a cluster contains ≤8 points and the map is
 * at zoom ≥ CLUSTER_MAX_ZOOM, clicking the cluster fans the leaves out
 * radially with leader lines instead of zooming further. The leaves
 * become individually clickable via `MapMarkerHitLayer` (HTML overlay
 * with per-marker `aria-label`). Outside-click or Escape clears spiderfy.
 */
export function MapCanvas({ observations }: MapCanvasProps) {
  const mapRef = useRef<MapRef>(null);
  const [selectedObs, setSelectedObs] = useState<Observation | null>(null);
  /* Active spiderfy state (null when no cluster is currently spiderfied).
     Holds the projected leaves + a teardown closure that removes the
     transient leader-line layer/source. */
  const [spiderfy, setSpiderfy] = useState<SpiderfyState | null>(null);
  const spiderfyRef = useRef<SpiderfyState | null>(null);
  spiderfyRef.current = spiderfy;
  /* Map ready flag — flips to `true` once `onLoad` fires so the hit-layer
     gets a real map ref to project against. */
  const [mapReady, setMapReady] = useState(false);
  /* Coarse-pointer detection (mobile). matchMedia is the canonical way; we
     read it on mount and listen for changes. */
  const [isCoarsePointer, setIsCoarsePointer] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(pointer: coarse)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(pointer: coarse)');
    const handler = (e: MediaQueryListEvent) => setIsCoarsePointer(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const geojson = useMemo(
    () => observationsToGeoJson(observations),
    [observations],
  );

  // Build layer specs once — they read CSS tokens at construction time.
  const clusterLayer = useMemo(() => buildClusterLayerSpec(), []);
  const clusterCountLayer = useMemo(() => buildClusterCountLayerSpec(), []);
  const unclusteredLayer = useMemo(() => buildUnclusteredPointLayerSpec(), []);

  // Observation lookup by subId for click handler.
  const obsLookup = useMemo(() => {
    const lookup: Record<string, Observation> = Object.create(null);
    for (const o of observations) lookup[o.subId] = o;
    return lookup;
  }, [observations]);

  // Ref keeps the click handler's closure fresh when observations change.
  // `onLoad` only fires once, so a plain closure over `obsLookup` would go
  // stale after the first data refresh. The ref indirection ensures clicks
  // always read the latest lookup.
  const obsLookupRef = useRef(obsLookup);
  obsLookupRef.current = obsLookup;

  /* Tear down any active spiderfy and clear state. Stable identity so
     effects depending on it don't churn. */
  const closeSpiderfy = useCallback(() => {
    const current = spiderfyRef.current;
    if (current) {
      try {
        current.teardown();
      } catch {
        /* idempotent — silent failure on already-removed layer */
      }
      setSpiderfy(null);
    }
  }, []);

  /**
   * Wire click handling through the raw MapLibre instance. This avoids the
   * react-map-gl `e.features` bug (see prototype learnings #1).
   */
  const handleLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    map.on('click', 'unclustered-point', (e: MapLayerMouseEvent) => {
      // Intentionally untyped: `MapGeoJSONFeature` (re-exported from
      // maplibre-gl 5.x) is now a class with internal fields `_x/_y/_z/
      // projectPoint/projectLine`. `react-map-gl/maplibre`'s re-exported
      // `MapInstance.queryRenderedFeatures` returns that class-shaped type,
      // so letting inference handle it avoids a structural mismatch under
      // `exactOptionalPropertyTypes: true`. We only touch `.properties?.subId`
      // and `.geometry` below, both of which survive the inference.
      const features = map.queryRenderedFeatures(e.point, {
        layers: ['unclustered-point'],
      });
      const feature = features[0];
      if (!feature) return;

      const subId = feature.properties?.subId as string | undefined;
      if (subId) {
        const obs = obsLookupRef.current[subId];
        if (obs) setSelectedObs(obs);
      }
    });

    // Cluster click. Branch on (point_count, zoom):
    //   point_count > 8 OR zoom < CLUSTER_MAX_ZOOM → existing zoom-into-
    //     cluster behavior.
    //   point_count ≤ 8 AND zoom ≥ CLUSTER_MAX_ZOOM → spiderfy.
    map.on('click', 'clusters', (e: MapLayerMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: ['clusters'],
      });
      const feature = features[0];
      if (!feature) return;

      const clusterId = feature.properties?.cluster_id as number | undefined;
      const pointCount = feature.properties?.point_count as number | undefined;
      const source = map.getSource('observations');
      if (clusterId == null || !source) return;

      const currentZoom = map.getZoom();
      const shouldSpiderfy =
        pointCount != null &&
        pointCount <= SPIDERFY_MAX_LEAVES &&
        currentZoom >= CLUSTER_MAX_ZOOM;

      const geom = feature.geometry;
      const center: [number, number] | null =
        geom.type === 'Point' ? (geom.coordinates as [number, number]) : null;

      if (shouldSpiderfy && center && 'getClusterLeaves' in source) {
        // Tear down any prior spiderfy before opening a new one.
        if (spiderfyRef.current) {
          try {
            spiderfyRef.current.teardown();
          } catch {
            /* no-op */
          }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        spiderfyCluster({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          map: map as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          source: source as any,
          clusterId,
          clusterLngLat: center,
        })
          .then((state) => setSpiderfy(state))
          .catch(() => {
            /* silently ignore — match the err-swallow convention used by
               the zoom-into-cluster branch below */
          });
        return;
      }

      if ('getClusterExpansionZoom' in source) {
        // MapLibre 5.x: `getClusterExpansionZoom` (and `getClusterChildren`,
        // `getClusterLeaves`) returns a Promise and no longer invokes the
        // legacy callback argument. Passing a callback silently no-ops —
        // which is how this regression shipped (see PR #165 / issue #166).
        const src = source as {
          getClusterExpansionZoom: (id: number) => Promise<number>;
        };
        src
          .getClusterExpansionZoom(clusterId)
          .then((zoom) => {
            if (center) {
              map.easeTo({ center, zoom });
            }
          })
          .catch(() => {
            /* silently ignore — matches previous err-swallow behavior */
          });
      }
    });

    // Background click closes any open spiderfy. Registered on the bare
    // `click` event, then we filter out clicks on the cluster/unclustered
    // layers (those have their own handlers above).
    map.on('click', (e: MapLayerMouseEvent) => {
      if (!spiderfyRef.current) return;
      const hits = map.queryRenderedFeatures(e.point, {
        layers: ['clusters', 'unclustered-point'],
      });
      if (hits.length > 0) return;
      // Click landed on the basemap → close spiderfy.
      closeSpiderfy();
    });

    // Pan/zoom closes the spiderfy — the leader-line geometry is anchored
    // to the original lng/lats so the spider visually breaks if the map
    // moves under it.
    map.on('zoomstart', () => {
      if (spiderfyRef.current) closeSpiderfy();
    });

    // Change cursor on hover.
    map.on('mouseenter', 'clusters', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'clusters', () => {
      map.getCanvas().style.cursor = '';
    });
    map.on('mouseenter', 'unclustered-point', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'unclustered-point', () => {
      map.getCanvas().style.cursor = '';
    });

    setMapReady(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- obsLookupRef is a
  // stable ref; the click handler reads .current at call time, not capture time.
  }, []);

  const handleClosePopover = useCallback(() => setSelectedObs(null), []);

  // Escape closes spiderfy (and also the popover, but the popover renders
  // inside its own dialog so Escape inside the dialog stays scoped there).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && spiderfyRef.current) {
        closeSpiderfy();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeSpiderfy]);

  /* The hit-layer covers two cases:
     (a) when no spiderfy is active, render hit targets over every
         currently-rendered unclustered point (so screen-reader users can
         still reach them). queryRenderedFeatures on every render is
         expensive; instead we trust the geojson and let the hit layer's
         re-projection on each map move keep positions accurate.
     (b) when a spiderfy is active, render hit targets over the spiderfied
         leaves only. The base unclustered points are still on the map
         underneath but the hit-layer takes precedence visually. */
  const hitMarkers: HitTargetMarker[] = useMemo(() => {
    if (spiderfy) {
      return spiderfy.leaves.map((l) => ({
        subId: l.subId,
        comName: l.comName,
        familyCode: l.familyCode,
        locName: l.locName,
        obsDt: l.obsDt,
        isNotable: l.isNotable,
        lngLat: l.leafLngLat,
      }));
    }
    // No spiderfy — render hit targets over every unclustered observation.
    // (The cluster-circle layer hides observations that are clustered; the
    // hit-layer over them is harmless because click-throughs would still
    // hit the cluster layer.)
    return observations.map((o) => ({
      subId: o.subId,
      comName: o.comName,
      familyCode: o.familyCode,
      locName: o.locName,
      obsDt: o.obsDt,
      isNotable: o.isNotable,
      lngLat: [o.lng, o.lat] as [number, number],
    }));
  }, [observations, spiderfy]);

  const handleHitSelect = useCallback(
    (subId: string) => {
      const obs = obsLookupRef.current[subId];
      if (obs) setSelectedObs(obs);
    },
    [],
  );

  const map = mapReady ? mapRef.current?.getMap() ?? null : null;

  return (
    <div data-testid="map-canvas" style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Map
        ref={mapRef}
        initialViewState={INITIAL_VIEW}
        style={{ width: '100%', height: '100%' }}
        mapStyle={basemapStyle}
        onLoad={handleLoad}
        attributionControl={false}
      >
        {/*
          ODbL compliance: OpenStreetMap data (via OpenFreeMap's positron tiles)
          is contractually required to be attributed. React-map-gl v7's <Map>
          prop narrows maplibre's `attributionControl` to `boolean`, so the
          standalone <AttributionControl> component is the only way to pass
          `compact: false` alongside custom text. `customAttribution` augments
          the style's built-in attribution rather than replacing it.

          eBird API ToU §3 (issue #243): observation data displayed on this
          map originates from the eBird API and must be attributed with a link
          back to eBird.org. The credit lives here (alongside OSM /
          OpenFreeMap) on the map view, NOT in a SurfaceFooter, so the map is
          not double-credited. All three entries use `rel="noopener"` — do
          NOT introduce a `noopener noreferrer` divergence inside this array;
          the AttributionModal in #250 inherits this exact convention.
        */}
        <AttributionControl
          compact={false}
          customAttribution={[
            '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
            '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>',
            'Bird data: <a href="https://ebird.org" target="_blank" rel="noopener">eBird</a> (Cornell Lab of Ornithology)',
          ]}
        />
        <Source
          id="observations"
          type="geojson"
          data={geojson}
          cluster
          clusterMaxZoom={CLUSTER_MAX_ZOOM}
          clusterRadius={CLUSTER_RADIUS}
        >
          <Layer {...clusterLayer} />
          <Layer {...clusterCountLayer} />
          <Layer {...unclusteredLayer} />
        </Source>
      </Map>
      {map && (
        <MapMarkerHitLayer
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          map={map as any}
          markers={hitMarkers}
          onSelect={handleHitSelect}
          isCoarsePointer={isCoarsePointer}
        />
      )}
      <ObservationPopover
        observation={selectedObs}
        onClose={handleClosePopover}
      />
    </div>
  );
}

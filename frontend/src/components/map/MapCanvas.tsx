import { useCallback, useMemo, useRef, useState } from 'react';
import { Map, Source, Layer, AttributionControl } from 'react-map-gl/maplibre';
import type { MapRef } from 'react-map-gl/maplibre';
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
 */
export function MapCanvas({ observations }: MapCanvasProps) {
  const mapRef = useRef<MapRef>(null);
  const [selectedObs, setSelectedObs] = useState<Observation | null>(null);

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

  /**
   * Wire click handling through the raw MapLibre instance. This avoids the
   * react-map-gl `e.features` bug (see prototype learnings #1).
   */
  const handleLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    map.on('click', 'unclustered-point', (e) => {
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

    // Zoom into cluster on click.
    map.on('click', 'clusters', (e) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: ['clusters'],
      });
      const feature = features[0];
      if (!feature) return;

      const clusterId = feature.properties?.cluster_id as number | undefined;
      const source = map.getSource('observations');
      if (clusterId != null && source && 'getClusterExpansionZoom' in source) {
        // MapLibre 4.x: `getClusterExpansionZoom` (and `getClusterChildren`,
        // `getClusterLeaves`) returns a Promise and no longer invokes the
        // legacy callback argument. Passing a callback silently no-ops —
        // which is how this regression shipped (see PR #165 / issue #166).
        const src = source as {
          getClusterExpansionZoom: (id: number) => Promise<number>;
        };
        src
          .getClusterExpansionZoom(clusterId)
          .then((zoom) => {
            const geom = feature.geometry;
            if (geom.type === 'Point') {
              map.easeTo({
                center: geom.coordinates as [number, number],
                zoom,
              });
            }
          })
          .catch(() => {
            /* silently ignore — matches previous err-swallow behavior */
          });
      }
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- obsLookupRef is a
  // stable ref; the click handler reads .current at call time, not capture time.
  }, []);

  const handleClosePopover = useCallback(() => setSelectedObs(null), []);

  return (
    <div data-testid="map-canvas" style={{ width: '100%', height: '100%' }}>
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
        */}
        <AttributionControl
          compact={false}
          customAttribution={[
            '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
            '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>',
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
      <ObservationPopover
        observation={selectedObs}
        onClose={handleClosePopover}
      />
    </div>
  );
}

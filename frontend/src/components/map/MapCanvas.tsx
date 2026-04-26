import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// Aliasing the react-map-gl/maplibre Map component to MapView so the
// global ES Map constructor remains available inside this module — otherwise
// `new Map()` for the mosaic-state Map<number, ClusterMosaicEntry> resolves
// to the React component and throws "Map is not a constructor".
import {
  Map as MapView,
  Source,
  Layer,
  Marker,
  AttributionControl,
} from 'react-map-gl/maplibre';
import type { MapLayerMouseEvent, MapRef } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { FamilySilhouette, Observation } from '@bird-watch/shared-types';
import { basemapStyle } from './basemap-style.js';
import {
  observationsToGeoJson,
  buildClusterLayerSpec,
  buildClusterCountLayerSpec,
  buildUnclusteredPointLayerSpec,
  CLUSTER_MAX_ZOOM,
  CLUSTER_MOSAIC_MAX_POINTS,
  CLUSTER_RADIUS,
} from './observation-layers.js';
import { ObservationPopover } from './ObservationPopover.js';
import { MosaicMarker } from './MosaicMarker.js';
import {
  aggregateClusterFamilies,
  buildMosaicTiles,
  type ClusterLeafFeature,
  type MosaicTile,
} from './cluster-mosaic.js';

export interface MapCanvasProps {
  observations: Observation[];
  /**
   * Family→silhouette catalogue, threaded from App.tsx via MapSurface
   * (#246's prop chain). Drives the cluster-mosaic tiles for clusters with
   * `point_count <= CLUSTER_MOSAIC_MAX_POINTS` (issue #248). When the
   * array is empty (cache miss), the reconciler short-circuits and the
   * existing colored cluster circle takes over.
   */
  silhouettes: FamilySilhouette[];
}

/**
 * Materialized cluster mosaic state — one entry per visible small cluster.
 * Keyed by cluster_id (supercluster auto-assigns this when no `promoteId`
 * is set on the source). Stored in a Map so reconciler diffs are O(N) and
 * React's reconciler stays focused on key-stable Marker updates.
 */
interface ClusterMosaicEntry {
  clusterId: number;
  longitude: number;
  latitude: number;
  totalCount: number;
  tiles: MosaicTile[];
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
export function MapCanvas({ observations, silhouettes }: MapCanvasProps) {
  const mapRef = useRef<MapRef>(null);
  const [selectedObs, setSelectedObs] = useState<Observation | null>(null);
  /**
   * Visible cluster mosaics, reconciled on `load` and `idle`. Stored in a
   * Map keyed by cluster_id so React renders one stable <Marker> per
   * cluster across reconciler passes — clusters that disappear (zoom-out,
   * pan) drop out of the Map and unmount cleanly, no manual cleanup
   * required.
   */
  const [mosaics, setMosaics] = useState<Map<number, ClusterMosaicEntry>>(
    () => new Map(),
  );

  const geojson = useMemo(
    () => observationsToGeoJson(observations),
    [observations],
  );

  // The reconciler reads `silhouettes` on every cluster pass. A ref keeps
  // the closure fresh without re-registering the map listeners (registration
  // is keyed only on the map instance, NOT on the silhouettes array).
  const silhouettesRef = useRef(silhouettes);
  silhouettesRef.current = silhouettes;

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

    // Zoom into cluster on click.
    map.on('click', 'clusters', (e: MapLayerMouseEvent) => {
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

  /**
   * Mosaic reconciler — issue #248. Queries rendered cluster features on
   * `load` and `idle`, materializes one HTML <Marker> per cluster with
   * `point_count <= CLUSTER_MOSAIC_MAX_POINTS`, drops markers whose
   * clusters disappeared from the viewport.
   *
   * Short-circuit: when `silhouettes` is empty (cache miss / API failure),
   * the reconciler skips registration entirely so the existing colored
   * cluster circle takes over without rendering a wall of fallback tiles.
   *
   * Bare-event handlers (no layer ID) — `idle` fires after every render
   * settle, NOT once per frame, so this is cheap. The async
   * `getClusterLeaves` call is awaited per-cluster but the per-cluster
   * Promises run concurrently via Promise.all.
   *
   * Cluster identity: supercluster auto-assigns `cluster_id` to the
   * feature's `properties.cluster_id` AND `feature.id`. We key on
   * `properties.cluster_id` (more reliable than `feature.id` per the
   * issue spec — `feature.id` isn't guaranteed populated for cluster
   * aggregation features).
   */
  useEffect(() => {
    // Skip the whole reconciler when there are no silhouettes to draw —
    // the existing circle layer carries the visual already.
    if (silhouettes.length === 0) return undefined;
    const map = mapRef.current?.getMap();
    if (!map) return undefined;

    let cancelled = false;

    const reconcile = async () => {
      // queryRenderedFeatures with `undefined` first arg = whole viewport.
      // Layer filter narrows to cluster features only. Default to []
      // defensively — the maplibre instance can return undefined when the
      // map isn't ready yet (race between initial idle event and the
      // style having a renderable source).
      const features = (map.queryRenderedFeatures(undefined, {
        layers: ['clusters'],
      }) ?? []) as Array<{ properties?: Record<string, unknown>; geometry?: unknown; id?: number }>;
      // The cluster layer filter excludes point_count <= 8 (see
      // observation-layers.ts), so any cluster the *circle* renders won't
      // show up here. We need the unfiltered cluster set, which lives on
      // the source itself — query without the layer filter, but inside the
      // `clusters` source. Unfortunately, queryRenderedFeatures only
      // returns rendered features. To pull the small clusters back, we
      // re-query without the layer filter and pick those tagged with a
      // `cluster_id`. This is the same approach maplibre's official
      // "Display HTML clusters with custom properties" example uses.
      const allFeatures = (map.queryRenderedFeatures(undefined) ?? []) as Array<{
        properties?: Record<string, unknown>;
        geometry?: unknown;
        id?: number;
      }>;
      const smallClusters = allFeatures.filter((f) => {
        const props = f.properties ?? {};
        return (
          'cluster_id' in props &&
          typeof props['point_count'] === 'number' &&
          props['point_count'] <= CLUSTER_MOSAIC_MAX_POINTS
        );
      });
      // The above queryRenderedFeatures(undefined) ALSO returns the
      // already-rendered circle clusters from the layer query above. Dedupe
      // by cluster_id so the layer-filtered + unfiltered queries don't
      // double-up. Since the layer filter excludes ≤8, the dedupe is a
      // belt-and-suspenders against future filter changes.
      const seen = new Set<number>();
      const candidates = [...features, ...smallClusters].filter((f) => {
        const id = f.properties?.['cluster_id'];
        if (typeof id !== 'number') return false;
        const pointCount = f.properties?.['point_count'];
        if (typeof pointCount !== 'number') return false;
        if (pointCount > CLUSTER_MOSAIC_MAX_POINTS) return false;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });

      const source = map.getSource('observations') as
        | { getClusterLeaves: (id: number, limit: number, offset: number) => Promise<unknown[]> }
        | undefined;
      if (!source || typeof source.getClusterLeaves !== 'function') {
        return;
      }

      const next = new Map<number, ClusterMosaicEntry>();
      // Concurrent per-cluster lookups — each getClusterLeaves call is an
      // independent Promise. Promise.all bounds reconciliation latency at
      // max(per-cluster latency) instead of sum(per-cluster latency).
      await Promise.all(
        candidates.map(async (feature) => {
          const clusterId = feature.properties?.['cluster_id'] as number;
          const pointCount = feature.properties?.['point_count'] as number;
          const geom = feature.geometry as
            | { type: 'Point'; coordinates: [number, number] }
            | { type: string };
          if (geom.type !== 'Point') return;
          const [longitude, latitude] = (
            geom as { coordinates: [number, number] }
          ).coordinates;

          try {
            const leaves = await source.getClusterLeaves(
              clusterId,
              CLUSTER_MOSAIC_MAX_POINTS,
              0,
            );
            const aggregates = aggregateClusterFamilies(
              leaves as ClusterLeafFeature[],
            );
            const tiles = buildMosaicTiles(
              aggregates,
              silhouettesRef.current,
            );
            next.set(clusterId, {
              clusterId,
              longitude,
              latitude,
              totalCount: pointCount,
              tiles,
            });
          } catch {
            // Cluster could've expired between the queryRenderedFeatures
            // and the getClusterLeaves resolution (zoom-in mid-flight).
            // Drop silently — the next idle tick will reconcile.
          }
        }),
      );

      if (cancelled) return;
      setMosaics(next);
    };

    // Fire-and-forget — React doesn't care about Promise return values
    // from event handlers. The internal try/catch handles per-cluster
    // failures so the whole pass never throws.
    const onLoad = () => {
      void reconcile();
    };
    const onIdle = () => {
      void reconcile();
    };
    map.on('load', onLoad);
    map.on('idle', onIdle);
    // Run once immediately in case the map is already loaded (the
    // `load` event only fires for the FIRST style load — subsequent
    // re-mounts of MapCanvas would otherwise be empty until first pan).
    void reconcile();

    return () => {
      cancelled = true;
      map.off('load', onLoad);
      map.off('idle', onIdle);
    };
    // silhouettes.length is the trigger — we re-register when the
    // catalogue transitions empty<→populated. The closure reads the
    // live array via silhouettesRef so per-row updates don't need a
    // re-registration.
  }, [silhouettes.length]);

  /**
   * Mosaic-marker click handler — delegates to the same zoom-into-cluster
   * logic the layer-bound `clusters` click handler uses. Defensively call
   * stopPropagation so the click doesn't bubble to the underlying basemap
   * (the cluster circle layer is filtered out at this size, so no double-
   * fire risk against the layer-bound handler — but defense in depth).
   */
  const handleMosaicClick = useCallback(
    (entry: ClusterMosaicEntry) => (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      const map = mapRef.current?.getMap();
      if (!map) return;
      const source = map.getSource('observations') as
        | { getClusterExpansionZoom: (id: number) => Promise<number> }
        | undefined;
      if (!source || typeof source.getClusterExpansionZoom !== 'function') {
        return;
      }
      source
        .getClusterExpansionZoom(entry.clusterId)
        .then((zoom) => {
          map.easeTo({
            center: [entry.longitude, entry.latitude],
            zoom,
          });
        })
        .catch(() => {
          /* matches existing layer-bound err-swallow behavior */
        });
    },
    [],
  );

  const handleClosePopover = useCallback(() => setSelectedObs(null), []);

  return (
    <div data-testid="map-canvas" style={{ width: '100%', height: '100%' }}>
      <MapView
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
        {/*
          Issue #248: HTML <Marker> per small cluster, rendered alongside
          the cluster source. React keys by cluster_id so panning/zooming
          unmounts disappearing clusters and mounts new ones in a single
          reconciler pass — no orphans, no leaks.
        */}
        {Array.from(mosaics.values()).map((entry) => (
          <Marker
            key={entry.clusterId}
            longitude={entry.longitude}
            latitude={entry.latitude}
          >
            <MosaicMarker
              tiles={entry.tiles}
              totalCount={entry.totalCount}
              onClick={handleMosaicClick(entry)}
            />
          </Marker>
        ))}
      </MapView>
      <ObservationPopover
        observation={selectedObs}
        onClose={handleClosePopover}
      />
    </div>
  );
}

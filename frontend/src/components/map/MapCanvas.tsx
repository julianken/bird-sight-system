import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// Aliasing the react-map-gl/maplibre Map component to MapView so the
// global ES Map constructor remains available inside this module — otherwise
// `new Map()` for the mosaic-state Map<number, ClusterMosaicEntry> (#248)
// resolves to the React component and throws "Map is not a constructor".
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
  buildClustersHitLayerSpec,
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
 *
 * Spiderfy (issue #247): when a cluster contains ≤8 points and the map is
 * at zoom ≥ CLUSTER_MAX_ZOOM, clicking the cluster fans the leaves out
 * radially with leader lines instead of zooming further. The leaves
 * become individually clickable via `MapMarkerHitLayer` (HTML overlay
 * with per-marker `aria-label`). Outside-click or Escape clears spiderfy.
 */
export function MapCanvas({ observations, silhouettes }: MapCanvasProps) {
  const mapRef = useRef<MapRef>(null);
  const [selectedObs, setSelectedObs] = useState<Observation | null>(null);
  /**
   * Visible cluster mosaics (#248), reconciled on `load` and `idle`. Stored
   * in a Map keyed by cluster_id so React renders one stable <Marker> per
   * cluster across reconciler passes — clusters that disappear (zoom-out,
   * pan) drop out of the Map and unmount cleanly, no manual cleanup
   * required.
   */
  const [mosaics, setMosaics] = useState<Map<number, ClusterMosaicEntry>>(
    () => new Map(),
  );
  /* Active spiderfy state (#247) — null when no cluster is currently
     spiderfied. Holds the projected leaves + a teardown closure that removes
     the transient leader-line layer/source. */
  const [spiderfy, setSpiderfy] = useState<SpiderfyState | null>(null);
  const spiderfyRef = useRef<SpiderfyState | null>(null);
  spiderfyRef.current = spiderfy;
  /**
   * Flips `true` after the maplibre map fires its initial `load` event.
   * Drives the mosaic reconciler effect (#248) and the hit-layer ref
   * binding (#247) — without this gate, both fire against a null
   * mapRef.current (commit ordering: mapRef is only populated AFTER the
   * Map child mounts, so an effect dependent on a silhouettes prop change
   * can fire before the ref is live).
   */
  const [mapReady, setMapReady] = useState(false);
  /* Coarse-pointer detection (#247, mobile). matchMedia is the canonical
     way; we read it on mount and listen for changes. */
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

  // The reconciler reads `silhouettes` on every cluster pass. A ref keeps
  // the closure fresh without re-registering the map listeners (registration
  // is keyed only on the map instance, NOT on the silhouettes array).
  const silhouettesRef = useRef(silhouettes);
  silhouettesRef.current = silhouettes;

  // Build layer specs once — they read CSS tokens at construction time.
  const clusterLayer = useMemo(() => buildClusterLayerSpec(), []);
  const clusterCountLayer = useMemo(() => buildClusterCountLayerSpec(), []);
  const clustersHitLayer = useMemo(() => buildClustersHitLayerSpec(), []);
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
    // Signal the reconciler effect that the map is mounted + ref-live.
    setMapReady(true);

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
    // Wait for the map to fire its initial `load` event before grabbing
    // the ref. mapRef.current is null until the maplibre Map child
    // commits, and effect commit order can race against that.
    if (!mapReady) return undefined;
    const map = mapRef.current?.getMap();
    if (!map) return undefined;

    let cancelled = false;

    const reconcile = async () => {
      // queryRenderedFeatures with `undefined` first arg = whole viewport.
      // Query the invisible `clusters-hit` layer (NOT the visible `clusters`
      // layer — that one filters out point_count <= 8, so small clusters
      // are absent). Default to [] defensively — the maplibre instance can
      // return undefined when the map isn't ready yet (race between initial
      // idle event and the style having a renderable source).
      const features = (map.queryRenderedFeatures(undefined, {
        layers: ['clusters-hit'],
      }) ?? []) as Array<{
        properties?: Record<string, unknown>;
        geometry?: unknown;
        id?: number;
      }>;
      // Filter to small clusters + dedupe by cluster_id (queryRenderedFeatures
      // can return one feature per tile boundary the cluster crosses; the
      // dedupe keeps each cluster materialized exactly once).
      const seen = new Set<number>();
      const candidates = features.filter((f) => {
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
    // Re-register when the silhouettes catalogue transitions empty
    // ↔ populated, OR when the map first becomes ready. The closure
    // reads the live silhouettes array via silhouettesRef so per-row
    // updates don't need a re-registration.
  }, [silhouettes.length, mapReady]);

  /**
   * Mosaic-marker click handler — branches on (target zoom vs current zoom)
   * the same way the layer-bound `clusters` handler branches on
   * (point_count, zoom):
   *
   *   target > current → easeTo (zoom in to break up the cluster).
   *   target ≤ current → spiderfy (#247) — we're already at supercluster's
   *     `clusterMaxZoom`, so further zoom is a no-op. Without this branch,
   *     clicking a small-cluster mosaic at zoom ≥ CLUSTER_MAX_ZOOM is
   *     a dead end.
   *
   * Defensively `stopPropagation` so the click doesn't bubble to the
   * basemap (the visible cluster circle layer filters to `>8`, so no
   * double-fire risk against the layer-bound handler — but defense in
   * depth).
   */
  const handleMosaicClick = useCallback(
    (entry: ClusterMosaicEntry) => (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      const map = mapRef.current?.getMap();
      if (!map) return;
      const source = map.getSource('observations');
      if (!source || !('getClusterExpansionZoom' in source)) return;

      const src = source as {
        getClusterExpansionZoom: (id: number) => Promise<number>;
        getClusterLeaves?: (id: number, limit: number, offset: number) => Promise<unknown[]>;
      };

      src
        .getClusterExpansionZoom(entry.clusterId)
        .then((targetZoom) => {
          const currentZoom = map.getZoom();
          const center: [number, number] = [entry.longitude, entry.latitude];

          if (targetZoom > currentZoom) {
            map.easeTo({ center, zoom: targetZoom });
            return;
          }

          // Already at supercluster's clusterMaxZoom — spiderfy instead.
          if (typeof src.getClusterLeaves !== 'function') return;
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
            source: src as any,
            clusterId: entry.clusterId,
            clusterLngLat: center,
          })
            .then((state) => setSpiderfy(state))
            .catch(() => {
              /* matches existing err-swallow convention */
            });
        })
        .catch(() => {
          /* matches existing layer-bound err-swallow behavior */
        });
    },
    [],
  );

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
          {/*
            Issue #248 hit-test layer — invisible circle covering ALL
            clusters so the reconciler can pull small ones (point_count <= 8)
            via queryRenderedFeatures. Without it, small clusters are
            filtered out of every rendered layer and queryRenderedFeatures
            returns an empty set for them.
          */}
          <Layer {...clustersHitLayer} />
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
      {/* Issue #247: HTML hit-layer overlay for spiderfied + unclustered
          markers, mounted as a sibling of the maplibre canvas inside the
          relatively-positioned wrapper. */}
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

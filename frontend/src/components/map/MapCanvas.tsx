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
  buildNotableRingLayerSpec,
  CLUSTER_MAX_ZOOM,
  CLUSTER_MOSAIC_MAX_POINTS,
  CLUSTER_RADIUS,
  FALLBACK_SILHOUETTE_ID,
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
  SPIDER_LEADER_COLOR,
  SPIDER_LEADER_WIDTH,
  type SpiderfyState,
} from './spiderfy.js';
import {
  MapMarkerHitLayer,
  type HitTargetMarker,
} from './MapMarkerHitLayer.js';
import {
  groupOverlapping,
  fanPositions,
  type StackInput,
} from './stack-fanout.js';
import { StackedSilhouetteMarker } from './StackedSilhouetteMarker.js';

/** Source / layer ids for the auto-spider leader lines. */
const AUTO_SPIDER_SOURCE_ID = 'auto-spider-leader-lines';
const AUTO_SPIDER_LAYER_ID = 'auto-spider-leader-lines-layer';

/**
 * One leaf in the auto-spider state — carries the data needed to render a
 * StackedSilhouetteMarker at the fanned position.
 */
interface AutoSpiderLeaf {
  subId: string;
  lngLat: [number, number];
  silhouette: { svgData: string | null; color: string };
  comName: string;
  familyCode: string | null;
  locName: string | null;
  obsDt: string;
  isNotable: boolean;
}

/**
 * One auto-spider stack — a group of co-located observations with their
 * fanned leaf positions.
 */
interface AutoSpiderStack {
  stackId: string;
  centerLngLat: [number, number];
  leaves: AutoSpiderLeaf[];
}

export interface MapCanvasProps {
  observations: Observation[];
  /**
   * Family silhouettes from `/api/silhouettes`. Threaded down from App.tsx
   * via MapSurface (see App.tsx — single mount of `useSilhouettes`, then
   * prop-drilled per #246's strict-mount discipline). Each non-null
   * `svgData` row gets registered as an SDF sprite via `map.addImage`
   * during `handleLoad`. The `_FALLBACK` row backs every observation
   * whose family has no usable silhouette.
   *
   * Also drives the cluster-mosaic tiles for clusters with
   * `point_count <= CLUSTER_MOSAIC_MAX_POINTS` (issue #248). When the
   * array is empty (cache miss), the reconciler short-circuits and the
   * existing colored cluster circle takes over.
   *
   * Optional + defaults to `[]` so legacy tests / demo harnesses still
   * type-check; with no silhouettes the symbol layer's `icon-image`
   * lookup misses and MapLibre logs a missing-image warning. Production
   * App.tsx always passes the resolved array.
   */
  silhouettes?: FamilySilhouette[];
  /**
   * Issue #246: invoked when the user clicks "See species details" in
   * the ObservationPopover. App.tsx wires this to
   * `set({ view: 'detail', detail: code })` via `useUrlState`. Optional
   * — when absent, the popover hides the link.
   */
  onSelectSpecies?: (speciesCode: string) => void;
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
 * Convert a `family_silhouettes` row into a complete SVG document string
 * suitable for `<img src="data:image/svg+xml,...">`. The svgData column
 * stores a single path-`d` string (24-viewBox); we wrap it in a minimal
 * `<svg>` shell with `fill="black"` so the rendered raster is a single-
 * channel alpha mask that maplibre's SDF tinter can color-shift via the
 * symbol layer's `icon-color` paint property.
 */
function silhouettePathToSvg(svgData: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="64" height="64">` +
    `<path d="${svgData}" fill="black"/>` +
    `</svg>`
  );
}

/**
 * Promise-wrap the SVG → HTMLImageElement → addImage pipeline for one
 * silhouette. Resolves once the sprite is registered; rejects on image-
 * load failure (which surfaces upstream as a Promise.all rejection).
 */
async function registerSilhouetteSprite(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  map: any,
  id: string,
  svgData: string,
): Promise<void> {
  const svgString = silhouettePathToSvg(svgData);
  const blob = new Blob([svgString], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    // image.decode() returns a Promise that resolves when the image is
    // ready to render (no `onload` race). Fall back to a manual onload
    // listener for environments (jsdom) where decode is a stub.
    if (typeof img.decode === 'function') {
      await img.decode().catch(() => {
        // jsdom Image polyfill rejects decode immediately; the FakeImage
        // shim in tests resolves. Either way we proceed — the addImage
        // call below tolerates a half-decoded image in tests, and in
        // production the data: URI loads synchronously.
      });
    }
    if (!map.hasImage(id)) {
      map.addImage(id, img, { sdf: true });
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

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
 *
 * Symbol layer (issue #246): the unclustered-point layer is now an SDF
 * symbol layer that paints per-family silhouettes tinted with each
 * family's seeded color. Sprites are registered via `map.addImage` in
 * `handleLoad` from the `silhouettes` prop. The notable-ring layer adds
 * an amber halo behind notable observations without tinting the body —
 * preserves the family-color signal in the silhouette.
 */
export function MapCanvas({
  observations,
  silhouettes = [],
  onSelectSpecies,
}: MapCanvasProps) {
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

  // The reconciler reads `silhouettes` on every cluster pass. A ref keeps
  // the closure fresh without re-registering the map listeners (registration
  // is keyed only on the map instance, NOT on the silhouettes array).
  const silhouettesRef = useRef(silhouettes);
  silhouettesRef.current = silhouettes;

  // Sprite-registration completion gate. Flips true after `Promise.all`
  // in the sprite-registration effect resolves. The symbol layer JSX is
  // conditioned on this so MapLibre never tries to paint icons before
  // their sprites are registered (which would emit `missing-image`
  // console warnings on cold load — a Tier-1 finding per CLAUDE.md).
  // Once true, never flips back: re-running the effect on a silhouettes
  // prop change re-registers in-place via map.addImage (which silently
  // replaces the prior image), so the layer can stay mounted continuously.
  const [spritesReady, setSpritesReady] = useState(false);

  /**
   * Auto-spider stacks (issue #277, Spider v2 Task 3). Reconciled on every
   * map `idle` by the auto-spider reconciler effect below. Each entry holds
   * one fanned stack: the center lngLat, and the fanned leaves with their
   * projected marker positions. Cleared to [] when no stacks are visible.
   */
  const [autoSpiderStacks, setAutoSpiderStacks] = useState<AutoSpiderStack[]>(
    [],
  );

  // Issue #277 (Spider v2 Task 4): derive the set of subIds that belong to
  // any active auto-spider stack. These features get inStack: true in the
  // GeoJSON so the unclustered-point SDF layer filters them out, preventing
  // double-rendering alongside the StackedSilhouetteMarker fan positions.
  const stackedSubIds = useMemo<ReadonlySet<string>>(
    () =>
      new Set(
        autoSpiderStacks.flatMap((s) => s.leaves.map((l) => l.subId)),
      ),
    [autoSpiderStacks],
  );

  const geojson = useMemo(
    () => observationsToGeoJson(observations, silhouettes, stackedSubIds),
    [observations, silhouettes, stackedSubIds],
  );

  // Tracks the map's current zoom for hit-target gating. The hit-layer
  // (#247) renders DOM `<button>` overlays for accessible marker clicks;
  // those buttons absorb clicks before they reach the underlying maplibre
  // canvas. At zoom < CLUSTER_MAX_ZOOM, observations are aggregated into
  // cluster circles and the cluster-circle click handler should win — so
  // hit-targets must be SUPPRESSED at low zoom to avoid intercepting
  // cluster clicks (visually, those buttons would otherwise sit on top of
  // the cluster circles and steal the click). Updated via `zoomend` so
  // mid-pan-zoom doesn't churn React.
  const [mapZoom, setMapZoom] = useState<number>(INITIAL_VIEW.zoom);

  // Build layer specs once — they read CSS tokens at construction time.
  const clusterLayer = useMemo(() => buildClusterLayerSpec(), []);
  const clusterCountLayer = useMemo(() => buildClusterCountLayerSpec(), []);
  const clustersHitLayer = useMemo(() => buildClustersHitLayerSpec(), []);
  const notableRingLayer = useMemo(() => buildNotableRingLayerSpec(), []);
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

    // Track final zoom for the hit-target gate. Subscribed to `zoomend`
    // (not `zoom`) so we only re-render React once per zoom gesture, not
    // on every interpolated frame. Initial zoom is set in useState; this
    // syncs after every user interaction.
    map.on('zoomend', () => {
      setMapZoom(map.getZoom());
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

  /* Sprite registration (issue #246).
     Run after the map fires `load` (mapReady) and whenever `silhouettes`
     changes. The conversion pipeline:
       1. For each silhouette with non-null svgData → wrap path-d in a
          minimal SVG document, blob → object URL → HTMLImageElement →
          decode() → addImage(id, img, { sdf: true }).
       2. The `_FALLBACK` row is always registered (its consumer feature
          properties point at the same id).
     The symbol layer renders against these sprites; missing-image
     warnings only fire if the layer is added before the addImage calls
     resolve. We mount the React `<Layer>` synchronously, but the actual
     paint happens after the next render frame — by which point the
     Promise.all has resolved on a fast cold load. If a sprite fails,
     features fall back to the `_FALLBACK` sentinel via the GeoJSON join. */
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    if (silhouettes.length === 0) return;

    let cancelled = false;
    const work: Promise<void>[] = [];
    const seen = new Set<string>();
    let fallbackPresent = false;
    for (const sil of silhouettes) {
      if (sil.familyCode === FALLBACK_SILHOUETTE_ID) {
        fallbackPresent = true;
      }
      if (sil.svgData === null) continue;
      if (seen.has(sil.familyCode)) continue;
      seen.add(sil.familyCode);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      work.push(registerSilhouetteSprite(map as any, sil.familyCode, sil.svgData));
    }
    // Defensive: if the `_FALLBACK` row didn't ship in this silhouettes
    // payload (older cached response, test fixture, etc.), don't try to
    // forge one — the map will surface a one-time missing-image warning
    // for un-joinable observations and we'll catch it in the dirty-
    // console gate. The acceptance criteria assume the seed migration
    // 1700000018000 is present, so production payloads always have it.
    void fallbackPresent;
    Promise.all(work)
      .then(() => {
        if (cancelled) return;
        // Flip the JSX-side barrier so the symbol layer mounts. After
        // this point, the layer renders and MapLibre can resolve every
        // icon-image lookup against a registered sprite — no
        // missing-image warnings.
        setSpritesReady(true);
      })
      .catch(() => {
        // Individual sprite failures are non-fatal — a missing sprite
        // means the map shows the basemap-styled missing-image triangle
        // for that family. The rest of the silhouettes still render.
        // Even on failure we flip the gate so the layer mounts (showing
        // the families whose sprites DID register); the dirty-console
        // gate would surface per-sprite warnings for the failures.
        if (cancelled) return;
        setSpritesReady(true);
      });
    return () => { cancelled = true; };
  }, [mapReady, silhouettes]);

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
   * Auto-spider reconciler — issue #277, Spider v2 Task 3.
   *
   * On every map `idle` (and once immediately on mount when the map is
   * ready), query the rendered unclustered-point features, project them to
   * screen coords, detect co-located stacks via `groupOverlapping`, and fan
   * each stack's members to distinct positions via `fanPositions`. Fanned
   * positions are unprojected back to lngLat so `<Marker>` placements stay
   * anchored to map coordinates across pan/zoom. The resulting
   * AutoSpiderStack array drives the `<Marker>+<StackedSilhouetteMarker>`
   * render below and the `auto-spider-leader-lines` GeoJSON source update.
   *
   * Short-circuit: when `silhouettes` is empty the effect returns early —
   * same guard as the mosaic reconciler. Pan/zoom does NOT close
   * auto-spider (it re-computes on the next idle). Escape only applies to
   * the click-driven spiderfy path; auto-spider has no concept of "closing".
   *
   * Source/layer lifecycle:
   *   - Source + layer are added once on the first reconcile that finds a
   *     non-empty stacks result (idempotent `getLayer` check before
   *     `addLayer`).
   *   - On subsequent reconciles the source is updated via `setData` rather
   *     than removed + re-added (avoids a flicker frame).
   *   - When no stacks are detected the source data is set to an empty
   *     FeatureCollection so leader lines disappear without removing the
   *     source.
   */
  // TODO(spider-v2): consider extracting to useAutoSpider hook if MapCanvas continues growing post-Task-5.
  useEffect(() => {
    // AC #2: short-circuit when silhouettes aren't loaded yet.
    if (silhouettes.length === 0) return undefined;
    if (!mapReady) return undefined;
    const map = mapRef.current?.getMap();
    if (!map) return undefined;

    // Build once per effect pass (dep array: [silhouettes.length, mapReady]).
    // Silhouettes change at most once per session (empty → populated), so
    // rebuilding on every idle would be wasteful at production obs counts.
    const silByFamily = new Map<string, { svgData: string | null; color: string }>();
    for (const s of silhouettesRef.current) {
      silByFamily.set(s.familyCode.toLowerCase(), {
        svgData: s.svgData,
        color: s.color,
      });
    }

    // Defensive — protects against future async yields in `reconcile`.
    // Today reconcile is synchronous so this flag never fires; kept for
    // forward-compatibility.
    let cancelled = false;

    const reconcile = () => {
      if (cancelled) return;
      const currentSilhouettes = silhouettesRef.current;
      if (currentSilhouettes.length === 0) return;

      // Query all currently-rendered unclustered observations.
      const rawFeatures = (map.queryRenderedFeatures(undefined, {
        layers: ['unclustered-point'],
      }) ?? []) as Array<{
        properties?: Record<string, unknown>;
        geometry?: { type: string; coordinates: unknown };
      }>;

      // Build StackInput array — one per feature with screen projection.
      const inputs: StackInput[] = [];
      for (const f of rawFeatures) {
        const props = f.properties;
        if (!props) continue;
        const geom = f.geometry;
        if (!geom || geom.type !== 'Point') continue;
        const coords = geom.coordinates as [number, number];
        if (!Array.isArray(coords) || coords.length < 2) continue;

        const subId = props.subId as string | undefined;
        if (!subId) continue;

        const comName = (props.comName as string | undefined) ?? '';
        const familyCode = (props.familyCode as string | null | undefined) ?? null;
        const locName = (props.locName as string | null | undefined) ?? null;
        const obsDt = (props.obsDt as string | undefined) ?? '';
        const isNotable = Boolean(props.isNotable);
        const silhouetteId = (props.silhouetteId as string | undefined) ?? '';
        const color = (props.color as string | undefined) ?? '#888888';

        // Project lngLat → screen coords.
        const screen = map.project([coords[0], coords[1]]);

        inputs.push({
          subId,
          comName,
          familyCode,
          silhouetteId,
          color,
          isNotable,
          obsDt,
          locName,
          screen: { x: screen.x, y: screen.y },
          lngLat: [coords[0], coords[1]],
        });
      }

      // Detect co-located stacks.
      const stacks = groupOverlapping(inputs);

      if (cancelled) return;

      // Build AutoSpiderStack array from detected stacks.
      const nextStacks: AutoSpiderStack[] = [];
      const leaderFeatures: Array<{
        type: 'Feature';
        geometry: { type: 'LineString'; coordinates: [[number, number], [number, number]] };
        properties: Record<string, string>;
      }> = [];

      for (const [si, stack] of stacks.entries()) {
        const stackId = `stack-${si}`;
        const fanned = fanPositions(stack);
        const leaves: AutoSpiderLeaf[] = [];

        for (const fan of fanned) {
          // Find the matching input member.
          const member = stack.members.find((m) => m.subId === fan.subId);
          if (!member) continue;

          // Unproject screen → lngLat for the Marker placement.
          const unprojected = map.unproject({ x: fan.screen.x, y: fan.screen.y });
          const leafLng = 'lng' in unprojected ? (unprojected as { lng: number }).lng : (unprojected as [number, number])[0];
          const leafLat = 'lat' in unprojected ? (unprojected as { lat: number }).lat : (unprojected as [number, number])[1];
          const leafLngLat: [number, number] = [leafLng, leafLat];

          // Resolve silhouette svgData from silhouettesRef (NOT from feature
          // properties — silhouetteId is a sprite name, not svgData).
          const familyKey = member.familyCode?.toLowerCase() ?? null;
          const sil = familyKey ? silByFamily.get(familyKey) : undefined;
          const silhouette = {
            svgData: sil?.svgData ?? null,
            color: sil?.color ?? member.color,
          };

          leaves.push({
            subId: member.subId,
            lngLat: leafLngLat,
            silhouette,
            comName: member.comName,
            familyCode: member.familyCode,
            locName: member.locName,
            obsDt: member.obsDt,
            isNotable: member.isNotable,
          });

          // One LineString per leaf: origin = stack center lngLat → leaf lngLat.
          leaderFeatures.push({
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [stack.centerLngLat, leafLngLat],
            },
            properties: { subId: member.subId, stackId },
          });
        }

        if (leaves.length > 0) {
          nextStacks.push({ stackId, centerLngLat: stack.centerLngLat, leaves });
        }
      }

      if (cancelled) return;

      // Update leader-line source. The source persists across reconcile
      // passes; add it once (idempotent getLayer check) then use setData.
      const leaderGeoJson = {
        type: 'FeatureCollection' as const,
        features: leaderFeatures,
      };

      const rawSource = map.getSource(AUTO_SPIDER_SOURCE_ID);
      const existingSource =
        rawSource != null &&
        typeof (rawSource as { setData?: unknown }).setData === 'function'
          ? (rawSource as { setData: (data: unknown) => void })
          : null;

      if (!existingSource) {
        // First reconcile that touches the source (or mock returned a non-
        // GeoJSON source without setData — treat as absent). Add source + layer.
        // Guard against double-add on re-render by checking getLayer first.
        if (!rawSource) {
          map.addSource(AUTO_SPIDER_SOURCE_ID, {
            type: 'geojson',
            data: leaderGeoJson,
          });
        }
        if (!map.getLayer(AUTO_SPIDER_LAYER_ID)) {
          map.addLayer({
            id: AUTO_SPIDER_LAYER_ID,
            type: 'line',
            source: AUTO_SPIDER_SOURCE_ID,
            paint: {
              'line-color': SPIDER_LEADER_COLOR,
              'line-width': SPIDER_LEADER_WIDTH,
            },
          });
        }
      } else {
        existingSource.setData(leaderGeoJson);
      }

      setAutoSpiderStacks(nextStacks);
    };

    const onLoad = () => { reconcile(); };
    const onIdle = () => { reconcile(); };
    map.on('load', onLoad);
    map.on('idle', onIdle);
    // Run once immediately for maps already at rest.
    reconcile();

    return () => {
      cancelled = true;
      map.off('load', onLoad);
      map.off('idle', onIdle);
    };
    // Re-register when silhouettes flip empty↔populated or map first becomes
    // ready. The closure reads live silhouettes via silhouettesRef.
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

          // Spiderfy when current zoom is already at or above clusterMaxZoom.
          // supercluster returns `clusterMaxZoom + 1` as the expansion zoom
          // for clusters at the cap, which would otherwise loop us into a
          // "zoom one level past max → click again → spiderfy" two-click UX.
          // Match the layer-bound `clusters` click handler's predicate so the
          // mosaic-click and circle-click code paths agree on the spiderfy
          // boundary.
          const atMaxZoom = currentZoom >= CLUSTER_MAX_ZOOM;
          if (!atMaxZoom && targetZoom > currentZoom) {
            map.easeTo({
              center,
              zoom: Math.min(targetZoom, CLUSTER_MAX_ZOOM),
            });
            return;
          }

          // At supercluster's clusterMaxZoom — spiderfy instead.
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

  const handlePopoverSelectSpecies = useCallback(
    (speciesCode: string) => {
      onSelectSpecies?.(speciesCode);
      // Close the popover after the navigation — the user has expressed
      // intent to leave the map view; the dialog hanging open during the
      // surface switch is a stale state.
      setSelectedObs(null);
    },
    [onSelectSpecies],
  );

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
     (a) when no spiderfy is active AND zoom >= CLUSTER_MAX_ZOOM, render
         hit targets over every observation (which by the source's
         clusterMaxZoom contract means each obs renders as its own
         unclustered symbol). At zoom < CLUSTER_MAX_ZOOM, observations
         are aggregated into cluster circles — and the hit-target buttons
         (real DOM elements with `pointer-events: auto`) would absorb
         clicks intended for cluster circles, breaking the layer-bound
         `clusters` click handler that drives zoom-into-cluster + spiderfy.
         Suppress the hit layer at low zoom; the cluster circles are
         themselves clickable through maplibre's event system.
     (b) when a spiderfy is active, render hit targets over the spiderfied
         leaves only — independent of zoom. The base unclustered points
         are still on the map underneath but the hit-layer takes precedence
         visually. */
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
    // No spiderfy — only render hit targets when observations are actually
    // unclustered (zoom >= CLUSTER_MAX_ZOOM). Below that, suppress the
    // overlay so cluster-circle clicks reach maplibre's event handlers.
    if (mapZoom < CLUSTER_MAX_ZOOM) {
      return [];
    }
    return observations.map((o) => ({
      subId: o.subId,
      comName: o.comName,
      familyCode: o.familyCode,
      locName: o.locName,
      obsDt: o.obsDt,
      isNotable: o.isNotable,
      lngLat: [o.lng, o.lat] as [number, number],
    }));
  }, [observations, spiderfy, mapZoom]);

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
          {/* Notable-ring renders BEFORE the unclustered-point symbol
              layer so the amber halo paints UNDER the silhouette
              (maplibre source-order = bottom-up). The silhouette body
              keeps its family-color tint; the ring marks notability
              without overwriting the colour signal. The ring is a
              circle layer (no sprite needed), so it can mount
              unconditionally; the symbol layer waits for spritesReady
              so MapLibre never tries to paint an icon-image whose
              sprite hasn't been addImage'd yet (cold-load
              missing-image warning class). */}
          <Layer {...notableRingLayer} />
          {spritesReady && <Layer {...unclusteredLayer} />}
        </Source>
        {/*
          Issue #248: HTML <Marker> per small cluster, rendered alongside
          the cluster source. React keys by cluster_id so panning/zooming
          unmounts disappearing clusters and mounts new ones in a single
          reconciler pass — no orphans, no leaks.
        */}
        {Array.from(mosaics.values())
          // Suppress the mosaic for the cluster currently being spidered
          // — otherwise the user sees the mosaic marker layered over the
          // fanned leader lines and reads "click did nothing." Hiding the
          // mosaic gives a clean visual swap: mosaic disappears, leader
          // lines fan out from the same center. (Spider v2, #277, will
          // also place visible silhouettes at leaf positions.)
          .filter((entry) => spiderfy?.clusterId !== entry.clusterId)
          .map((entry) => (
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
        {/*
          Issue #277 (Spider v2 Task 3): one <Marker>+<StackedSilhouetteMarker>
          per auto-spider leaf. Keyed by subId so React reconciles leaf
          additions/removals cleanly across idle passes. Rendered inside
          <MapView> so react-map-gl handles lngLat → pixel projection.
        */}
        {autoSpiderStacks.flatMap((stack) =>
          stack.leaves.map((leaf) => (
            <Marker
              key={leaf.subId}
              longitude={leaf.lngLat[0]}
              latitude={leaf.lngLat[1]}
              anchor="bottom"
            >
              {/* onClick is an inline arrow — stable pre-built callbacks
                  would require storing them in AutoSpiderLeaf. Acceptable
                  trade-off: reconcile fires on idle (every few seconds at
                  most), not on every MapCanvas render. */}
              <StackedSilhouetteMarker
                silhouette={leaf.silhouette}
                comName={leaf.comName}
                familyCode={leaf.familyCode}
                locName={leaf.locName}
                obsDt={leaf.obsDt}
                isNotable={leaf.isNotable}
                onClick={(e) => {
                  e.stopPropagation();
                  const obs = obsLookupRef.current[leaf.subId];
                  if (obs) setSelectedObs(obs);
                }}
              />
            </Marker>
          )),
        )}
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
        {...(onSelectSpecies ? { onSelectSpecies: handlePopoverSelectSpecies } : {})}
      />
    </div>
  );
}

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
import { isValidSvgPathData } from './silhouette-fallback.js';
import {
  aggregateClusterFamilies,
  buildMosaicTiles,
  type ClusterLeafFeature,
  type MosaicTile,
} from './cluster-mosaic.js';
import {
  MapMarkerHitLayer,
  type HitTargetMarker,
} from './MapMarkerHitLayer.js';
import { StackedSilhouetteMarker } from './StackedSilhouetteMarker.js';
import { useAutoSpider } from './use-auto-spider.js';

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
  /**
   * Issue #351: invoked on every map `idle` (camera-change settle) with
   * the current `map.getBounds()`. App.tsx threads this so the
   * FamilyLegend's per-family counts can reflect what the user is looking
   * at right now, not the full loaded API window.
   *
   * Wired inside `handleLoad` via `map.on('idle', ...)`. The choice of
   * `idle` (over `moveend` + `zoomend`) matches the existing mosaic
   * reconciler (`MapCanvas.tsx`'s mosaic effect) and the auto-spider
   * hook (`use-auto-spider.ts`), which both do post-camera-change work
   * on `idle`. `idle` is naturally throttled — fires once after the
   * pan/zoom animation AND tile loads settle — so no debounce is
   * necessary, and the legend updates in lockstep with the
   * mosaic/spider reconcilers (no visible timing skew between the
   * legend updating and the markers settling).
   *
   * Optional. When absent, MapCanvas registers no `idle` listener for
   * this purpose (existing reconcilers register their own). Existing
   * callers that don't pass it — `MapSurface` callers without the
   * viewport-aware path, unit tests with skeletal props — keep working.
   */
  onViewportChange?: (bounds: import('maplibre-gl').LngLatBounds) => void;
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
 *
 * Returns `null` when `svgData` fails the SVG path-data charset check
 * (issue #271). A literal `"`, `<`, `>`, `&`, or any other XML-breaking
 * character would either silently corrupt the surrounding `<svg>` document
 * — making `image.decode()` reject and the family fall back to `_FALLBACK`
 * with no diagnostic — or, in a worse regression, open an XSS surface if
 * the SVG ever rendered through an `innerHTML` path. The caller treats
 * `null` the same way it treats a `null` `svgData` upstream: skip the
 * sprite registration, log a warn naming the family code, fall back to
 * the `_FALLBACK` sprite via the GeoJSON join.
 */
function silhouettePathToSvg(svgData: string, familyCode: string): string | null {
  if (!isValidSvgPathData(svgData)) {
    console.warn(
      `[silhouette] invalid svgData for family ${familyCode}; falling back to _FALLBACK sprite`,
    );
    return null;
  }
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
 *
 * No-op (resolves immediately) when `svgData` fails the charset check —
 * `silhouettePathToSvg` returns `null` and we skip registration so the
 * family's observations join to the `_FALLBACK` sprite instead.
 */
async function registerSilhouetteSprite(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  map: any,
  id: string,
  svgData: string,
): Promise<void> {
  const svgString = silhouettePathToSvg(svgData, id);
  if (svgString === null) return;
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
 * Auto-spider (issue #277, Spider v2): on every map idle the auto-spider
 * reconciler detects co-located observations and fans them as
 * `<StackedSilhouetteMarker>` markers — no click required to trigger, no
 * Escape to close. Leader lines are drawn via a transient GeoJSON source.
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
  onViewportChange,
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
  /**
   * Flips `true` after the maplibre map fires its initial `load` event.
   * Drives the mosaic reconciler effect (#248), the auto-spider reconciler
   * effect (#277), and the hit-layer ref binding (#247) — without this gate,
   * all three fire against a null
   * mapRef.current (commit ordering: mapRef is only populated AFTER the
   * Map child mounts, so an effect dependent on a silhouettes prop change
   * can fire before the ref is live).
   */
  const [mapReady, setMapReady] = useState(false);
  /* Coarse-pointer detection (#247, mobile; also used by auto-spider hit
     targets in #277). matchMedia is the canonical way; we read it on mount
     and listen for changes. */
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

  // Unmount cleanup for the `window.__birdMap` test hook (#291). The hook is
  // assigned in `handleLoad` (which fires once per mount); without an unmount
  // cleanup, a remount (e.g. switching from feed view to map view and back)
  // would leave a stale handle to the prior MapCanvas's maplibre instance on
  // window between unmount and the next handleLoad firing. Empty dep array —
  // we only want this to run on component unmount. Same env gate as the
  // assignment so prod builds skip the cleanup branch entirely.
  useEffect(() => {
    return () => {
      if (
        typeof window !== 'undefined' &&
        import.meta.env.MODE !== 'production'
      ) {
        delete (window as { __birdMap?: unknown }).__birdMap;
      }
    };
  }, []);

  // The reconciler reads `silhouettes` on every cluster pass. A ref keeps
  // the closure fresh without re-registering the map listeners (registration
  // is keyed only on the map instance, NOT on the silhouettes array).
  const silhouettesRef = useRef(silhouettes);
  silhouettesRef.current = silhouettes;

  // Issue #351: ref to the current onViewportChange prop. handleLoad has
  // [] deps (registers listeners exactly once per maplibre instance), so
  // we read the live callback through the ref instead of capturing the
  // prop at registration time. App.tsx may pass a fresh inline closure
  // on every render; without the ref, only the very first one would ever
  // fire.
  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;

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
   * map `idle` by the `useAutoSpider` hook (extracted from MapCanvas in
   * #293). Each entry holds one fanned stack: the center lngLat, and the
   * fanned leaves with their projected marker positions. The hook owns the
   * effect, internal state, and the leader-line source/layer lifecycle;
   * MapCanvas just consumes the returned stacks and renders one
   * `<Marker>+<StackedSilhouetteMarker>` per leaf.
   */
  const autoSpiderStacks = useAutoSpider({
    map: mapReady ? mapRef.current?.getMap() ?? null : null,
    mapReady,
    spritesReady,
    silhouettes,
  });

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
  // (#247, #277) renders DOM `<button>` overlays for auto-spider stacks +
  // unclustered marker clicks; those buttons absorb clicks before they reach
  // the underlying maplibre canvas. At zoom < CLUSTER_MAX_ZOOM, observations
  // are aggregated into cluster circles and the cluster-circle click handler
  // should win — so hit-targets must be SUPPRESSED at low zoom to avoid
  // intercepting cluster clicks (visually, those buttons would otherwise sit
  // on top of the cluster circles and steal the click). Updated via `zoomend`
  // so mid-pan-zoom doesn't churn React.
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

  /**
   * Wire click handling through the raw MapLibre instance. This avoids the
   * react-map-gl `e.features` bug (see prototype learnings #1).
   */
  const handleLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    // Signal the reconciler effect that the map is mounted + ref-live.
    setMapReady(true);

    // Test hook (Spider v2 e2e): exposes the maplibre instance for Playwright
    // to drive easeTo and inspect sources. Not relied on by production code.
    // Env-gated to non-prod so the production bundle never leaks the
    // maplibre instance to anyone who reads the property in devtools (#291).
    if (
      typeof window !== 'undefined' &&
      import.meta.env.MODE !== 'production'
    ) {
      (window as { __birdMap?: typeof map }).__birdMap = map;
    }

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

    // Cluster click — always zoom in. At zoom >= CLUSTER_MAX_ZOOM the auto-
    // spider reconciler has already fanned overlapping obs on idle, so the
    // click is a NO-OP (return early without doing anything).
    map.on('click', 'clusters', (e: MapLayerMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: ['clusters'],
      });
      const feature = features[0];
      if (!feature) return;

      const clusterId = feature.properties?.cluster_id as number | undefined;
      const source = map.getSource('observations');
      if (clusterId == null || !source) return;

      const currentZoom = map.getZoom();
      // At max zoom the auto-spider has already fanned — nothing to do.
      if (currentZoom >= CLUSTER_MAX_ZOOM) return;

      const geom = feature.geometry;
      const center: [number, number] | null =
        geom.type === 'Point' ? (geom.coordinates as [number, number]) : null;

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

    // Track final zoom for the hit-target gate. Subscribed to `zoomend`
    // (not `zoom`) so we only re-render React once per zoom gesture, not
    // on every interpolated frame. Initial zoom is set in useState; this
    // syncs after every user interaction.
    map.on('zoomend', () => {
      setMapZoom(map.getZoom());
    });

    // Issue #351: viewport-aware FamilyLegend counts. Fire the
    // onViewportChange callback (when supplied) on each `idle` —
    // matching the mosaic reconciler at MapCanvas.tsx (mosaic effect)
    // and the auto-spider hook at use-auto-spider.ts. `idle` fires
    // after every camera-change settle (pan, zoom, programmatic
    // easeTo/flyTo) once tile loads + style settles complete; it
    // strictly follows `zoomend`. Registering once here (handleLoad's
    // [] deps) is the right cardinality — the prop is read through
    // a ref above so a fresh App.tsx callback identity per render
    // still wins.
    map.on('idle', () => {
      const cb = onViewportChangeRef.current;
      if (!cb) return;
      cb(map.getBounds());
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
   * Mosaic-marker click handler:
   *   currentZoom < CLUSTER_MAX_ZOOM → easeTo (zoom in to break up the cluster).
   *   currentZoom >= CLUSTER_MAX_ZOOM → NO-OP. The auto-spider reconciler
   *     (Task 3) has already fanned the leaves on idle; the user sees fanned
   *     silhouettes and can click each individually.
   *
   * Defensively `stopPropagation` so the click doesn't bubble to the
   * basemap.
   */
  const handleMosaicClick = useCallback(
    (entry: ClusterMosaicEntry) => (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      const map = mapRef.current?.getMap();
      if (!map) return;

      const currentZoom = map.getZoom();
      // Auto-spider already fanned at max zoom — nothing to do.
      if (currentZoom >= CLUSTER_MAX_ZOOM) return;

      const source = map.getSource('observations');
      if (!source || !('getClusterExpansionZoom' in source)) return;

      const src = source as {
        getClusterExpansionZoom: (id: number) => Promise<number>;
      };
      const center: [number, number] = [entry.longitude, entry.latitude];

      src
        .getClusterExpansionZoom(entry.clusterId)
        .then((targetZoom) => {
          if (targetZoom > currentZoom) {
            map.easeTo({
              center,
              zoom: Math.min(targetZoom, CLUSTER_MAX_ZOOM),
            });
          }
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

  /* Hit-target layer: render hit targets at zoom >= CLUSTER_MAX_ZOOM for
     non-stack observations. In-stack obs (stackedSubIds) have their own
     clickable StackedSilhouetteMarker from the auto-spider reconciler —
     skip them here to avoid duplicate overlapping hit targets.
     Below CLUSTER_MAX_ZOOM, observations are in cluster circles; suppress
     the overlay so cluster-circle clicks reach maplibre's event system. */
  const hitMarkers: HitTargetMarker[] = useMemo(() => {
    if (mapZoom < CLUSTER_MAX_ZOOM) {
      return [];
    }
    return observations
      .filter((o) => !stackedSubIds.has(o.subId))
      .map((o) => ({
        subId: o.subId,
        comName: o.comName,
        familyCode: o.familyCode,
        locName: o.locName,
        obsDt: o.obsDt,
        isNotable: o.isNotable,
        lngLat: [o.lng, o.lat] as [number, number],
      }));
  }, [observations, stackedSubIds, mapZoom]);

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
      {/* Issue #247 (original hit-layer) / #277 (Spider v2 narrowed to auto-spider stacks +
          unclustered): HTML overlay for stacked and unclustered markers, mounted as a sibling
          of the maplibre canvas inside the relatively-positioned wrapper. */}
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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// Aliasing the react-map-gl/maplibre Map component to MapView so the
// global ES Map constructor remains available inside this module — otherwise
// `new Map()` inside e.g. `leafCache = new Map<string, Promise<...>>()`
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
import { BASEMAP_LIGHT, BASEMAP_DARK } from './basemap-style.js';
import {
  observationsToGeoJson,
  buildClusterLayerSpec,
  buildClusterCountLayerSpec,
  buildClustersHitLayerSpec,
  buildUnclusteredPointLayerSpec,
  buildNotableRingLayerSpec,
  CLUSTER_MAX_ZOOM,
  CLUSTER_RADIUS,
  FALLBACK_SILHOUETTE_ID,
} from './observation-layers.js';
import { ObservationPopover } from './ObservationPopover.js';
import { AdaptiveGridMarker } from './AdaptiveGridMarker.js';
import { ClusterPill } from '../ds/ClusterPill.js';
import { isValidSvgPathData } from './silhouette-fallback.js';
import {
  aggregateClusterFamilies,
  buildAdaptiveTiles,
  pickGridShape,
  type AdaptiveTile,
  type ClusterLeafFeature,
  type ResolvedGrid,
  type SilhouettesById,
} from './adaptive-grid.js';
import {
  MapMarkerHitLayer,
  type HitTargetMarker,
} from './MapMarkerHitLayer.js';
import {
  buildGroups,
  displaceSilhouettes,
  SILHOUETTE_PX,
  type DeconflictGroup,
  type DeconflictInput,
} from './deconflict.js';

/**
 * Adaptive-grid reconciler memoization (epic #539 spec §5.3).
 *
 * Three separable caching concerns are addressed by three layers:
 *
 *   - Concern A (render-pass identity): `useMemo` at the parent (handled in
 *     the JSX render path below) keyed on [zoom, cluster_id, point_count,
 *     silhouettesVersion]. Defeated if `tiles` is a fresh array every render.
 *
 *   - Concern B (async-call avoidance): the module-scoped `leafCache` below
 *     stores Promises for `getClusterLeaves` calls so successive idle ticks
 *     don't re-query the same cluster. Key format: `${zoom}:${cluster_id}:
 *     ${point_count}`. The zoom prefix is load-bearing — supercluster's
 *     integer `cluster_id` values can collide across zoom levels.
 *
 *     Rejected-Promise eviction: `.catch()` cleanup at insert time deletes
 *     the entry in the same microtask, so a transient supercluster failure
 *     does not poison the cache for the cluster's lifetime. The rejection
 *     logs once via `warnedRejections` so a persistently-broken cluster
 *     doesn't spam the console on every idle.
 *
 *   - Concern C (catalogue rebuild invalidation): the module-scoped
 *     `cacheGeneration` counter is incremented + the cache is wholesale
 *     cleared when the silhouettes-deps effect re-registers. Each
 *     reconcile pass captures `myGen` at its top and no-ops the commit
 *     if the generation has advanced — closes the race where an in-flight
 *     reconcile from the prior catalogue commits stale tiles after a
 *     refresh.
 *
 * These caches survive component remount within a single test process; the
 * `__resetAdaptiveGridCacheForTesting()` export below is the test-only
 * escape hatch a `beforeEach` should call to avoid cross-test state leakage.
 */
/**
 * Resolved per-cluster adaptive data — the unit the Concern B cache stores
 * Promises of. `kind: 'pill'` is the pill-fallback sentinel (uniqueFamilies
 * > 16 OR pointCount > 64); `kind: 'grid'` carries the shape + tiles.
 */
type ResolvedAdaptiveData =
  | { kind: 'pill'; uniqueFamilies: number }
  | {
      kind: 'grid';
      shape: ResolvedGrid;
      tiles: ReadonlyArray<AdaptiveTile>;
      uniqueFamilies: number;
      isNotablePoint: boolean;
    };

const leafCache = new Map<string, Promise<ResolvedAdaptiveData>>();
const warnedRejections = new Set<string>();
let cacheGeneration = 0;

/**
 * Test-only escape hatch. Throws unless `NODE_ENV === 'test'` so production
 * bundles can't accidentally reach it. Call this in `beforeEach` to reset
 * state across tests.
 */
export function __resetAdaptiveGridCacheForTesting(): void {
  // Vite/esbuild substitutes import.meta.env.MODE at build time; in jsdom
  // tests Vitest sets MODE='test'. The guard is a runtime safety net, not a
  // dead-code-elimination tool.
  const mode = import.meta.env.MODE;
  if (mode !== 'test') {
    throw new Error('Test-only API');
  }
  leafCache.clear();
  warnedRejections.clear();
  cacheGeneration = 0;
}

/**
 * Stable string hash for observation subIds (issue #554 silhouette
 * deconflict). Used to derive a NEGATIVE pseudo-cluster_id so silhouette
 * inputs can be carried through `buildGroups` alongside real clusters
 * without collision. djb2-style — same algorithm as the unit tests'
 * `hashForTest`. The return value is wrapped through `Math.abs` so
 * negation in the caller produces a deterministic negative id.
 */
function hashSubId(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * PresentationMarker — a <Marker> wrapper that removes `role="button"` from
 * the maplibre-gl marker container div after mount.
 *
 * Why this is needed (WCAG 4.1.2 / #459 W4-C):
 *   maplibre-gl's Marker.addTo() calls `setAttribute('role', 'button')` on
 *   its container element unless a role is already present. When the Marker
 *   children are themselves interactive elements (<button>: AdaptiveGridMarker,
 *   ClusterPill), the result is a `<div role="button">`
 *   wrapping a `<button>` — a nested-interactive WCAG 4.1.2 violation that
 *   axe-core flags on every visible marker (47 violations in the 2026-05-11
 *   audit).
 *
 * Fix: react-map-gl's Marker component exposes the MapLibre MarkerInstance
 * via forwardRef. After mount we set role="presentation" on the wrapper
 * element. This overrides maplibre's role="button" and removes the
 * interactive semantics from the container; the child <button> remains the
 * canonical interactive element with full keyboard + AT support.
 *
 * We do NOT use aria-hidden="true" — that propagates to children and hides
 * the inner <button> from assistive technologies (silent AT regression).
 */
interface PresentationMarkerProps {
  longitude: number;
  latitude: number;
  anchor?: 'center' | 'top' | 'bottom' | 'left' | 'right' |
    'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  children: React.ReactNode;
}

function PresentationMarker({ longitude, latitude, anchor, children }: PresentationMarkerProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerRef = useRef<any>(null);

  useEffect(() => {
    const mk = markerRef.current;
    if (mk && typeof mk.getElement === 'function') {
      mk.getElement().setAttribute('role', 'presentation');
    }
  }, []);

  return (
    <Marker ref={markerRef} longitude={longitude} latitude={latitude} anchor={anchor}>
      {children}
    </Marker>
  );
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
   * Also drives the adaptive-grid tiles for every cluster (epic #539).
   * When the array is empty (cache miss), the reconciler short-circuits
   * and pill markers carry the cluster signal.
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
 * Adaptive grid (epic #539): on every map idle the reconciler queries
 * cluster features and materializes one <AdaptiveGridMarker> per grid-
 * shape cluster (1×1 — 4×4). Clusters with too many families or too many
 * leaves fall through to <ClusterPill> via the ClusterPillOverlay path.
 * Coincident observations are disambiguated by the grid's 1×1/2×1 shapes
 * — no animated fan, no escape to close.
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
   * Unified deconflict output (issue #554). One entry per overlap-component
   * — each carries an anchor cluster (whose marker actually paints) and the
   * full list of `memberIds` that the anchor subsumed. The render block
   * iterates this and dispatches to `<AdaptiveGridMarker>` or
   * `<ClusterPill>` based on `anchor.rendered.kind`.
   *
   * Replaces the prior `grids: Map<number, AdaptiveGridEntry>` slice AND
   * the pill-overlay `clusterFeatures: ClusterFeature[]` slice — one
   * single source of truth, one reconciler pass.
   */
  const [groups, setGroups] = useState<DeconflictGroup[]>([]);
  /**
   * Per-subId pixel offset for displaced silhouettes (issue #554 scope
   * expansion 2026-05-15). Populated by `displaceSilhouettes` whenever
   * the reconciler runs; consumed by the render block to position a
   * <PresentationMarker> at the shifted lng/lat, and by the feature-state
   * loop below to hide the canvas-painted twin. Carries lng/lat too so
   * the render block doesn't re-walk the unclustered feature list.
   */
  const [silhouetteOffsets, setSilhouetteOffsets] = useState<
    Map<string, { dx: number; dy: number; longitude: number; latitude: number }>
  >(new Map());
  /**
   * subIds whose canvas twin was hidden via feature-state on the prior
   * reconcile pass. Tracked so we can call removeFeatureState when a
   * silhouette stops being displaced (e.g. cluster pans off-screen or
   * zoom changes break up the overlap). Without this, an earlier-hidden
   * silhouette would stay invisible after the displacement clears.
   */
  const prevHiddenSubIdsRef = useRef<Set<string>>(new Set());
  /**
   * Silhouette data lookup for the displaced-silhouette render path.
   * `silhouettesById` (below) is keyed by lowercased familyCode for the
   * symbol layer; we also need a per-subId family/color lookup. Cheap
   * to derive from the observations + silhouettes inputs.
   */
  // (Computed inline below as `silhouetteRenderById` once `silhouettesById`
  // and `obsLookup` are in scope.)
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

  // Phase 0: read prefers-reduced-motion once at mount. useMemo with an empty
  // dep array captures the value once — intentional. The user must reload to
  // fully apply other reduced-motion changes anyway, and re-checking adds
  // complexity for negligible gain.
  const prefersReducedMotion = useMemo(
    () =>
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false,
    [],
  );

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

  /**
   * Monotonic `silhouettesVersion` (spec §5.3 Concern C, point 2). This is
   * a strict integer counter, NOT `silhouettes.length` — a length-only
   * proxy misses in-place row replacement (same count, different svgData
   * — Phylopic refreshes, low-res→hi-res swaps). The counter increments
   * each time the silhouettes prop changes by reference, which is the same
   * point where the supercluster catalogue is rebuilt.
   *
   * Carried into the per-grid memo key + the cache-generation effect so
   * an in-place catalogue refresh invalidates render-pass identity and the
   * Concern B promise cache together.
   */
  const silhouettesVersionRef = useRef(0);
  const prevSilhouettesRef = useRef<typeof silhouettes>(silhouettes);
  if (prevSilhouettesRef.current !== silhouettes) {
    silhouettesVersionRef.current += 1;
    prevSilhouettesRef.current = silhouettes;
  }
  const silhouettesVersion = silhouettesVersionRef.current;

  /**
   * Pure per-family lookup used by `buildAdaptiveTiles` (spec §5.3 Concern
   * C, point 3). Resolved once per reconcile from the silhouettes prop —
   * the tile-builder MUST NOT read from a ref, so we thread this
   * explicitly. An empty map signals "catalogue not loaded yet" and
   * produces all-`pending` tiles.
   */
  const silhouettesById = useMemo<SilhouettesById>(() => {
    const map = new Map<string, { svgData: string | null; color: string }>();
    for (const s of silhouettes) {
      map.set(s.familyCode.toLowerCase(), {
        svgData: s.svgData,
        color: s.color,
      });
    }
    return map;
  }, [silhouettes]);

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
   * Epic #539: the auto-spider subsystem (use-auto-spider.ts, stack-fanout,
   * fan-layout, StackedSilhouetteMarker) is retired. Coincident observations
   * are now disambiguated via the adaptive grid: at z≥CLUSTER_MAX_ZOOM,
   * supercluster's `cluster_id` already singles them out, and the 2×1 / 1×1
   * grid shapes carry the family-color signal without an animated fan.
   */

  const geojson = useMemo(
    () => observationsToGeoJson(observations, silhouettes),
    [observations, silhouettes],
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

  /**
   * Per-subId silhouette-render lookup (issue #554 scope expansion 2026-05-15).
   * Maps each observation's subId → its rendered silhouette path + color, so
   * the displaced-silhouette render block can paint an inline SVG that
   * visually matches the symbol-layer rendering it replaces.
   * `svgData === null` means the family has no usable Phylopic silhouette —
   * the displaced marker falls through to the _FALLBACK shape.
   */
  const silhouetteRenderById = useMemo(() => {
    const lookup = new Map<string, { svgData: string | null; color: string }>();
    for (const o of observations) {
      const key = o.familyCode?.toLowerCase();
      const sil = key ? silhouettesById.get(key) : undefined;
      lookup.set(o.subId, {
        svgData: sil?.svgData ?? null,
        color: sil?.color ?? '#555',
      });
    }
    return lookup;
  // silhouettesById captures the silhouettes prop transitively (see its useMemo above).
  }, [observations, silhouettesById]);

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
    // Deconflict e2e hook (#554 Task 5): the marker-overlap spec drives
    // easeTo({zoom: N}) deterministically across 6 zoom levels. Gated to
    // test + development so production bundles never leak the instance.
    if (
      typeof window !== 'undefined' &&
      (import.meta.env.MODE === 'test' ||
        import.meta.env.MODE === 'development')
    ) {
      (window as unknown as { __mapForTests?: unknown }).__mapForTests = map;
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

    // Cluster click — the 'clusters' layer's filter is `['boolean', false]`
    // (no visible canvas paint; all cluster clicks go through the React
    // AdaptiveGridMarker / ClusterPill paths). Kept for defensive parity
    // with the layer being added; if a future change re-enables the paint
    // layer, this handler still routes the click to expansion zoom.
    map.on('click', 'clusters', (e: MapLayerMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: ['clusters'],
      });
      const feature = features[0];
      if (!feature) return;

      const clusterId = feature.properties?.cluster_id as number | undefined;
      const source = map.getSource('observations');
      if (clusterId == null || !source) return;

      const geom = feature.geometry;
      const center: [number, number] | null =
        geom.type === 'Point' ? (geom.coordinates as [number, number]) : null;

      if ('getClusterExpansionZoom' in source) {
        const src = source as {
          getClusterExpansionZoom: (id: number) => Promise<number>;
        };
        src
          .getClusterExpansionZoom(clusterId)
          .then((zoom) => {
            if (center) {
              map.easeTo({
                center,
                zoom,
                ...(prefersReducedMotion ? { duration: 0 } : {}),
              });
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
   * Adaptive-grid reconciler (epic #539). Queries rendered cluster features
   * on `load` and `idle`, materializes one HTML <Marker> per cluster as an
   * AdaptiveGridMarker (1×1 — 4×4 grid, sized per family count per spec
   * §4.1). Clusters with uniqueFamilies > 16 OR point_count > 64 fall back
   * to <ClusterPill> via the separate ClusterPillOverlay path further down.
   *
   * The reconciler enforces the three memoization layers (spec §5.3
   * Concerns A/B/C):
   *   - Concern A: per-marker useMemo at JSX time.
   *   - Concern B: module-scoped `leafCache` (Promise cache, zoom-prefixed
   *     key, rejection-evicting).
   *   - Concern C: `cacheGeneration` race-safe commit + monotonic
   *     `silhouettesVersion` invalidation.
   *
   * Bare-event handlers (no layer ID) — `idle` fires after every render
   * settle, NOT once per frame, so this is cheap. The async
   * `getClusterLeaves` call is awaited per-cluster but the per-cluster
   * Promises run concurrently via Promise.all.
   *
   * Cluster identity: supercluster auto-assigns `cluster_id` to the
   * feature's `properties.cluster_id` AND `feature.id`. We key on
   * `properties.cluster_id` (more reliable than `feature.id` — the latter
   * isn't guaranteed populated for cluster aggregation features).
   */
  useEffect(() => {
    // Skip the whole reconciler when there are no silhouettes to draw —
    // tiles would all be `pending` and add visual noise.
    if (silhouettes.length === 0) return undefined;
    // Wait for the map to fire its initial `load` event before grabbing
    // the ref. mapRef.current is null until the maplibre Map child
    // commits, and effect commit order can race against that.
    if (!mapReady) return undefined;
    const map = mapRef.current?.getMap();
    if (!map) return undefined;

    // Spec §5.3 Concern C: bump the generation + wholesale-clear the
    // promise cache whenever this effect re-registers (silhouettes
    // change, map remount). In-flight reconciles capture `myGen` and
    // no-op their setGrids call if the generation has advanced.
    cacheGeneration += 1;
    leafCache.clear();

    let cancelled = false;

    const reconcile = async () => {
      const myGen = cacheGeneration;
      const isMobile = map.getContainer
        ? map.getContainer().getBoundingClientRect().width < 768
        : false;
      const floorZoom = Math.floor(map.getZoom());
      const currentKeys = new Set<string>();
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
      // Dedupe by cluster_id (queryRenderedFeatures can return one
      // feature per tile boundary the cluster crosses; the dedupe keeps
      // each cluster materialized exactly once). Pill vs grid decision
      // is made inside the per-cluster resolution via pickGridShape — no
      // up-front size filter here.
      const seen = new Set<number>();
      const candidates = features.filter((f) => {
        const id = f.properties?.['cluster_id'];
        if (typeof id !== 'number') return false;
        const pointCount = f.properties?.['point_count'];
        if (typeof pointCount !== 'number') return false;
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

      // Unified deconflict input list (issue #554). Each resolved cluster
      // — grid OR pill — becomes one DeconflictInput. After Promise.all
      // settles, buildGroups(...) runs the Union-Find pass and emits the
      // anchor-only groups list that the render block iterates.
      const inputs: DeconflictInput[] = [];
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

          // Concern B cache key — zoom-prefixed per spec §5.3 to prevent
          // collisions across zoom levels (supercluster's integer
          // cluster_id values are recycled across zoom strata).
          const key = `${floorZoom}:${clusterId}:${pointCount}`;
          currentKeys.add(key);

          // Build (or reuse) the resolved adaptive-data Promise for this
          // cluster. The cached Promise is the FULL derivation chain —
          // leaves → aggregates → shape → tiles — so a hit short-circuits
          // every step.
          let resolvedPromise: Promise<ResolvedAdaptiveData> | undefined =
            leafCache.get(key);
          if (!resolvedPromise) {
            const fresh: Promise<ResolvedAdaptiveData> = (async () => {
              const leaves = (await source.getClusterLeaves(
                clusterId,
                64, // MAX_OBSERVATIONS — see adaptive-grid.ts spec §4.1
                0,
              )) as ClusterLeafFeature[];
              const aggregates = aggregateClusterFamilies(leaves);
              const uniqueFamilies = aggregates.length;
              const shape = pickGridShape(
                uniqueFamilies,
                pointCount,
                isMobile,
              );
              if (shape.tag === 'pill') {
                // Pill markers feed deconflict with `rendered.kind = 'pill'`.
                // We cache the decision so a future idle short-circuits
                // without re-fetching leaves.
                return { kind: 'pill', uniqueFamilies };
              }
              const tiles = buildAdaptiveTiles(
                leaves,
                silhouettesById,
                shape,
              );
              // F7 option (a): only mark the marker isNotable when the
              // cluster is strictly 1×1 with a single notable observation.
              // Per-tile isNotable is the future-extension path (option b).
              const isNotablePoint =
                pointCount === 1 &&
                uniqueFamilies === 1 &&
                Boolean(leaves[0]?.properties['isNotable']);
              return {
                kind: 'grid',
                shape,
                tiles,
                uniqueFamilies,
                isNotablePoint,
              };
            })();
            // Rejected-Promise eviction (spec §5.3 Concern B). The
            // `.catch()` fires in the same microtask as the rejection,
            // so a transient failure does not poison the cache.
            // warnedRejections rate-limits the console.warn to once per
            // key — persistently-broken clusters don't spam.
            fresh.catch((err) => {
              leafCache.delete(key);
              if (!warnedRejections.has(key)) {
                console.warn(
                  '[adaptive-grid] getClusterLeaves rejected',
                  key,
                  err,
                );
                warnedRejections.add(key);
              }
            });
            leafCache.set(key, fresh);
            resolvedPromise = fresh;
          }

          try {
            const resolved = await resolvedPromise;
            // Project lng/lat → pixel space for the AABB overlap pass.
            // deconflict.ts is pure + sync; the caller owns projection.
            const projected = map.project([longitude, latitude]);
            const px = projected.x;
            const py = projected.y;
            if (resolved.kind === 'pill') {
              inputs.push({
                cluster_id: clusterId,
                px,
                py,
                rendered: { kind: 'pill', count: pointCount },
                point_count: pointCount,
                uniqueFamilies: resolved.uniqueFamilies,
                longitude,
                latitude,
              });
            } else {
              inputs.push({
                cluster_id: clusterId,
                px,
                py,
                rendered: { kind: 'grid', shape: resolved.shape },
                point_count: pointCount,
                uniqueFamilies: resolved.uniqueFamilies,
                longitude,
                latitude,
                tiles: resolved.tiles,
                isNotable: resolved.isNotablePoint,
              });
            }
          } catch {
            // Cluster could've expired between the queryRenderedFeatures
            // and the getClusterLeaves resolution (zoom-in mid-flight).
            // Drop silently — the next idle tick will reconcile.
          }
        }),
      );

      // ── Silhouette inputs (issue #554 scope expansion 2026-05-15) ────
      //
      // Query every visible unclustered-point feature, project its
      // lng/lat, and push it onto the deconflict input list as a
      // silhouette variant. The negative pseudo-cluster_id derived from
      // the subId hash keeps silhouette ids out of the positive cluster
      // namespace so `min(cluster_id)` tiebreaks behave; `buildGroups`
      // additionally prefers any non-silhouette over a silhouette as
      // the anchor (see deconflict.ts buildGroups rule).
      //
      // Defensive: the `unclustered-point` symbol layer mounts only
      // once `spritesReady` flips true, so on a cold reconcile the
      // layer can be absent — `getLayer` guards against the maplibre
      // "layer does not exist in the map's style and cannot be queried
      // for features" error. Subsequent idle reconciles after the
      // sprite-registration effect settles will pick up the layer.
      const unclusteredFeats = (
        map.getLayer && map.getLayer('unclustered-point')
          ? map.queryRenderedFeatures(undefined, {
              layers: ['unclustered-point'],
            })
          : []
      ) as Array<{
        properties?: { subId?: string };
        geometry?: { type: 'Point'; coordinates: [number, number] };
        id?: number | string;
      }>;
      const silSubIdsSeen = new Set<string>();
      for (const f of unclusteredFeats) {
        const subId = f.properties?.subId;
        if (!subId || silSubIdsSeen.has(subId)) continue;
        silSubIdsSeen.add(subId);
        const geom = f.geometry;
        if (!geom || geom.type !== 'Point') continue;
        const [longitudeS, latitudeS] = geom.coordinates;
        const projectedS = map.project([longitudeS, latitudeS]);
        inputs.push({
          cluster_id: -hashSubId(subId),
          px: projectedS.x,
          py: projectedS.y,
          rendered: { kind: 'silhouette' },
          point_count: 1,
          uniqueFamilies: 1,
          longitude: longitudeS,
          latitude: latitudeS,
          subId,
        });
      }

      // Spec §5.3 Concern C race-safe commit: if the catalogue refreshed
      // mid-flight, drop this commit — the new effect-registration's
      // reconcile will produce the right tiles.
      if (cancelled || myGen !== cacheGeneration) return;
      // Run deconflict (pure, sync). Output: one group per overlap component.
      const nextGroups = buildGroups(inputs, floorZoom);
      setGroups(nextGroups);

      // Compute per-subId pixel offsets for silhouettes that overlap a
      // cluster anchor, then unproject the offset to lng/lat for the
      // render block. The unproject is a tiny per-displaced-silhouette
      // computation — bounded by silhouette count, typically <20.
      const pxOffsets = displaceSilhouettes(nextGroups, inputs);
      const nextOffsets = new Map<
        string,
        { dx: number; dy: number; longitude: number; latitude: number }
      >();
      // Build a quick subId → input lookup for the projection round-trip.
      const inputBySubId = new Map<string, DeconflictInput>();
      for (const inp of inputs) {
        if (inp.subId) inputBySubId.set(inp.subId, inp);
      }
      for (const [subId, off] of pxOffsets) {
        const inp = inputBySubId.get(subId);
        if (!inp || inp.longitude === undefined || inp.latitude === undefined) continue;
        const displacedPx = inp.px + off.dx;
        const displacedPy = inp.py + off.dy;
        const ll = map.unproject([displacedPx, displacedPy]);
        nextOffsets.set(subId, {
          dx: off.dx,
          dy: off.dy,
          longitude: ll.lng,
          latitude: ll.lat,
        });
      }
      setSilhouetteOffsets(nextOffsets);

      // Feature-state sync: hide the canvas-painted twin for every
      // displaced silhouette; clear feature-state for silhouettes that
      // were displaced last pass but aren't now. promoteId="subId" on
      // the Source ensures setFeatureState({id: subId}) targets the
      // right feature.
      const nextHidden = new Set<string>(nextOffsets.keys());
      const prevHidden = prevHiddenSubIdsRef.current;
      // Hide newly-displaced silhouettes.
      for (const subId of nextHidden) {
        if (!prevHidden.has(subId)) {
          map.setFeatureState(
            { source: 'observations', id: subId },
            { hidden: true },
          );
        }
      }
      // Clear feature-state for silhouettes that are no longer displaced.
      for (const subId of prevHidden) {
        if (!nextHidden.has(subId)) {
          map.removeFeatureState(
            { source: 'observations', id: subId },
            'hidden',
          );
        }
      }
      prevHiddenSubIdsRef.current = nextHidden;

      // End-of-idle eviction (spec §5.3 Concern B): drop cache entries
      // for clusters that no longer appear in the viewport. Bounds
      // worst-case memory at O(visible clusters), not O(every cluster
      // ever seen).
      for (const k of leafCache.keys()) {
        if (!currentKeys.has(k)) leafCache.delete(k);
      }
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
    // Re-register when the silhouettes catalogue OR the resolved
    // silhouettesById map changes, OR when the map first becomes ready.
    // silhouettesVersion is included as a dep to surface monotonic
    // catalogue replacements that don't change array identity (defensive —
    // useMemo already keys silhouettesById on [silhouettes], so this is
    // a belt-and-braces guard the spec §5.3 commit-race tests assert).
  }, [silhouettes, silhouettesById, silhouettesVersion, mapReady]);

  // Phase 1: [data-theme] observer — swap basemap when user toggles theme.
  // Registered after mapReady so the map instance is guaranteed to exist.
  // Cleaned up on unmount to prevent leaks. The observer is the single
  // source of truth for basemap-vs-theme coupling — no prop drilling.
  // Dark URL aliasing (G8): BASEMAP_DARK may resolve to the same
  // visual tiles as light during the rollout window; the swap mechanism
  // is correct regardless. See docs/design/01-spec/open-questions.md.
  //
  // Same-value guard: MutationRecord fires on every attribute write,
  // including writes that set the SAME value the attribute already had
  // (e.g. setAttribute('data-theme', 'light') when it's already 'light').
  // Without the prevTheme ref, a no-op write would trigger setStyle and
  // a redundant tile re-fetch.
  const prevThemeRef = useRef<'light' | 'dark' | null>(null);
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current?.getMap();
    if (!map) return;

    // Seed the prev ref with the current attribute value so the first
    // observed mutation only fires setStyle when the value genuinely flips.
    prevThemeRef.current =
      document.documentElement.getAttribute('data-theme') === 'dark'
        ? 'dark'
        : 'light';

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (
          mutation.type === 'attributes' &&
          mutation.attributeName === 'data-theme'
        ) {
          const next: 'light' | 'dark' =
            document.documentElement.getAttribute('data-theme') === 'dark'
              ? 'dark'
              : 'light';
          if (next === prevThemeRef.current) return;
          prevThemeRef.current = next;
          const style = next === 'dark' ? BASEMAP_DARK : BASEMAP_LIGHT;
          map.setStyle(style);
        }
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => observer.disconnect();
  }, [mapReady]);

  /**
   * Parent-routed click for unified deconflict groups (issue #554; replaces
   * the prior `handleGridMarkerClick` + `handleClusterPillClick` pair).
   *
   *   Singleton case (memberIds.length === 1 AND anchor.point_count === 1):
   *     open the observation popover directly. Same UX as the prior grid
   *     single-leaf path.
   *
   *   Multi-member case: click-time-lazy `getClusterExpansionZoom` over
   *     every memberId; easeTo target = `Math.max(...zooms)` (capped at
   *     `CLUSTER_MAX_ZOOM`). Using max — not min — ensures the camera
   *     reaches the zoom where the LAST overlapping cluster breaks apart,
   *     so the user always sees real expansion. Matches the click-time-lazy
   *     pattern from the prior `handleClusterPillClick`.
   */
  const handleGroupClick = useCallback(
    async (group: DeconflictGroup) => {
      const { anchor, memberIds } = group;

      // Singleton: open the obs popover directly. The cluster's single
      // observation is resolvable by lng/lat against obsLookup (within ε
      // to handle float roundtrip through the GeoJSON source).
      if (memberIds.length === 1 && anchor.point_count === 1) {
        const EPS = 1e-6;
        const obs = observations.find(
          (o) =>
            anchor.longitude !== undefined &&
            anchor.latitude !== undefined &&
            Math.abs(o.lng - anchor.longitude) < EPS &&
            Math.abs(o.lat - anchor.latitude) < EPS,
        );
        if (obs) setSelectedObs(obs);
        return;
      }

      const map = mapRef.current?.getMap();
      if (!map) return;
      const source = map.getSource('observations');
      if (!source || !('getClusterExpansionZoom' in source)) return;
      const src = source as {
        getClusterExpansionZoom: (id: number) => Promise<number>;
      };

      try {
        // Click-time-lazy: async expansion-zoom aggregation over ALL
        // members. Max — not min — so the camera always reaches the zoom
        // where every member separates. Capped at CLUSTER_MAX_ZOOM (22)
        // for parity with the prior pill-click behavior.
        const zooms = await Promise.all(
          memberIds.map((id) => src.getClusterExpansionZoom(id)),
        );
        const targetZoom = Math.min(Math.max(...zooms), CLUSTER_MAX_ZOOM);
        const currentZoom = map.getZoom();
        if (
          targetZoom > currentZoom &&
          anchor.longitude !== undefined &&
          anchor.latitude !== undefined
        ) {
          map.easeTo({
            center: [anchor.longitude, anchor.latitude],
            zoom: targetZoom,
            ...(prefersReducedMotion ? { duration: 0 } : {}),
          });
        }
      } catch {
        // getClusterExpansionZoom may reject for recycled cluster_ids
        // (the camera moved fast enough that the source rebuilt). Match
        // the prior err-swallow pattern.
      }
    },
    [observations, prefersReducedMotion],
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

  /* Hit-target layer: render hit targets at zoom >= CLUSTER_MAX_ZOOM
     (now 22, post-cutover) for individual observations. The adaptive-grid
     reconciler renders 1×1 grid markers for singletons at this zoom; the
     hit layer is the wider clickable surface that survives small marker
     sizes. Below CLUSTER_MAX_ZOOM, observations are clustered, so the
     overlay is suppressed and cluster-marker clicks (AdaptiveGridMarker /
     ClusterPill) drive the interaction. */
  const hitMarkers: HitTargetMarker[] = useMemo(() => {
    if (mapZoom < CLUSTER_MAX_ZOOM) {
      return [];
    }
    return observations.map((o) => {
      // If this subId is currently displaced (silhouette deconflict),
      // anchor the hit target at the displaced lng/lat so clicks land on
      // where the user actually sees the silhouette, not the canvas-
      // hidden original position.
      const displaced = silhouetteOffsets.get(o.subId);
      const lngLat: [number, number] = displaced
        ? [displaced.longitude, displaced.latitude]
        : [o.lng, o.lat];
      return {
        subId: o.subId,
        comName: o.comName,
        familyCode: o.familyCode,
        locName: o.locName,
        obsDt: o.obsDt,
        isNotable: o.isNotable,
        lngLat,
      };
    });
  }, [observations, mapZoom, silhouetteOffsets]);

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
        mapStyle={
          typeof document !== 'undefined' &&
          document.documentElement.getAttribute('data-theme') === 'dark'
            ? BASEMAP_DARK
            : BASEMAP_LIGHT
        }
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
          // Phase 0 finding F4: when clusterMaxZoom rises to 22 (epic #539
          // cutover), maplibre warns that source `maxzoom` (default 18)
          // must exceed clusterMaxZoom. Setting maxzoom=24 lifts the
          // source ceiling above the cluster ceiling and silences the
          // warning. Required to keep Gate 4 (zero console warnings)
          // green on cold map init.
          maxzoom={24}
          // promoteId="subId" surfaces the observation subId as the
          // feature.id, which is what setFeatureState({id, ...}) keys on.
          // The silhouette-displacement path (issue #554 scope expansion)
          // uses this to set `hidden: true` on canvas-painted silhouettes
          // whose displaced React twins are rendered via <PresentationMarker>.
          promoteId="subId"
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
          Unified deconflict render (issue #554). Iterates the
          `groups` slice — one entry per overlap component — and
          dispatches to <AdaptiveGridMarker> or <ClusterPill> based
          on the anchor's rendered.kind. The spatial-bucket key
          (group.key) is stable when the anchor stays in the same
          ~14px bucket, so React's reconciler doesn't churn under pan.
        */}
        {groups.map((g) => {
          const { anchor } = g;
          // longitude/latitude are populated for every production input
          // (the reconciler push above); fall back to 0 only to satisfy
          // the optional-typed signature for unit-test consumers.
          const longitude = anchor.longitude ?? 0;
          const latitude = anchor.latitude ?? 0;
          if (anchor.rendered.kind === 'pill') {
            return (
              <PresentationMarker
                key={g.key}
                longitude={longitude}
                latitude={latitude}
                anchor="center"
              >
                <ClusterPill
                  count={anchor.point_count}
                  onClick={() => handleGroupClick(g)}
                />
              </PresentationMarker>
            );
          }
          if (anchor.rendered.kind === 'silhouette') {
            // Silhouette-only group (no cluster overlaps this silhouette).
            // The canvas-painted symbol layer already paints it at the
            // correct lng/lat — no React marker needed. Returning null
            // keeps the loop's render output sparse so React doesn't
            // reconcile an empty marker.
            return null;
          }
          return (
            <PresentationMarker
              key={g.key}
              longitude={longitude}
              latitude={latitude}
            >
              <AdaptiveGridMarker
                shape={anchor.rendered.shape}
                tiles={anchor.tiles ?? []}
                totalCount={anchor.point_count}
                uniqueFamilies={anchor.uniqueFamilies}
                ariaLabel={g.ariaLabel}
                isCoarsePointer={isCoarsePointer}
                isNotable={anchor.isNotable ?? false}
                onClick={() => handleGroupClick(g)}
              />
            </PresentationMarker>
          );
        })}
        {/*
          Displaced silhouettes (issue #554 scope expansion 2026-05-15).
          Per user direction silhouettes MUST REMAIN VISIBLE; when one
          would overlap a cluster anchor, deconflict pushes it ≤20px
          aside (in pixel space, unprojected to lng/lat here). The
          canvas-painted twin is hidden via feature-state on the
          unclustered-point symbol layer — see the reconciler loop.
        */}
        {Array.from(silhouetteOffsets.entries()).map(([subId, entry]) => {
          const obs = obsLookup[subId];
          if (!obs) return null;
          const sil = silhouetteRenderById.get(subId);
          const color = sil?.color ?? '#555';
          const svgData = sil?.svgData ?? null;
          // Displaced silhouettes are rendered as accessible <button>
          // wrappers so a click opens the obs popover even though the
          // canvas-painted twin is hidden. The PresentationMarker outer
          // div has role="presentation" (see PresentationMarker effect),
          // so the inner <button> remains the canonical interactive
          // element with full keyboard + AT support.
          return (
            <PresentationMarker
              key={`displaced-${subId}`}
              longitude={entry.longitude}
              latitude={entry.latitude}
              anchor="center"
            >
              <button
                type="button"
                data-testid="displaced-silhouette"
                data-subid={subId}
                aria-label={`${obs.comName} observation`}
                onClick={() => setSelectedObs(obs)}
                style={{
                  display: 'inline-block',
                  width: SILHOUETTE_PX,
                  height: SILHOUETTE_PX,
                  padding: 0,
                  margin: 0,
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                }}
              >
                {svgData ? (
                  <svg
                    viewBox="0 0 24 24"
                    width={SILHOUETTE_PX}
                    height={SILHOUETTE_PX}
                    aria-hidden="true"
                  >
                    {/* Halo (white stroke) painted first so the colored
                        body sits on top, mirroring the SDF symbol layer's
                        icon-halo-color #ffffff / icon-halo-width 1.5. */}
                    <path
                      d={svgData}
                      fill="none"
                      stroke="#ffffff"
                      strokeWidth="2"
                      strokeLinejoin="round"
                    />
                    <path d={svgData} fill={color} />
                  </svg>
                ) : (
                  // Fallback circle when the family has no Phylopic
                  // silhouette — matches the _FALLBACK opacity tinting.
                  <svg
                    viewBox="0 0 24 24"
                    width={SILHOUETTE_PX}
                    height={SILHOUETTE_PX}
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="8" fill={color} opacity="0.5" />
                  </svg>
                )}
              </button>
            </PresentationMarker>
          );
        })}
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

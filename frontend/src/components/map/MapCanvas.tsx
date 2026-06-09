import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// ZIP_FLYTO_ZOOM is the single shared metro-framing zoom (= 10) owned by
// Stream D's scope-types. The ZIP `flyTo` move carries its own `zoom` in the
// prop (App.tsx builds it via `zipResolutionToScope`), but importing the
// constant here keeps the contract single-sourced — `MapCanvas` never
// re-literals 10 and asserts the incoming flyTo zoom against the shared value.
import { ZIP_FLYTO_ZOOM } from '../../state/scope-types.js';
// Aliasing the react-map-gl/maplibre Map component to MapView so the
// global ES Map constructor remains available inside this module — otherwise
// `new Map()` inside e.g. `leafCache = new Map<string, Promise<...>>()`
// resolves to the React component and throws "Map is not a constructor".
import {
  Map as MapView,
  Source,
  Layer,
  Marker,
} from 'react-map-gl/maplibre';
import type { MapLayerMouseEvent, MapRef } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
// GeoJSON structural types come from `geojson` (@types/geojson), NOT maplibre-gl
// (5.x does not re-export them). `import type`, erased at build — see mask.ts.
import type { MultiPolygon } from 'geojson';
import type { AggregatedBucket, Observation } from '@bird-watch/shared-types';
import { BASEMAP_LIGHT, BASEMAP_DARK } from './basemap-style.js';
import {
  CONUS_BOUNDS,
  FIT_BOUNDS_PADDING,
  INITIAL_VIEW,
  MIN_ZOOM,
} from './camera-config.js';
import {
  buildMaskFeature,
  padBounds,
  MASK_FILL_LIGHT,
  MASK_FILL_DARK,
} from './mask.js';
import {
  applyLabelIsolation,
  restoreLabelIsolation,
  bufferIsolationPolygon,
  applyArtboardFidelity,
  removeFloatLayers,
  MASK_LAYER_ID,
} from './artboard-layers.js';
import {
  observationsToGeoJson,
  bucketsToGeoJson,
  buildClusterLayerSpec,
  buildClusterCountLayerSpec,
  buildClustersHitLayerSpec,
  buildUnclusteredPointLayerSpec,
  buildNotableRingLayerSpec,
  CLUSTER_MAX_ZOOM,
  CLUSTER_RADIUS,
  FALLBACK_SILHOUETTE_ID,
} from './observation-layers.js';
import { mergeLeafBuckets } from '../../data/bucket-aggregates.js';
import type { SpeciesDictionary } from '../../data/use-species-dictionary.js';
import { ObservationPopover } from './ObservationPopover.js';
import { AdaptiveGridMarker } from './AdaptiveGridMarker.js';
import { ClusterListPopover } from './ClusterListPopover.js';
import { ClusterPill } from '../ds/ClusterPill.js';
import { isValidSvgPathData } from './silhouette-fallback.js';
import {
  aggregateClusterFamilies,
  aggregateClusterSpecies,
  buildAdaptiveTiles,
  tilesFromAggregates,
  pickGridShape,
  type ClusterLeafFeature,
  type FamilyAggregate,
  type SilhouettesById,
  type SpeciesAggregate,
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
import { resolveFamilyName } from '../../derived.js';
// Type-only declarations extracted to MapCanvas.types.ts (epic #884, U1 / #885).
// `MapCanvasProps` is re-exported from there and back-imported here; this keeps
// the export knip-clean (its in-file consumer at the destructuring below is
// covered by `ignoreExportsUsedInFile`) and leaves any future external importer
// pointing at a stable module path.
import type {
  MapCanvasProps,
  ResolvedAdaptiveData,
  SelectedObsState,
} from './MapCanvas.types.js';
// Preserve the prior public surface: `MapCanvasProps` was exported from this
// module before the U1 extraction. Re-export it so any importer of
// `./MapCanvas.js` (none today — zero importers repo-wide) keeps resolving.
export type { MapCanvasProps } from './MapCanvas.types.js';
import { useCoarsePointer } from '../../lib/use-coarse-pointer.js';
import { usePrefersReducedMotion } from '../../lib/use-prefers-reduced-motion.js';

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
 * The vector-tile source id used by the OpenFreeMap basemap styles
 * (`positron` / `dark`, BASEMAP_LIGHT / BASEMAP_DARK). Both styles key their
 * tiles on `openmaptiles` — see the representative `style.layers` fixture in
 * MapCanvas.test.tsx (`source: 'openmaptiles'`). Used by `handleMapError` to
 * scope the benign tile/network swallow to the basemap ONLY, so a real 404 /
 * style-load error on one of the app's own sources (`observations`,
 * `state-mask`) is never silenced.
 */
export const BASEMAP_SOURCE_ID = 'openmaptiles';

/**
 * The maplibre `error` event payload as react-map-gl surfaces it
 * (@vis.gl/react-maplibre 8.1.1 `ErrorEvent = MapEvent<Map> & { error: Error }`).
 * `sourceId` is NOT in that exported type, but maplibre-gl 5.x attaches it to
 * source-data `error` events at runtime — so we widen the shape with an optional
 * `sourceId` rather than reach for `any`.
 */
type MapErrorEvent = { type: string; error?: Error; sourceId?: string };

/**
 * Narrow, explicit predicate for transient/benign map errors that are safe to
 * downgrade to `console.debug` during camera moves (#854). Two — and only two —
 * structured signals qualify; everything else is treated as genuine:
 *
 *   (i)  `error.name === 'AbortError'` — an in-flight basemap-tile fetch that was
 *        cancelled when a `fitBounds` fly (e.g. a scope/state switch) superseded
 *        it. This is the dominant noise source and the only one with a stable,
 *        structured discriminator.
 *   (ii) a tile/network error keyed on the basemap vector source
 *        (`sourceId === BASEMAP_SOURCE_ID`) — the occasionally-flaky OpenFreeMap
 *        CDN hiccup the issue describes.
 *
 * Deliberately NOT a loose message-substring match: a broad predicate would eat
 * a real basemap 404 or a style-load failure, which is exactly the "masks real
 * errors" failure mode #854 (and the bot review) warns against. An error on the
 * app's own sources (`observations`, `state-mask`) never matches clause (ii).
 */
export function isBenignMapError(e: MapErrorEvent): boolean {
  if (e.error?.name === 'AbortError') return true;
  if (e.sourceId === BASEMAP_SOURCE_ID) return true;
  return false;
}

/**
 * `onError` handler for `<MapView>` (#854). Passing `onError` fully diverts the
 * maplibre `error` event away from react-map-gl's built-in `_onEvent` fallback
 * (@vis.gl/react-maplibre 8.1.1 `maplibre.js` `_onEvent` :93-102 —
 * `const cb = this.props['onError']; if (cb) cb(e); else if (e.type === 'error')
 * console.error(e.error)`). Because the `cb` branch is taken, the library no
 * longer logs anything itself — so this handler MUST re-surface genuinely
 * unexpected errors via `console.error`, or they would be silently dropped.
 *
 * Benign transient errors (see `isBenignMapError`) are downgraded to
 * `console.debug` so the console stays clean during camera moves without hiding
 * real failures. No behavior change to the map.
 */
export function handleMapError(e: MapErrorEvent): void {
  if (isBenignMapError(e)) {
    // Downgraded, not dropped — still visible at the debug log level for anyone
    // who opts in, but out of the default error/warning console surface.
    console.debug('[map] benign transient error swallowed (#854)', e.error);
    return;
  }
  console.error(e.error);
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

// Camera / viewport config (CONUS framing constants, pan/zoom bounds,
// `pickInitialZoom`, `INITIAL_VIEW`, `FIT_BOUNDS_PADDING`) was extracted to
// `camera-config.ts` (epic #884, unit U2 / #886) — imported at the top of this
// file. Behavior-preserving move; the imperative camera machinery
// (clampBounds/padBounds/cameraForBounds/setMaxBounds) stays here for U12.

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
const EMPTY_DICT: SpeciesDictionary = new Map();
// Stable empty-bucket default — a fresh `[]` literal in the destructuring
// default would change identity every render and thrash the reconciler effect
// (whose dep array includes `buckets`), spinning an infinite re-register loop.
const EMPTY_BUCKETS: AggregatedBucket[] = [];

export function MapCanvas({
  observations,
  buckets = EMPTY_BUCKETS,
  mode = 'observations',
  dictionary = EMPTY_DICT,
  silhouettes = [],
  onSelectSpecies,
  onViewportChange,
  bounds,
  boundsKey,
  flyTo,
  maskPolygon,
  clampPad,
  detailOpen = false,
}: MapCanvasProps) {
  const aggregated = mode === 'aggregated';
  const mapRef = useRef<MapRef>(null);
  /**
   * Wrapper element the `map.resize()` ResizeObserver watches (#737, S3 of
   * #761). This is the `data-testid="map-canvas"` div — the box whose containing
   * block flipped from a padded `<main>` flex child to the `position: fixed;
   * inset: 0` `#map-layer` viewport sibling in S2. See the resize effect below.
   */
  const mapWrapperRef = useRef<HTMLDivElement>(null);
  /**
   * Scope-selector camera (#736). `activeBounds` is the FIT TARGET — the
   * envelope the camera frames on entry (`fitBounds` + the mount
   * `initialViewState`): the scope `bounds` prop when present, else the CONUS
   * fallback. This stays TIGHT on the state (never padded) so entry framing
   * lands you on the state (#760 AC: "entry still frames tightly"). The
   * reactive `maxBounds` CLAMP is `clampBounds` below — a distinct value.
   */
  const activeBounds = bounds ?? CONUS_BOUNDS;
  /**
   * Scope-selector clamp (#736 finding (a) + #760/#762 artboard). `clampBounds`
   * is the REACTIVE `maxBounds` prop — distinct from the fit target above. For a
   * state scope with `clampPad`, it is the state envelope PADDED outward by
   * `clampPad`× per side (the single authoritative zoom-out gate), so the user
   * can zoom out and watch the state shrink on the gray artboard before the
   * clamp halts the move. For `?scope=us` and legacy callers (no `clampPad`) it
   * stays the raw `bounds ?? CONUS_BOUNDS` — unchanged behavior. Passed straight
   * to `<MapView maxBounds={clampBounds}>`; react-map-gl re-applies a changed
   * `maxBounds` with no `<Map>` remount.
   *
   * Finding-(a) invariant: imperative `setMaxBounds` during REACTIVE
   * RECONCILIATION — i.e. as the PRIMARY clamp mechanism, driven by a
   * mount/`maxBounds`-prop change — is FORBIDDEN. `maxBounds` is the reactive
   * `<Map>` prop above; that is the single authoritative clamp. There is ONE
   * sanctioned imperative `setMaxBounds` site: the #848 `moveend` corrector
   * below (~`:868`), a defensive IDEMPOTENT reassert of this same declarative
   * `clampBounds` value that an in-flight animation's transform-clone clobbered
   * (mirrors the accepted #762/#765 `renderWorldCopies`-on-`moveend` reassert).
   * It runs only behind a `moveend`, never during reconciliation, so it does
   * NOT make `maxBounds` imperative. The finding-(a) test guards the forbidden
   * path: it fires NO `moveend`, leaving the corrector registered-but-not-fired,
   * so any `setMaxBounds` it observes would necessarily be a reconciliation-time
   * primary-clamp call (the thing this invariant forbids).
   */
  const clampBounds =
    bounds && clampPad ? padBounds(bounds, clampPad) : activeBounds;
  /**
   * First-paint frame (#736, contract item 2). When a scope `bounds` is
   * present AT MOUNT, frame the first paint to those bounds (uncontrolled
   * `{ bounds, fitBoundsOptions }`) so there is no flash of the CONUS overview
   * before the load-gated `fitBounds` effect runs — mirrors the C0 prototype.
   * Otherwise keep the legacy CONUS `{ longitude, latitude, zoom }`. Read once
   * at mount via a ref so a later `bounds` prop change re-frames through the
   * imperative effect (the single camera model), not by mutating
   * `initialViewState` (which is construction-only and would not re-apply
   * anyway). The camera model stays UNCONTROLLED + imperative — no controlled
   * longitude/latitude/zoom props are added (ctx7 §4).
   */
  const initialViewStateRef = useRef(
    bounds
      ? { bounds, fitBoundsOptions: { padding: FIT_BOUNDS_PADDING, maxZoom: 12 } }
      : INITIAL_VIEW,
  );
  /**
   * Issue #718: ObservationPopover anchors to the clicked marker's screen
   * coordinates. The state carries both the observation and the
   * projected screen position (relative to the .map-canvas wrapper) so
   * the popover can render adjacent to the click rather than at the
   * top-left of the map surface (the legacy #246 placeholder behavior).
   */
  const [selectedObs, setSelectedObs] = useState<SelectedObsState | null>(null);
  /**
   * Mount state for the `<ClusterListPopover>` opened by `<ClusterPill>` when
   * a pill click would land at max-zoom (or supercluster returns a useless
   * expansion target). Mirrors the coarse-pointer `AdaptiveGridMarker` outer-
   * tap path. `anchorEl` is captured from the click's `e.currentTarget`
   * (race-free; see #717 / ClusterPill.tsx onClick contract). When null,
   * the popover is closed; when populated, it mounts in the render tree at
   * the bottom of the function.
   */
  const [clusterList, setClusterList] = useState<{
    // The DeconflictGroup whose pill/marker click opened this popover. Absent on
    // the #864 unclustered-bucket-silhouette path (a bare canvas click has no
    // group); the mount never reads `group`, so it stays informational.
    group?: DeconflictGroup;
    families: FamilyAggregate[];
    speciesByFamily: ReadonlyMap<string, ReadonlyArray<SpeciesAggregate>>;
    // #859: per-family distinct-species overflow (drives the active "+N more"
    // drill-in). Present only on the aggregated-bucket path; absent ⇒ static.
    overflowByFamily?: ReadonlyMap<string, number>;
    totalCount: number;
    uniqueFamilies: number;
    anchorEl: HTMLElement;
    /** Camera center the "+N more" drill-in escalates into (the group anchor). */
    drillCenter?: [number, number];
  } | null>(null);
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
  /**
   * Reactive theme for the state-artboard mask fill (#760/#762). Seeded from the
   * current `[data-theme]` attribute and flipped by the SAME MutationObserver
   * that swaps the basemap (below) — so the gray mask re-paints in lockstep with
   * the basemap on a light/dark toggle. react-map-gl diffs the `<Layer>` `paint`
   * prop, so updating this state re-paints the fill with no remount.
   */
  const [maskTheme, setMaskTheme] = useState<'light' | 'dark'>(() =>
    typeof document !== 'undefined' &&
    document.documentElement.getAttribute('data-theme') === 'dark'
      ? 'dark'
      : 'light',
  );

  // #763 — artboard FIDELITY imperative state.
  //
  // `savedFiltersRef` holds the basemap symbol layers' ORIGINAL filters captured
  // when `applyLabelIsolation` ran, so `restoreLabelIsolation` can undo the
  // `['within', …]` merge exactly when the mask unmounts (scope → us/chooser).
  //
  // `maskPolygonRef` mirrors the current prop so the ONCE-registered
  // `style.load` handler (which would otherwise close over a stale value) reads
  // the live polygon at swap time. Updated synchronously on render.
  const savedFiltersRef = useRef<ReturnType<typeof applyLabelIsolation> | null>(
    null,
  );
  const maskPolygonRef = useRef<MultiPolygon | null>(maskPolygon ?? null);
  maskPolygonRef.current = maskPolygon ?? null;
  // `styleEpoch` bumps once per `style.load` (i.e. per theme `setStyle` swap).
  // It is a dep of the float/sink effect so that effect RE-RUNS after the new
  // style finishes loading — by which time react-map-gl's reconcile has re-added
  // `state-mask-fill`, so the guard passes and the float layers (which `setStyle`
  // dropped) are restored. Without this, a theme swap left the artboard with NO
  // halo/outline until the next unrelated render.
  const [styleEpoch, setStyleEpoch] = useState(0);
  /* Coarse-pointer detection (#247, mobile; also used by auto-spider hit
     targets in #277). Extracted to a generic sensor hook in #889 (epic #884);
     reactive — reads on mount and listens for `change`. */
  const isCoarsePointer = useCoarsePointer();

  // Phase 0: read prefers-reduced-motion once at mount. Extracted to a generic
  // mount-once sensor hook in #889 (epic #884). It deliberately captures the
  // value once (no `change` listener) — the user must reload to fully apply
  // other reduced-motion changes anyway, and re-checking adds complexity for
  // negligible gain.
  const prefersReducedMotion = usePrefersReducedMotion();

  /**
   * SINGLE scope-driven camera-intent effect (#736 — Task C3), ported verbatim
   * from the C0 prototype's `ScopedMap` (frontend/prototypes/scope-prototype/
   * ScopedMap.tsx). Keyed on `[mapReady, boundsKey, flyTo?.key]` (+ the
   * reduced-motion value). Load-bearing properties:
   *
   *  - Gated on `mapReady` (the maplibre `load` event), NOT on
   *    `mapRef.current` being non-null. The chooser-first model (#740)
   *    remounts the `<Map>` on every scope pick, so an imperative call on the
   *    first commit races GL init — `mapRef.current` exists but `load` hasn't
   *    fired and the call is dropped or overridden by `initialViewState`
   *    (findings (b)/(f), ctx7 §4 mount-timing caveat).
   *  - PREFERS `flyTo` over `fitBounds`: a ZIP entry is a "point inside the
   *    state" intent and must win over the whole-state framing on the same
   *    chooser→map mount. The naive two-effect version let the state
   *    `fitBounds` clobber the metro-zoom ZIP `flyTo` (finding (f)).
   *  - `essential: true` is the reduced-motion bypass (ctx7 §3): the scope
   *    reframe changes what data the user sees, so the move must always LAND;
   *    we pass `duration: 0` under reduced motion to make the instant landing
   *    deterministic rather than relying on MapLibre's implicit zeroing.
   *
   * Legacy callers (no `boundsKey` AND no `flyTo`) get no scope reframe — the
   * uncontrolled `initialViewState` keeps the legacy CONUS framing.
   */
  useEffect(() => {
    if (!mapReady) return;
    if (boundsKey === undefined && flyTo === undefined) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    if (flyTo) {
      // The incoming `flyTo.zoom` is built from the shared `ZIP_FLYTO_ZOOM`
      // by App.tsx (`zipResolutionToScope`); we pass it through rather than
      // re-literaling 10. The void reference below keeps the import live as
      // the documented single-source contract even though the value rides in
      // on the prop.
      void ZIP_FLYTO_ZOOM;
      map.flyTo({
        center: flyTo.center,
        zoom: flyTo.zoom,
        essential: true,
        duration: prefersReducedMotion ? 0 : 800,
      });
      // The ZIP `flyTo` branch is IMMUNE to the #848 mid-flight longitude bug:
      // flyTo's easeFunc snaps to the exact targetCenter at `k===1`, so an
      // interrupted in-flight flyTo still lands the requested center. No
      // corrector is registered here — the branch is untouched.
      return;
    }

    // #848 — Switching to a new state WHILE the camera is mid-animation frames
    // the new state at the wrong longitude (zoom + latitude land correctly).
    // VERIFIED live + traced into maplibre-gl 5.24.0: this is the SAME in-flight
    // transform-clone replay class as the #762/#765 `renderWorldCopies` clobber
    // (:864-897) — on the `maxBounds`/`lngRange` axis.
    //
    // Sequence (verified frame-by-frame in the e2e harness):
    //   1. The state switch re-renders; react-map-gl's layout effect runs FIRST
    //      and `setMaxBounds(newState)` → `transform.lngRange` momentarily holds
    //      the NEW state envelope ("Not a stale-maxBounds clamp" is true at this
    //      instant — react-map-gl DID apply the new bounds).
    //   2. But the still-in-flight `easeTo` from before the switch re-`apply`s a
    //      CLONE of its start transform (with the OLD state's `lngRange`) on its
    //      next animation frame — clobbering `lngRange` back to the OLD state
    //      BEFORE this passive effect even runs (passive effects fire after a
    //      paint, i.e. after ≥1 animation frame).
    //   3. So by the time this effect calls `fitBounds`, `transform.lngRange` is
    //      the OLD (e.g. western) state's. `fitBounds` → Mercator `handleEaseTo`
    //      captures its `from`-basis against that clobbered transform; with no
    //      `k===1` target snap (unlike flyTo) and `renderWorldCopies=false` (no
    //      world-copy wrap), the camera lands edge-pinned at the OLD state's
    //      eastern `lngRange` edge — the wrong, western-ish longitude.
    //
    // `cameraForBounds` returns the geometry-correct target even mid-flight (it
    // derives from absolute world geometry, independent of the live transform).
    // So we read the target up front and, on the settle `moveend` (after the
    // clobbering animation has fully ended so the clone no longer re-applies),
    // RE-ASSERT the new state's `maxBounds` (undoing the clone clobber of
    // `lngRange`) and `jumpTo` the target. This mirrors #762/#765's
    // imperative-reassert-on-moveend exactly, one axis over.
    //
    // Why the maxBounds reassert is REQUIRED (not just jumpTo): the clobbered
    // `lngRange` would clamp the corrective `jumpTo` straight back to the OLD
    // state's edge — verified live. The reassert is the ONE sanctioned imperative
    // `setMaxBounds` site (an idempotent reassert of the same declarative
    // `clampBounds`), NOT the reactive clamp mechanism: `maxBounds` remains a
    // reactive `<Map>` prop (finding-(a), invariant documented at the clampBounds
    // block ~`:580`). It runs only behind this `moveend`, never during reactive
    // reconciliation; the finding-(a) guard fires no `moveend`, so it stays green.
    // NOT a bare `map.stop()` in the effect: `easeTo` already self-`_stop`s,
    // freezing the western basis — stop alone fixes neither the longitude nor
    // the `lngRange` clobber.
    const target = map.cameraForBounds(activeBounds, {
      padding: FIT_BOUNDS_PADDING,
      maxZoom: 12,
    });
    let corrector: (() => void) | undefined;
    // `fitBounds` first `stop()`s the in-flight `easeTo` — which fires a
    // SYNCHRONOUS cancellation `moveend` (at the frozen western position) DURING
    // the `fitBounds()` call, before fitBounds starts its own animation. We must
    // NOT correct on that cancellation moveend: a `jumpTo` there is immediately
    // clobbered by fitBounds's subsequent animation (verified live). We correct
    // only on fitBounds's OWN settle moveend, which fires asynchronously AFTER
    // `fitBounds()` returns. `fitBoundsDispatched` gates that: a moveend that
    // fires while it is still `false` is the synchronous cancellation (or, under
    // reduced motion, the instant settle that needs no correction) — re-arm and
    // skip.
    let fitBoundsDispatched = false;
    if (target) {
      const EPS = 1e-3; // ≈100 m — far below the 15–41° bug magnitude, above float noise.
      corrector = () => {
        if (!fitBoundsDispatched) {
          // Synchronous cancellation moveend (still inside the fitBounds call) —
          // re-arm for the real settle rather than correcting prematurely.
          if (corrector) map.once('moveend', corrector);
          return;
        }
        const c = map.getCenter();
        if (
          Math.abs(c.lng - target.center.lng) > EPS ||
          Math.abs(c.lat - target.center.lat) > EPS
        ) {
          // Re-assert the new scope's clamp (undo the in-flight clone's
          // `lngRange` clobber) so the corrective jumpTo is not re-clamped back
          // to the old state's edge, THEN land the geometry-correct target.
          map.setMaxBounds(clampBounds);
          map.jumpTo({ center: target.center, zoom: target.zoom });
        }
      };
      // Register the one-shot corrector BEFORE calling fitBounds — ordering is
      // load-bearing: under prefers-reduced-motion `fitBounds` runs `duration: 0`
      // and fires `moveend` SYNCHRONOUSLY inside the call, so the listener must
      // already exist. `map.once` is self-removing, so `jumpTo`'s own `moveend`
      // cannot re-fire the corrector (no loop).
      map.once('moveend', corrector);
    }

    map.fitBounds(activeBounds, {
      // Asymmetric top inset (FIT_BOUNDS_PADDING) clears the floating header +
      // scope-control chrome that stacks over the full-bleed canvas top edge
      // post-#761/S2 — resolves the deferred TODO(#737). top > bottom/left/right.
      padding: FIT_BOUNDS_PADDING,
      maxZoom: 12,
      essential: true,
      duration: prefersReducedMotion ? 0 : 600,
    });
    // fitBounds has returned: any synchronous cancellation moveend it fired
    // (while stopping the in-flight easeTo) is now past. From here, the next
    // moveend is fitBounds's own settle — the corrector may act.
    fitBoundsDispatched = true;

    // Belt-and-suspenders: detach the corrector on cleanup so a re-fired effect
    // (next boundsKey change) cannot leave a stale listener (mirrors :894-896).
    return () => {
      if (corrector) map.off('moveend', corrector);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boundsKey +
    // flyTo?.key are the intentional triggers; `activeBounds` identity derives
    // from boundsKey and re-running on its reference churn is undesirable
    // (prototype documents this exact disable). prefersReducedMotion is mount-
    // stable (useMemo []).
  }, [mapReady, boundsKey, flyTo?.key, prefersReducedMotion]);

  /**
   * Corrective `map.resize()` on the S2 flex→fixed container transition (#737,
   * gap 8 of #761). Before S2 the map was a `flex: 1; min-height: 0` child of a
   * padded `<main>`; S2 hoisted it into `#map-layer` (`position: fixed; inset: 0`)
   * and `.map-surface` became `position: absolute; inset: 0`. That swaps the
   * CONTAINING BLOCK (a reparent/reflow), and maplibre's built-in observer on the
   * inner GL container does not always re-read `_containerDimensions` for the new
   * full-viewport box on the first paint — leaving a one-frame mis-sized canvas
   * (clipped tiles, off-by-padding marker projection). S2 demonstrated the fallout
   * test-side: the coarse-pointer cluster-tap spec saw the marker DOM node
   * re-created ~600ms post-tap (`sameMarkerNode === false`) because the canvas was
   * still settling, and worked around it with an extra idle+rAF wait it deferred
   * to this PR.
   *
   * Fix: a `ResizeObserver` on the `data-testid="map-canvas"` wrapper (the box
   * whose containing block changed). It is the robust form because the box can
   * change AGAIN after the one-time reparent (theme-toggle reflow, the detail
   * rail/sheet opening alongside the fixed map, mobile URL-bar show/hide changing
   * 100vh). The observer is:
   *   - CAMERA-NEUTRAL: it only calls `map.resize()` — never `fitBounds`/`flyTo`/
   *     a refetch — so it cannot schedule a bbox `/api/observations` (the S4
   *     scope-gate invariant, report R1).
   *   - IDEMPOTENT / debounced: coalesced to the next animation frame so a burst
   *     of observer fires (including maplibre's own internal observer churn during
   *     the same reflow) collapses to a single `resize()`; a pending frame is
   *     guarded so we never stack rAFs.
   *   - DISCONNECTED on cleanup (observer + any pending rAF), so a `<Map>` remount
   *     across a scope pick leaks neither.
   * `mapReady`-gated so `getMap()` is live. The first observe-callback fire (which
   * ResizeObserver delivers on `observe()`) doubles as the one-shot post-`mapReady`
   * correction for the initial reparent.
   */
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current?.getMap();
    const wrapper = mapWrapperRef.current;
    if (!map || !wrapper || typeof ResizeObserver === 'undefined') return;

    let frame = 0;
    const observer = new ResizeObserver(() => {
      // Coalesce a burst of box changes (and maplibre's own internal observer
      // churn during the same reflow) into a single rAF-batched resize. Camera-
      // neutral: resize() recomputes the canvas/transform for the new box only.
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        map.resize();
      });
    });
    observer.observe(wrapper);

    return () => {
      observer.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [mapReady]);

  // #762/#765 — `renderWorldCopies` reassertion across an IN-PLACE scope change.
  //
  // The declarative `renderWorldCopies={maskPolygon == null}` prop above is
  // necessary (react-map-gl/maplibre does NOT reset an ABSENT setting to its
  // default — it retains the last value, so the prop must always carry an
  // explicit value), but it is not sufficient on the `state → us` transition.
  // That transition also changes `boundsKey`, which re-fires the camera effect
  // and starts a `fitBounds` animation. maplibre's animation captures a CLONE
  // of the current transform (with the OLD `renderWorldCopies: false`) and
  // re-`apply`s it every animation frame — clobbering the `true` that
  // react-map-gl set declaratively. The net live result was world copies stuck
  // OFF after leaving a state scope for `?scope=us` (PR #765 bot review,
  // reproduced live: `getRenderWorldCopies()` stayed `false`).
  //
  // Reassert imperatively on `maskPolygon` change AND on `moveend` (when the
  // clobbering animation has finished) so the explicit value wins the race.
  // Idempotent: a no-op when the map already matches the desired value.
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    const desired = maskPolygon == null;
    const apply = () => {
      if (map.getRenderWorldCopies() !== desired) {
        map.setRenderWorldCopies(desired);
      }
    };
    apply();
    // Win the race against an in-flight fitBounds/flyTo transform-clone replay.
    map.on('moveend', apply);
    return () => {
      map.off('moveend', apply);
    };
  }, [mapReady, maskPolygon]);

  // ───────────────────────────────────────────────────────────────────────────
  // #763 — artboard FIDELITY: label isolation + clean exterior + float layers.
  //
  // ⚠ RECONCILE-SEQUENCING SPLIT (do NOT collapse this into one effect/handler).
  //
  // `map.setStyle()` (fired by the [data-theme] MutationObserver below) clears
  // and asynchronously reloads ALL layers — dropping both the merged label
  // filters AND the float layers — so everything must be re-applied after each
  // swap. But the two halves have DIFFERENT timing requirements:
  //
  //   (3a) Label-filter isolation re-applies in `style.load`. Basemap symbol
  //        layers exist immediately on style load and `applyLabelIsolation`
  //        needs NO reference to `state-mask-fill`, so it is safe there.
  //
  //   (3b) The float `addLayer` + the `moveLayer` stray-sink re-apply from the
  //        SEPARATE `maskPolygon`-watching effect below — NOT from `style.load`.
  //        react-map-gl re-adds its managed declarative layers (including
  //        `state-mask-fill`) on the NEXT React reconcile, which has NOT
  //        happened yet when `style.load` fires. `moveLayer(x, 'state-mask-fill')`
  //        or an `addLayer(..., 'state-mask-fill')` inside `style.load` therefore
  //        throws `Cannot move layer before non-existing layer`. The effect
  //        below re-fires on the next render (after the reconcile), so the
  //        reference layer exists — and it still GUARDS on
  //        `getLayer('state-mask-fill')` (warn-and-return, never call through).
  //
  // Collapsing (3b) back into the `style.load` handler reintroduces that throw.
  // ───────────────────────────────────────────────────────────────────────────

  // (3a-i) Label isolation re-apply on THEME SWAP. Registered ONCE after
  // `mapReady` as a `style.load` listener (which fires after each
  // MutationObserver `setStyle`); the handler reads the live `maskPolygon` from
  // a ref so it needs no re-registration on prop change. Basemap symbol layers
  // exist immediately on `style.load`, and `applyLabelIsolation` needs no
  // reference to `state-mask-fill`, so this is safe here (unlike the float/sink
  // half — see the sequencing comment above).
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current?.getMap();
    if (!map) return;

    const onStyleLoad = () => {
      const poly = maskPolygonRef.current;
      // Bump the epoch unconditionally so the float/sink effect re-runs after
      // EVERY style reload (it re-adds the floats `setStyle` dropped, once the
      // reconcile has re-added `state-mask-fill`).
      setStyleEpoch((n) => n + 1);
      if (!poly) return; // no state scope → no isolation (us/chooser untouched)
      try {
        // The within test uses the OUTWARD-BUFFERED polygon (so near-border
        // interior labels survive); the #762 mask FILL keeps the EXACT polygon.
        savedFiltersRef.current = applyLabelIsolation(
          map,
          bufferIsolationPolygon(poly),
        );
      } catch {
        /* defensive — style churn after a swap; QA detects un-isolated labels */
      }
    };

    map.on('style.load', onStyleLoad);
    return () => {
      map.off('style.load', onStyleLoad);
    };
    // mapReady-only: the handler reads maskPolygon from a ref, so it must NOT
    // re-register on every prop change (that would leak listeners).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady]);

  // (3a-ii) Label isolation re-apply on MASK CHANGE (initial mount, chooser/us →
  // state, state → state in-place). Distinct from the `style.load` listener:
  // those transitions do NOT swap the style, so no `style.load` fires. On a
  // state → state change the OLD isolation must be restored before the NEW one
  // is captured+applied (else the new `applyLabelIsolation` would capture the
  // already-merged `['all', original, within]` filter as the "original").
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    if (!maskPolygon) return; // us/chooser: teardown effect restores originals
    try {
      if (savedFiltersRef.current) {
        restoreLabelIsolation(map, savedFiltersRef.current);
        savedFiltersRef.current = null;
      }
      savedFiltersRef.current = applyLabelIsolation(
        map,
        bufferIsolationPolygon(maskPolygon),
      );
    } catch {
      /* defensive — style churn; QA detects un-isolated labels */
    }
  }, [mapReady, maskPolygon]);

  // (3b) Float layers + stray-sink — runs from a `maskPolygon`-watching,
  // `mapReady`-gated effect (also keyed on `maskTheme` so the float re-tints on
  // a theme swap). It fires AFTER react-map-gl's reconcile has (re-)added
  // `state-mask-fill`, and `addFloatLayers` is idempotent (removes any prior
  // instance before re-adding), so re-running it on a theme change re-tints
  // cleanly without thrashing the LABEL filters (which are owned by the (3a)
  // `style.load` handler and the separate teardown effect below).
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    if (!maskPolygon) return;

    // Guard: state-mask-fill MUST exist before any moveLayer/insert anchored to
    // it. If react-map-gl has not re-added it yet, warn and return — the effect
    // re-fires on the next render once the reconcile lands it. Calling through
    // is the exact `Cannot move layer before non-existing layer` throw the
    // 3a/3b split exists to avoid.
    if (map.getLayer(MASK_LAYER_ID) == null) {
      console.warn(
        '[artboard] state-mask-fill not yet reconciled; deferring float/sink',
      );
      return;
    }
    try {
      applyArtboardFidelity(map, maskPolygon, maskTheme);
    } catch {
      /* defensive — layer/style churn after a swap */
    }
    // `styleEpoch` re-runs this AFTER a theme `setStyle`+`style.load` so the
    // floats `setStyle` dropped are re-added once `state-mask-fill` is back.
  }, [mapReady, maskPolygon, maskTheme, styleEpoch]);

  // (3b-teardown) Restore label filters + remove float layers when the mask
  // unmounts (scope → us/chooser) OR the component unmounts. Keyed ONLY on
  // `maskPolygon` (NOT `maskTheme`) so a theme swap — which re-applies isolation
  // via (3a) `style.load` against the NEW style — does not trigger a stale
  // restore against filters the `setStyle` already cleared. Guarded against a
  // disposed map / missing layers (the helpers wrap their MapLibre calls).
  useEffect(() => {
    if (!mapReady) return;
    if (!maskPolygon) return; // only arm teardown while a mask is active
    return () => {
      const liveMap = mapRef.current?.getMap();
      if (!liveMap) return;
      try {
        if (savedFiltersRef.current) {
          restoreLabelIsolation(liveMap, savedFiltersRef.current);
          savedFiltersRef.current = null;
        }
        removeFloatLayers(liveMap);
      } catch {
        /* defensive — map gone after a swap or unmount */
      }
    };
  }, [mapReady, maskPolygon]);

  // Unmount cleanup for the `window.__birdMap` test hook (#291). The hook is
  // assigned in `handleLoad` (which fires once per mount); without an unmount
  // cleanup, a remount (e.g. switching from the detail view to the map view
  // and back) would leave a stale handle to the prior MapCanvas's maplibre instance on
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
   * #872 — synchronous DOM-marker invalidation on SCOPE change. The
   * adaptive-grid reconciler effect (below) deliberately OMITS `observations`
   * from its dep array — adding the raw array would reopen the
   * EMPTY_BUCKETS/EMPTY_DICT infinite-re-register loop (a fresh `[]` per render
   * thrashes the effect). But that omission means the async DOM markers
   * (`groups`/`silhouetteOffsets`, committed on the next map `idle`) LAG the
   * synchronously-updated GeoJSON `<Source>` on a state→state transition,
   * leaving the PRIOR scope's markers mounted outside the new outline until the
   * next reconcile pass lands (~0.3–1.2s later).
   *
   * Fix: detect a `boundsKey` change during render and clear the marker slices
   * immediately — the same "store-previous-prop, compare-in-render" pattern the
   * `silhouettesVersion` ref above uses (React supports calling setState during
   * render to adjust state in response to a changed prop; it discards the
   * in-progress output and re-renders synchronously, so the stale markers never
   * paint). `boundsKey` is the canonical scope-change signal — it changes on
   * every national→state / state→state transition (see the camera-effect note
   * at the `renderWorldCopies` reassertion below) and is STABLE under
   * same-scope pan/zoom.
   *
   * Keying on `boundsKey` rather than on `observations` identity is load-bearing
   * for the FLICKER guard: at z≥6 (per-obs mode) a same-scope pan/zoom refetches
   * and `use-bird-data` hands us a FRESH `observations` array each time. Gating
   * on that identity fired the clear on EVERY such pan, blanking the
   * adaptive-grid markers until the next idle (~0.3–1.2s flicker on the most
   * common interaction). `boundsKey` confines the clear to real scope changes.
   * Skips the initial mount (groups already empty) and any same-scope render, so
   * there is no loop and no churn under pan. The reconciler's next `idle`
   * repopulates from the new scope's clusters; the `cacheGeneration` race-guard
   * is untouched.
   */
  const prevBoundsKeyRef = useRef<typeof boundsKey>(boundsKey);
  if (prevBoundsKeyRef.current !== boundsKey) {
    prevBoundsKeyRef.current = boundsKey;
    setGroups([]);
    setSilhouetteOffsets(new Map());
    prevHiddenSubIdsRef.current = new Set();
  }

  /**
   * Pure per-family lookup used by `buildAdaptiveTiles` (spec §5.3 Concern
   * C, point 3). Resolved once per reconcile from the silhouettes prop —
   * the tile-builder MUST NOT read from a ref, so we thread this
   * explicitly. An empty map signals "catalogue not loaded yet" and
   * produces all-`pending` tiles.
   */
  const silhouettesById = useMemo<SilhouettesById>(() => {
    const map = new Map<
      string,
      { svgData: string | null; color: string; colorDark: string; commonName: string | null }
    >();
    for (const s of silhouettes) {
      map.set(s.familyCode.toLowerCase(), {
        svgData: s.svgData,
        color: s.color,
        colorDark: s.colorDark,
        // #920: carry the curated colloquial name so the tile builders can
        // resolve each tile's `displayName` and the popovers show
        // "Tyrant Flycatchers" instead of the scientific "Tyrannidae".
        commonName: s.commonName,
      });
    }
    return map;
  }, [silhouettes]);

  /**
   * #920: resolved colloquial display name per family for the standalone
   * `<ClusterListPopover>` opened from a `<ClusterPill>` outer-tap (the
   * `clusterList` state path). That path's `families` come from
   * `aggregateClusterFamilies` / `mergeLeafBuckets` and carry no name, so we
   * resolve each here from the silhouette catalogue — the same "resolve once
   * from the catalogue" rule the tile builders follow. The AdaptiveGridMarker's
   * OWN internal ClusterListPopover gets its names from the tiles' `displayName`
   * and does not use this map.
   */
  const clusterListFamilyNames = useMemo<ReadonlyMap<string, string>>(() => {
    const map = new Map<string, string>();
    if (!clusterList) return map;
    for (const fam of clusterList.families) {
      map.set(
        fam.familyCode,
        resolveFamilyName(fam.familyCode, {
          commonName: silhouettesById.get(fam.familyCode)?.commonName,
        }),
      );
    }
    return map;
  }, [clusterList, silhouettesById]);

  // Issue #351: ref to the current onViewportChange prop. handleLoad has
  // [] deps (registers listeners exactly once per maplibre instance), so
  // we read the live callback through the ref instead of capturing the
  // prop at registration time. App.tsx may pass a fresh inline closure
  // on every render; without the ref, only the very first one would ever
  // fire.
  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;

  // #864: the `unclustered-point` click handler is registered once in handleLoad
  // ([] deps), so — like onViewportChange above — it reads `aggregated` and the
  // species `dictionary` through refs to see the live values when a lone bucket
  // silhouette is clicked, not the values captured at map-load time.
  const aggregatedRef = useRef(aggregated);
  aggregatedRef.current = aggregated;
  const dictionaryRef = useRef(dictionary);
  dictionaryRef.current = dictionary;

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

  // In aggregated mode (#859) the cluster source is fed ONE feature per bucket
  // carrying real count/speciesCount + serialized families; otherwise it's the
  // per-observation FeatureCollection. Both share the `'observations'` source id
  // so every getSource('observations') / clustering call below is path-agnostic.
  const geojson = useMemo(
    () =>
      aggregated
        ? bucketsToGeoJson(buckets, silhouettes)
        : observationsToGeoJson(observations, silhouettes),
    [aggregated, buckets, observations, silhouettes],
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
   * Issue #718: open the ObservationPopover at the screen position
   * derived from an explicit lngLat. Use this directly when the visual
   * click position differs from the obs's survey coordinate — most
   * notably at the displaced-silhouette site (silhouetteOffsets.entries()
   * render below), where `entry.longitude/entry.latitude` is the visible
   * shifted position. Using obs.lng/obs.lat there would project from the
   * canvas-hidden original survey point and defeat the fix.
   */
  const openPopoverAt = useCallback(
    (obs: Observation, lngLat: [number, number]) => {
      const m = mapRef.current?.getMap();
      if (!m) {
        setSelectedObs(null);
        return;
      }
      const { x, y } = m.project(lngLat);
      setSelectedObs({ obs, pos: { x, y } });
    },
    [],
  );

  /**
   * Issue #718: convenience wrapper for sites where the obs coordinate
   * IS the visual position (hit-layer + cluster-leaf paths). Do NOT use
   * this at the displaced-silhouette site — the displaced visual position
   * is not the obs's survey lng/lat.
   */
  const openPopover = useCallback(
    (obs: Observation) => openPopoverAt(obs, [obs.lng, obs.lat]),
    [openPopoverAt],
  );

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
        if (obs) openPopover(obs);
        return;
      }

      // #864: no subId ⇒ this is an aggregated BUCKET painted unclustered (a
      // lone bucket past clusterRadius / clusterMaxZoom that #860's
      // clusterMinPoints=1 didn't fold into a degenerate cluster). It carries
      // its real families/species in `familiesJson` — open the SAME real-species
      // popover the cluster path opens (mergeLeafBuckets on this one bucket →
      // ClusterListPopover), so a click resolves names + working links instead
      // of no-op'ing on a dead silhouette. Gated on aggregated mode + presence
      // of familiesJson so the per-observation path is untouched.
      const familiesJson = feature.properties?.familiesJson as
        | string
        | undefined;
      if (!aggregatedRef.current || typeof familiesJson !== 'string') return;

      // One-bucket "merge": mergeLeafBuckets reads `properties.familiesJson` off
      // each leaf, so the clicked feature IS a valid single-element leaf array.
      // Reuses the exact bucket→popover machinery the cluster path uses (#859).
      const merged = mergeLeafBuckets(
        [feature as unknown as { properties?: { familiesJson?: unknown } }],
        dictionaryRef.current,
      );
      if (merged.families.length === 0) return;

      const totalCount =
        typeof feature.properties?.count === 'number'
          ? (feature.properties.count as number)
          : merged.families.reduce((s, f) => s + f.count, 0);

      const geom = feature.geometry;
      const center: [number, number] | undefined =
        geom.type === 'Point'
          ? (geom.coordinates as [number, number])
          : undefined;

      setClusterList({
        families: merged.families,
        speciesByFamily: merged.speciesByFamily,
        overflowByFamily: merged.overflowByFamily,
        totalCount,
        uniqueFamilies: merged.families.length,
        // No DOM anchor exists for a bare canvas click; the map canvas is a
        // stable, focusable focus-return target (ClusterListPopover only uses
        // anchorEl for .focus() on dismiss — positioning is sheet-style CSS).
        anchorEl: map.getCanvas(),
        ...(center ? { drillCenter: center } : {}),
      });
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
      cb(map.getBounds(), Math.floor(map.getZoom()));
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
      // #859: a coarse dictionary "generation" folded into the leaf-cache key so
      // a cluster resolved with a cold (empty) dictionary re-resolves once the
      // names load. `0` while empty, `1` once populated — enough granularity
      // because the dictionary is loaded once and never shrinks.
      const dictGen = dictionary.size > 0 ? 1 : 0;
      // Cluster-shape tier (feeds pickGridShape below). Reads the GL container's
      // measured width against the 768px breakpoint. Post-#761/S2 the map fills
      // the full viewport (`#map-layer` is `position: fixed; inset: 0`), so this
      // now reads the TRUE rendered map width — the old `−32px` (`<main>`'s
      // 2×16px padding) gutter is gone. The threshold is `< 768`, so at EXACTLY
      // 768px the tier is DESKTOP (`768 ≥ 768` → not mobile); a 768px-wide
      // viewport that previously read 736px (→ mobile) is now desktop. This is
      // the intended full-bleed behavior (#773 AC) — the read reflects the real
      // canvas width the user sees. Backed by the 767→mobile / 768→desktop
      // boundary unit test in MapCanvas.test.tsx.
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
          const rawPointCount = feature.properties?.['point_count'] as number;
          // #859: in aggregated mode the marker total is the SUMMED real
          // observation count across the cluster's buckets (`sumCount` cluster
          // property), NOT supercluster's `point_count` (which counts buckets).
          // Per-observation mode keeps `point_count` (1 feature = 1 observation).
          const sumCount = feature.properties?.['sumCount'];
          const pointCount =
            aggregated && typeof sumCount === 'number' ? sumCount : rawPointCount;
          const geom = feature.geometry as
            | { type: 'Point'; coordinates: [number, number] }
            | { type: string };
          if (geom.type !== 'Point') return;
          const [longitude, latitude] = (
            geom as { coordinates: [number, number] }
          ).coordinates;

          // Concern B cache key — zoom-prefixed per spec §5.3 to prevent
          // collisions across zoom levels (supercluster's integer
          // cluster_id values are recycled across zoom strata). The mode +
          // dictionary-size suffix evicts the cache when the data path flips or
          // the dictionary first resolves (so cold-dictionary tiles re-resolve).
          const key = `${aggregated ? 'agg' : 'obs'}:${dictGen}:${floorZoom}:${clusterId}:${pointCount}`;
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
              // #859: in aggregated mode each leaf is a whole BUCKET carrying
              // many families (serialized in `familiesJson`). Merge them
              // client-side ONCE into exact per-family aggregates + resolved
              // species, then build tiles from those — NOT the per-leaf
              // one-observation recount the per-observation path uses.
              const merged = aggregated
                ? mergeLeafBuckets(
                    leaves as unknown as Array<{ properties?: { familiesJson?: unknown } }>,
                    dictionary,
                  )
                : null;
              const aggregates = merged ? merged.families : aggregateClusterFamilies(leaves);
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
              const tiles = merged
                ? tilesFromAggregates(
                    aggregates,
                    merged.speciesByFamily,
                    silhouettesById,
                    shape,
                    // #859: thread each family's true distinct-species count so
                    // the per-family <CellPopover> "+N more" mirrors the
                    // cluster-list path's active drill-in.
                    merged.speciesCountByFamily,
                  )
                : buildAdaptiveTiles(leaves, silhouettesById, shape);
              // F7 option (a): only mark the marker isNotable when the
              // cluster is strictly 1×1 with a single notable observation.
              // Per-tile isNotable is the future-extension path (option b).
              // Aggregated buckets carry no per-observation `isNotable`, so this
              // stays false there (the notable ring is a per-observation signal).
              const isNotablePoint =
                !aggregated &&
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
              // #875: after `setData` re-indexes the supercluster, the idle-tick
              // reconciler can race the worker re-cluster and pass cluster_ids
              // from the PRIOR generation into getClusterLeaves, which rejects
              // with "No cluster with the specified id: NNNN" (trailing period +
              // appended id — so `includes`, NOT `===`). That is an EXPECTED,
              // self-healing post-reindex rejection (the next idle resolves the
              // current ids), so swallow it — in BOTH render modes. QA confirmed
              // the flood fires at z<6 aggregated (`agg:…`) AND z≥6
              // per-observation (`obs:…`); the message is the benign
              // discriminator, so we key off it ALONE — no render-mode gate. Any
              // OTHER rejection message still warns, so a genuinely broken cluster
              // surfaces. Eviction above is unconditional either way.
              const isStaleClusterId =
                String(err?.message).includes('No cluster with the specified id');
              if (!isStaleClusterId && !warnedRejections.has(key)) {
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

      // #901 re-tile empty-commit guard. On a z≥6 same-scope pan the refetch's
      // `setData` swaps the GeoJSON source and the GL worker re-tiles
      // asynchronously. A STALE prior-settle `idle` can land after the swap but
      // before the worker emits the new `sourcedata`, so `queryRenderedFeatures`
      // returns an EMPTY set → `inputs === []` → committing here would
      // `setGroups([])` and blank the markers ~360ms until the next idle
      // recovers. When `inputs` is empty BECAUSE the source is still re-tiling
      // (`!isSourceLoaded('observations')`), SKIP this commit and keep the prior
      // markers — the next idle (after the re-tile completes) reconciles. This
      // mirrors the existing "next idle tick will reconcile" precedents (the
      // getClusterLeaves catch, the spritesReady/getLayer guard).
      //
      // The discriminator is the SOURCE-LOADED signal, NOT `observations.length`:
      // `observations` is the whole bbox-debounced/quantized fetch fed wholesale
      // into the source (~:1410), covering a region LARGER than the exact
      // viewport — so `observations.length > 0 && inputs === []` is ALSO true for
      // a settled source panned to a bird-free corner, which MUST still clear.
      // Only `isSourceLoaded` disambiguates "re-tiling" from "settled-but-empty".
      // Bounded strictly to "source still loading": a settled-but-empty source
      // (genuine empty viewport, or a source that errored and finished) reports
      // loaded → falls through and commits `[]` as today, so markers never strand.
      if (
        inputs.length === 0 &&
        typeof map.isSourceLoaded === 'function' &&
        !map.isSourceLoaded('observations')
      ) {
        return;
      }

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
      // Clear orphaned `hidden` feature-state so silhouettes don't stay
      // invisible after the effect re-runs (e.g. catalogue swap, unmount).
      for (const subId of prevHiddenSubIdsRef.current) {
        try {
          map.removeFeatureState({ source: 'observations', id: subId }, 'hidden');
        } catch {
          // map.getSource('observations') may be gone if the map was disposed.
        }
      }
      prevHiddenSubIdsRef.current = new Set();
    };
    // Re-register when the silhouettes catalogue OR the resolved
    // silhouettesById map changes, OR when the map first becomes ready.
    // silhouettesVersion is included as a dep to surface monotonic
    // catalogue replacements that don't change array identity (defensive —
    // useMemo already keys silhouettesById on [silhouettes], so this is
    // a belt-and-braces guard the spec §5.3 commit-race tests assert).
    // #859: `aggregated`, `buckets`, and `dictionary` are deps too — flipping
    // the data path (z<6 ↔ z>=6), swapping the bucket set, or the dictionary
    // first resolving must re-run the reconciler so markers reflect real data.
  }, [silhouettes, silhouettesById, silhouettesVersion, mapReady, aggregated, buckets, dictionary]);

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
          // #760/#762: re-paint the state-artboard mask fill in lockstep with
          // the basemap swap. The mask <Layer> reads `maskTheme`; react-map-gl
          // diffs `paint` so this re-tints the gray with no remount.
          setMaskTheme(next);
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
  /**
   * Mount `<ClusterListPopover>` from a DeconflictGroup whose pill click
   * couldn't escalate the camera (already at max zoom or NaN expansion).
   * Mirrors the coarse-pointer `AdaptiveGridMarker` outer-tap behavior so
   * the user always has a way to drill into a stuck cluster by species
   * (#717). `anchorEl` comes from the click's `e.currentTarget` and is the
   * focus-return target on dismiss.
   */
  const openClusterListFromGroup = useCallback(
    async (group: DeconflictGroup, anchorEl: HTMLElement) => {
      const map = mapRef.current?.getMap();
      if (!map) return;
      const source = map.getSource('observations') as
        | {
            getClusterLeaves?: (
              id: number,
              limit: number,
              offset: number,
            ) => Promise<unknown[]>;
          }
        | undefined;
      if (!source?.getClusterLeaves) return;

      // Silhouettes have negative pseudo-IDs and are not registered in
      // supercluster — filter them out before requesting leaves.
      const realIds = group.memberIds.filter((id) => id > 0);
      if (realIds.length === 0) return;

      try {
        const leafBatches = await Promise.all(
          realIds.map(
            (id) =>
              source.getClusterLeaves!(id, 64, 0) as Promise<ClusterLeafFeature[]>,
          ),
        );
        const leaves = leafBatches.flat();
        if (leaves.length === 0) return;
        if (aggregated) {
          // #859: leaves are buckets — merge their real families/species.
          const merged = mergeLeafBuckets(
            leaves as unknown as Array<{ properties?: { familiesJson?: unknown } }>,
            dictionary,
          );
          setClusterList({
            group,
            families: merged.families,
            speciesByFamily: merged.speciesByFamily,
            overflowByFamily: merged.overflowByFamily,
            totalCount: group.anchor.point_count,
            uniqueFamilies: merged.families.length,
            anchorEl,
            ...(group.anchor.longitude !== undefined && group.anchor.latitude !== undefined
              ? { drillCenter: [group.anchor.longitude, group.anchor.latitude] as [number, number] }
              : {}),
          });
          return;
        }
        const families = aggregateClusterFamilies(leaves);
        const speciesByFamily = aggregateClusterSpecies(leaves);
        setClusterList({
          group,
          families,
          speciesByFamily,
          totalCount: group.anchor.point_count,
          uniqueFamilies: group.anchor.uniqueFamilies,
          anchorEl,
        });
      } catch {
        // getClusterLeaves can reject for recycled cluster_ids — match the
        // err-swallow pattern from the easeTo branch below. Silent: the
        // alternative is a console-warn spam on every fast pan.
      }
    },
    [aggregated, dictionary],
  );

  const handleGroupClick = useCallback(
    async (group: DeconflictGroup, anchorEl?: HTMLElement | null) => {
      const { anchor, memberIds } = group;

      // #859: in aggregated (low-zoom) mode there are NO per-observation rows —
      // every marker is one or more buckets. A click must show the bucket's
      // REAL species (route to the merged cluster-list popover), never the
      // old synthetic single-observation path. We still try to escalate the
      // camera first (so a click zooms in where possible); the terminal
      // fallback opens the species list with real data + "+N more" drill-in.
      if (aggregated) {
        const map = mapRef.current?.getMap();
        if (!map) return;
        const source = map.getSource('observations');
        const clusterMemberIds = memberIds.filter((id) => id > 0);
        if (
          clusterMemberIds.length > 0 &&
          source &&
          'getClusterExpansionZoom' in source
        ) {
          const src = source as { getClusterExpansionZoom: (id: number) => Promise<number> };
          try {
            const zooms = await Promise.all(
              clusterMemberIds.map((id) => src.getClusterExpansionZoom(id)),
            );
            const targetZoom = Math.min(Math.max(...zooms), CLUSTER_MAX_ZOOM);
            const currentZoom = map.getZoom();
            const shouldEase =
              Number.isFinite(targetZoom) &&
              targetZoom > currentZoom &&
              anchor.longitude !== undefined &&
              anchor.latitude !== undefined;
            if (shouldEase) {
              map.easeTo({
                center: [anchor.longitude!, anchor.latitude!],
                zoom: targetZoom,
                ...(prefersReducedMotion ? { duration: 0 } : {}),
              });
              return;
            }
          } catch {
            // recycled cluster_id — fall through to the species list.
          }
        }
        if (anchorEl) await openClusterListFromGroup(group, anchorEl);
        return;
      }

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
        if (obs) openPopover(obs);
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
        // Click-time-lazy: async expansion-zoom aggregation over cluster
        // members only. Silhouette pseudo-IDs are negative by construction
        // (−hashSubId(subId)) and are not registered in supercluster's
        // index — passing them to getClusterExpansionZoom rejects, causing
        // the Promise.all to reject and the click to silently no-op.
        // Bot review #554: filter to positive IDs (real cluster IDs) only.
        const clusterMemberIds = memberIds.filter((id) => id > 0);

        // Silhouette-only group: anchor is a silhouette, no cluster IDs
        // remain. Route to single-leaf path (open obs popover).
        if (clusterMemberIds.length === 0) {
          const EPS = 1e-6;
          const obs = observations.find(
            (o) =>
              anchor.longitude !== undefined &&
              anchor.latitude !== undefined &&
              Math.abs(o.lng - anchor.longitude) < EPS &&
              Math.abs(o.lat - anchor.latitude) < EPS,
          );
          if (obs) openPopover(obs);
          return;
        }

        // Max — not min — so the camera always reaches the zoom where every
        // member separates. Capped at CLUSTER_MAX_ZOOM (22) for parity with
        // the prior pill-click behavior.
        const zooms = await Promise.all(
          clusterMemberIds.map((id) => src.getClusterExpansionZoom(id)),
        );
        const targetZoom = Math.min(Math.max(...zooms), CLUSTER_MAX_ZOOM);
        const currentZoom = map.getZoom();
        // `Number.isFinite` rejects NaN (library-error guard, #717): if any
        // member's expansion zoom resolved to NaN, Math.max(NaN) === NaN,
        // and `NaN > x` is false, which would otherwise silently no-op. The
        // explicit isFinite check routes those clicks through the else
        // branch below so the user gets the species list.
        const shouldEase =
          Number.isFinite(targetZoom) &&
          targetZoom > currentZoom &&
          anchor.longitude !== undefined &&
          anchor.latitude !== undefined;
        if (shouldEase) {
          map.easeTo({
            center: [anchor.longitude!, anchor.latitude!],
            zoom: targetZoom,
            ...(prefersReducedMotion ? { duration: 0 } : {}),
          });
        } else if (anchorEl) {
          // Camera already at the zoom where this cluster bottoms out
          // (targetZoom <= currentZoom) — or supercluster returned NaN.
          // Open `<ClusterListPopover>` so the user can still drill in by
          // species. Mirrors the coarse-pointer `AdaptiveGridMarker` outer-
          // tap path; the new mount lives at the bottom of this component.
          await openClusterListFromGroup(group, anchorEl);
        }
      } catch {
        // getClusterExpansionZoom may reject for recycled cluster_ids
        // (the camera moved fast enough that the source rebuilt). Match
        // the prior err-swallow pattern.
      }
    },
    [aggregated, observations, prefersReducedMotion, openClusterListFromGroup],
  );

  const handleClosePopover = useCallback(() => setSelectedObs(null), []);

  /**
   * Issue #718: close the popover when the map starts moving (pan / zoom
   * / fly). Matches the dismiss-on-background-interaction pattern users
   * expect from every popover on the web. Cheaper than re-projecting on
   * every move event and avoids the popover drifting away from its
   * trigger as the map slides.
   */
  useEffect(() => {
    if (!selectedObs) return;
    const m = mapRef.current?.getMap();
    if (!m) return;
    const close = () => setSelectedObs(null);
    m.on('movestart', close);
    return () => {
      m.off('movestart', close);
    };
  }, [selectedObs]);

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

  /**
   * #859: "+N more" drill-in. Eases the camera into the clicked cell so the
   * per-family top-8 cap no longer applies — the read-api stops aggregating at
   * zoom 6, so we ease to the cell center at `DRILL_IN_ZOOM` (one past the
   * aggregation boundary), which re-fetches real per-observation rows there.
   * Closes the cluster-list popover after escalating (its data is now stale).
   */
  const handleDrillInToCenter = useCallback(
    (center: [number, number] | undefined) => {
      setClusterList(null);
      const map = mapRef.current?.getMap();
      if (!map || !center) return;
      const DRILL_IN_ZOOM = 6; // aggregation threshold — z>=6 returns real rows
      const targetZoom = Math.max(map.getZoom() + 1, DRILL_IN_ZOOM);
      map.easeTo({
        center,
        zoom: targetZoom,
        ...(prefersReducedMotion ? { duration: 0 } : {}),
      });
    },
    [prefersReducedMotion],
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
      // #921: resolve the colloquial family name UPSTREAM, where the silhouette
      // catalogue (`silhouettesById`) is in scope. The leaf `MapMarkerHitLayer`
      // gets no catalogue, so without this it fell back to the RAW lowercase
      // `familyCode` in the screen-reader aria-label (`…, tyrannidae, …`). The
      // resolver chain stays `name ?? commonName ?? prettyFamily`; `name`
      // (AggregatedFamily.name) has no per-observation analogue, so only the
      // silhouette `commonName` participates here.
      const familyName = o.familyCode
        ? resolveFamilyName(o.familyCode, {
            commonName: silhouettesById.get(o.familyCode.toLowerCase())?.commonName,
          })
        : undefined;
      return {
        subId: o.subId,
        comName: o.comName,
        familyCode: o.familyCode,
        familyName,
        locName: o.locName,
        obsDt: o.obsDt,
        isNotable: o.isNotable,
        lngLat,
      };
    });
  }, [observations, mapZoom, silhouetteOffsets, silhouettesById]);

  const handleHitSelect = useCallback(
    (subId: string) => {
      const obs = obsLookupRef.current[subId];
      if (obs) openPopover(obs);
    },
    [openPopover],
  );

  const map = mapReady ? mapRef.current?.getMap() ?? null : null;

  return (
    <div ref={mapWrapperRef} data-testid="map-canvas" style={{ width: '100%', height: '100%', position: 'relative' }}>
      <MapView
        ref={mapRef}
        initialViewState={initialViewStateRef.current}
        minZoom={MIN_ZOOM}
        // Reactive scope clamp (#736 finding (a) + #760/#762 artboard):
        // `clampBounds` is the state envelope PADDED by `clampPad` (state scope)
        // so the user can zoom out onto the gray field, else the raw scope
        // envelope / `CONUS_BOUNDS`. react-map-gl re-applies a changed
        // `maxBounds` with no remount — never imperative.
        maxBounds={clampBounds}
        // #760/#762: disable world copies ONLY when a mask is active, so the
        // world ring does not repeat horizontally on a wide viewport zoomed all
        // the way out (preserving the artboard illusion). `state→us` is an
        // in-place prop update (no remount). This MUST be an explicit prop on
        // both branches (not a spread-conditional): react-map-gl/maplibre does
        // NOT reset `renderWorldCopies` to its default when the prop is absent —
        // it retains the last applied value. A spread that REMOVES the prop on
        // `state→us` would therefore leave world copies stuck off for `?scope=us`.
        // `maskPolygon == null` → world copies ON (us scope); a mask → OFF
        // (state/ZIP artboard). The rerender unit assertion pins this so the
        // invariant survives #761's always-mounted lifecycle without a remount.
        renderWorldCopies={maskPolygon == null}
        style={{ width: '100%', height: '100%' }}
        mapStyle={
          typeof document !== 'undefined' &&
          document.documentElement.getAttribute('data-theme') === 'dark'
            ? BASEMAP_DARK
            : BASEMAP_LIGHT
        }
        onLoad={handleLoad}
        // #854: swallow benign transient map errors (AbortErrors from tile
        // fetches cancelled mid-camera-move; OpenFreeMap CDN hiccups keyed on
        // the basemap source) and re-log everything else. Without an `onError`
        // prop, react-map-gl's `_onEvent` falls back to `console.error(e.error)`
        // for every maplibre `error` event — dirtying the console during a
        // scope `fitBounds` fly. Passing this handler diverts that fallback, so
        // `handleMapError` re-surfaces genuine errors itself. See the handler's
        // doc comment + isBenignMapError for the narrow swallow predicate.
        onError={handleMapError}
        attributionControl={false}
        // Fix 3b (PR #582 bot review): preserve the WebGL backbuffer when running
        // e2e tests so `readCanvasPixel` in basemap-dark-flip.spec.ts can sample
        // rendered pixels via a 2D-canvas drawImage copy. Without this flag MapLibre
        // 5.x defaults to `preserveDrawingBuffer: false`, which clears the backbuffer
        // between frames and causes pixel reads to return [0,0,0,0].
        // The flag is opt-in via VITE_E2E_PRESERVE_BUFFER so the slight GPU
        // performance cost only applies during e2e runs — never in production.
        {...(import.meta.env.VITE_E2E_PRESERVE_BUFFER === 'true'
          ? { canvasContextAttributes: { preserveDrawingBuffer: true } }
          : {})}
      >
        {/*
          Attribution consolidated (#830): the bottom-right MapLibre
          AttributionControl bar was removed. `attributionControl={false}` (above)
          keeps MapLibre's own auto-attribution suppressed, so no control renders
          over the map. License compliance now lives in two places — the
          always-visible eBird source link in the identity-card freshness line
          (AppHeader, #830 item B) and the full credits (OSM / OpenMapTiles /
          OpenFreeMap / eBird / PhyloPic / photos) in the top-right ⓘ
          AttributionModal. The bottom-right corner is intentionally empty
          (reserved for future zoom/locate). The OSMF Attribution Guidelines
          explicitly sanction collapsing attribution behind a labeled ⓘ button.
        */}
        {/*
          State-artboard inverse mask (#760/#762). A single fill of the world
          ring with the selected state punched out as a hole — paints flat opaque
          theme-aware gray EVERYWHERE except the state. Rendered BEFORE the
          observations <Source> so it sits above the basemap (part of the
          mapStyle, painted first) and below every cluster/observation layer — so
          birds still render inside the state on top of the basemap. Mounts only
          when `maskPolygon` is set (state/ZIP scope); `?scope=us`, the chooser,
          and the asset-loading window pass null → no <Source> (the empty-source
          guard).
        */}
        {maskPolygon && (
          <Source
            id="state-mask"
            type="geojson"
            data={buildMaskFeature(maskPolygon)}
          >
            <Layer
              id="state-mask-fill"
              type="fill"
              paint={{
                'fill-color':
                  maskTheme === 'dark' ? MASK_FILL_DARK : MASK_FILL_LIGHT,
                'fill-opacity': 1,
              }}
            />
          </Source>
        )}
        <Source
          id="observations"
          type="geojson"
          data={geojson}
          cluster
          clusterMaxZoom={CLUSTER_MAX_ZOOM}
          clusterRadius={CLUSTER_RADIUS}
          // #860: in aggregated mode (z < 6) every feature is a BUCKET carrying
          // real per-cell species (#859). maplibre's default clusterMinPoints (2)
          // emits a bucket with no neighbour within `clusterRadius` (50px) as an
          // UNCLUSTERED point — no cluster_id / point_count. Bucket features carry
          // `count`/`speciesCount`/`familiesJson` but NEVER a `subId`, so every
          // interaction path keys on `subId` (the reconciler's clustered + the
          // unclustered-silhouette input passes, and the canvas unclustered-point
          // click handler) DROPS that lone bucket — it still canvas-paints a
          // dominant-family silhouette, so the user gets a marker that does
          // nothing on click. That is the "dead cell at low zoom" #859 set out to
          // kill, reintroduced via a different mechanism (reachable at national
          // zoom in sparse states — MT/WY/NV). Forcing clusterMinPoints=1 makes
          // EVERY bucket a (degenerate) 1-point cluster, so even a lone one flows
          // through the existing clustered/reconciler + bucket-popover path
          // (getClusterLeaves → mergeLeafBuckets → grid/pill → real-species
          // popover). Gated on `aggregated`: per-observation mode keeps maplibre's
          // default (2), so real Observation rows — which legitimately use `subId`
          // + the unclustered silhouette layer — are completely unchanged.
          clusterMinPoints={aggregated ? 1 : 2}
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
          // (Aggregated bucket features carry no subId — promoteId is a no-op
          // there; the bucket path doesn't use feature-state displacement.)
          promoteId="subId"
          // #859: sum the REAL observation/species totals across the buckets in
          // a cluster. supercluster's `point_count` counts FEATURES (= buckets),
          // not observations, so the marker/pill reads `sumCount` instead in
          // aggregated mode. Harmless in per-observation mode (each obs feature
          // has no `count`/`speciesCount`, so the sums stay 0 and are unread).
          clusterProperties={{
            sumCount: ['+', ['coalesce', ['get', 'count'], 0]],
            sumSpeciesCount: ['+', ['coalesce', ['get', 'speciesCount'], 0]],
          }}
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
                  onClick={(e) => handleGroupClick(g, e.currentTarget)}
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
                detailOpen={detailOpen}
                onClick={() => handleGroupClick(g)}
                {...(onSelectSpecies ? {
                  onSelectSpecies: (code: string) => onSelectSpecies(code),
                } : {})}
                {...(anchor.longitude !== undefined && anchor.latitude !== undefined
                  ? {
                      // #859: the per-family <CellPopover> "+N more" eases the
                      // camera into this marker's cell center — the SAME active
                      // drill-in the cluster-list path uses. The marker decides
                      // (via tile.speciesCount) whether to actually offer it.
                      onDrillIn: () => handleDrillInToCenter([longitude, latitude]),
                    }
                  : {})}
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
                // Issue #718: project the popover from `entry.longitude/
                // entry.latitude` — the DISPLACED visual position — not
                // from `obs.lng/obs.lat`. The obs survey point is hidden
                // beneath the canvas-painted twin; projecting from it
                // would land the popover next to the invisible original
                // instead of the silhouette the user actually clicked,
                // defeating the fix at this site.
                onClick={() => openPopoverAt(obs, [entry.longitude, entry.latitude])}
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
        observation={selectedObs?.obs ?? null}
        position={selectedObs?.pos ?? null}
        onClose={handleClosePopover}
        {...(onSelectSpecies ? { onSelectSpecies: handlePopoverSelectSpecies } : {})}
      />
      {/* `<ClusterListPopover>` mount point for `<ClusterPill>` clicks that
          can't escalate the camera (#717). The coarse-pointer
          `<AdaptiveGridMarker>` outer-tap path opens its OWN internal
          ClusterListPopover instance and is unaffected — this mount only
          fires when `handleGroupClick`'s else branch ran. */}
      {clusterList && (
        <ClusterListPopover
          families={clusterList.families}
          familyNames={clusterListFamilyNames}
          speciesByFamily={clusterList.speciesByFamily}
          {...(clusterList.overflowByFamily ? { overflowByFamily: clusterList.overflowByFamily } : {})}
          totalCount={clusterList.totalCount}
          uniqueFamilies={clusterList.uniqueFamilies}
          anchorEl={clusterList.anchorEl}
          onDismiss={() => setClusterList(null)}
          onSelectSpecies={(code) => {
            if (onSelectSpecies) {
              onSelectSpecies(code);
            }
            setClusterList(null);
          }}
          {...(clusterList.drillCenter
            ? { onDrillIn: () => handleDrillInToCenter(clusterList.drillCenter) }
            : {})}
        />
      )}
    </div>
  );
}

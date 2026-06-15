import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// Aliasing the react-map-gl/maplibre Map component to MapView so the
// global ES Map constructor remains available inside this module — otherwise
// `new Map()` inside e.g. `leafCache = new Map<string, Promise<...>>()`
// resolves to the React component and throws "Map is not a constructor".
import {
  Map as MapView,
  Source,
  Layer,
} from 'react-map-gl/maplibre';
import type { MapLayerMouseEvent, MapRef } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { StyleSpecification } from 'maplibre-gl';
import type { AggregatedBucket, Observation } from '@bird-watch/shared-types';
import { resolveDescriptor } from './geometry/basemap-style.js';
import type { ThemeId } from './geometry/basemap-style.js';
import { useActiveThemeId, setBasemapStyle } from './theme-state.js';
import { INITIAL_VIEW, MIN_ZOOM } from './geometry/camera-config.js';
import {
  buildMaskFeature,
  MASK_FILL_LIGHT,
  MASK_FILL_DARK,
} from './geometry/mask.js';
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
} from './geometry/observation-layers.js';
import { mergeLeafBuckets } from '@/data/bucket-aggregates.js';
import type { SpeciesDictionary } from '@/data/use-species-dictionary.js';
import { ObservationPopover } from './layers/ObservationPopover.js';
import { ClusterListPopover } from './layers/ClusterListPopover.js';
import { StatusBlock } from '@/components/ds/StatusBlock.js';
// Marker render-tree dispatch extracted to two presentational layers
// (epic #884 · U11 / #896). MapCanvas keeps every handler + derived state and
// threads them as props; the layers hold no map ref and render only.
// `AdaptiveGridMarker`, `PresentationMarker`, `ClusterPill`, `MapMarkerHitLayer`
// and the `SILHOUETTE_PX` constant now live in those layers, not here.
import { GroupMarkerLayer } from './layers/GroupMarkerLayer.js';
import { DisplacedSilhouetteLayer } from './layers/DisplacedSilhouetteLayer.js';
import { registerSilhouetteSprite } from './geometry/silhouette-sprite.js';
import { useSilhouetteCatalogue } from './hooks/use-silhouette-catalogue.js';
import { useMapResize } from './hooks/use-map-resize.js';
import { useScopeCamera } from './hooks/use-scope-camera.js';
import { useStateArtboard } from './hooks/use-state-artboard.js';
import { loadSanitizedStyle } from './geometry/basemap-style-sanitizer.js';
import { enforceDarkLabelContrast } from './geometry/basemap-label-contrast.js';
import {
  aggregateClusterFamilies,
  aggregateClusterSpecies,
  buildAdaptiveTiles,
  tilesFromAggregates,
  pickGridShape,
  type ClusterLeafFeature,
  type FamilyAggregate,
  type SpeciesAggregate,
} from './geometry/adaptive-grid.js';
import { type HitTargetMarker } from './layers/MapMarkerHitLayer.js';
import {
  hashSubId,
  type DeconflictGroup,
  type DeconflictInput,
} from './geometry/deconflict.js';
// Reconciler pure middle (deconflict → displace → unproject → feature-state
// diff) extracted to reconcile-viewport.ts (epic #884 · U10, #895). The shell
// in the adaptive-grid reconciler effect below assembles `inputs` (owning both
// `map.project` calls), calls this with an injected `unproject`, then commits.
import { reconcileToGroups } from './geometry/reconcile-viewport.js';
import { resolveFamilyName } from '@/derived.js';
// Pure observation derives extracted to obs-derive.ts (epic #884 · U8, #892).
// The fresh-closure `obsLookupRef` latch below stays in the component (it's
// the indirection, not the memo).
import {
  buildObsLookup,
  buildSilhouetteRenderById,
  buildHitMarkers,
} from './geometry/obs-derive.js';
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
import { useCoarsePointer } from '@/lib/use-coarse-pointer.js';
import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion.js';

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

// #1049 (M-12) basemap-failure watchdog tuning.
//
// `BASEMAP_WATCHDOG_MS` — how long after mount (or a Retry) the basemap has to
// report healthy (the maplibre `load` on first paint, `style.load` thereafter)
// before the watchdog concludes the OpenFreeMap CDN has stalled and surfaces
// the retry card. Kept at ~10 s deliberately: it must be comfortably longer
// than a cold style+first-tile fetch on a slow connection (so a healthy-but-
// slow load never false-positives), and — load-bearing for the test suite —
// it must stay multi-second so the 3.5k-line MapCanvas suite (which runs REAL
// timers) can never trip it. The watchdog tests use FAKE timers to advance it.
export const BASEMAP_WATCHDOG_MS = 10_000;

// `BASEMAP_ERROR_THRESHOLD` — M consecutive clause-(ii) basemap-source errors
// (a flaky-CDN tile/network hiccup keyed on BASEMAP_SOURCE_ID) before the card
// is surfaced. AbortErrors (clause i) are NEVER counted, and any successful
// `style.load` resets the run to zero. A small M ride-throughs the odd
// transient 429 but still reacts to a persistently-down CDN within a few
// failed tile batches.
export const BASEMAP_ERROR_THRESHOLD = 5;

// Re-exported so the watchdog's Retry test can assert `setStyle` was called with
// the exact current-theme URL without re-literaling the OpenFreeMap endpoints
// (single source of truth = basemap-style.ts). These are pass-through aliases of
// the basemap-style.ts exports already imported above.
export { BASEMAP_LIGHT, BASEMAP_DARK } from './geometry/basemap-style.js';

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

// PresentationMarker — the WCAG role-strip <Marker> wrapper (#459 W4-C) was
// extracted to `PresentationMarker.tsx` (epic #884, unit U5 / #890) and is
// imported at the top of this file. Behavior-preserving move; the three call
// sites below are unchanged.

// Camera / viewport config (CONUS framing constants, pan/zoom bounds,
// `pickInitialZoom`, `INITIAL_VIEW`, `FIT_BOUNDS_PADDING`) was extracted to
// `camera-config.ts` (epic #884, unit U2 / #886) — imported at the top of this
// file. The imperative camera machinery that consumed those constants
// (the scope bounds-math + the flyTo/fitBounds/cameraForBounds/setMaxBounds
// effect with its #848 moveend corrector) was then extracted to
// `use-scope-camera.ts` (epic #884, unit U12 / #897); this file calls the hook
// and consumes its `{ clampBounds, initialViewState }` return. Both moves are
// behavior-preserving.

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

/**
 * A trivial, valid, background-only style painted in the active theme's land
 * color while the real (pre-sanitized) basemap object loads (#1230). Feeding the
 * constructor a placeholder OBJECT — never a raw URL — keeps the map ALWAYS
 * MOUNTED (#761) and avoids the unguarded first paint that a raw `mapStyle={url}`
 * would hand the worker. bg → basemap is the normal load appearance, not a
 * flash: the placeholder is the same land color the basemap settles into.
 */
function backgroundPlaceholderStyle(themeId: ThemeId): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        id: 'bg',
        type: 'background',
        paint: { 'background-color': resolveDescriptor(themeId).landColor },
      },
    ],
  };
}

/**
 * Resolve a pre-sanitized basemap STYLE OBJECT for the active theme id (#1230).
 *
 * The `<Map>` constructor accepts a style object but has no `transformStyle`
 * hook (a `setStyle`-only option), so a raw `mapStyle={url}` would hand the
 * worker an unguarded style and fire the null-numeric `warnOnce` on the first
 * paint. This hook loads the style via `loadSanitizedStyle` (fetch → sanitize →
 * memoized) and returns the guarded `StyleSpecification`, so the constructor
 * never sees a raw URL. While a NEW id is still loading it keeps the previously
 * resolved style (no flash back to the placeholder on a theme swap); the very
 * first load shows the theme-colored `backgroundPlaceholderStyle`. Fails OPEN —
 * a fetch error leaves the placeholder up and is logged; the live `setStyle`
 * swap path can still retry.
 */
function useSanitizedBasemapStyle(themeId: ThemeId): StyleSpecification {
  const [style, setStyle] = useState<StyleSpecification | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadSanitizedStyle(resolveDescriptor(themeId).url)
      .then((resolved) => {
        if (!cancelled) setStyle(resolved);
      })
      .catch((err: unknown) => {
        // Fail OPEN: keep the last good / placeholder style up. The basemap
        // health watchdog + Retry path own recovery; never blank the map.
        // eslint-disable-next-line no-console
        console.error('basemap style load failed', err);
      });
    return () => {
      cancelled = true;
    };
  }, [themeId]);
  // Keep the prior resolved style while a new id loads (no placeholder flash on
  // swap); only the very first load falls back to the theme-colored background.
  return style ?? backgroundPlaceholderStyle(themeId);
}

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
  activeThemeId: activeThemeIdProp,
}: MapCanvasProps) {
  const aggregated = mode === 'aggregated';
  const mapRef = useRef<MapRef>(null);
  /**
   * Wrapper element the `map.resize()` ResizeObserver watches (#737, S3 of
   * #761). This is the `data-testid="map-canvas"` div — the box whose containing
   * block flipped from a padded `<main>` flex child to the `position: fixed;
   * inset: 0` `#map-layer` viewport sibling in S2. The ref is consumed by the
   * `useMapResize` hook (`use-map-resize.ts`), which owns the corrective
   * `map.resize()` ResizeObserver effect.
   */
  const mapWrapperRef = useRef<HTMLDivElement>(null);
  // Scope-camera bounds-math (`activeBounds`/`clampBounds`/the mount
  // `initialViewState`) + the SINGLE scope-driven camera-intent effect (the
  // flyTo-vs-fitBounds chooser + the #848 moveend longitude corrector) were
  // extracted to `use-scope-camera.ts` (epic #884 · U12 / #897). The hook is
  // called below (after `mapReady` + `prefersReducedMotion` are in scope) and
  // returns `{ clampBounds, initialViewState }` consumed by the `<MapView>` JSX.
  // Behaviour-preserving move; the load-bearing `clampBounds` guard form and the
  // effect deps are 1:1 with the pre-extraction code.
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
  // E1 (#1053): close the canvas-owned transient popovers on the RISING edge of
  // `detailOpen`. Opening a species detail must dismiss any open
  // ObservationPopover (`selectedObs`) or canvas-level ClusterListPopover
  // (`clusterList`) — desktop they otherwise linger mid-map beside the detail
  // card; mobile they paint ON TOP of the detail sheet, occluding the heading.
  // #976 only demoted the passive hover preview's z-index; click-opened popovers
  // were never cleared. RISING-edge only (tracked via a ref) so a popover opened
  // WHILE a detail is already up is left alone. The sibling marker-local
  // clearing (`activeCell` 'popover' + `isClusterListOpen`) lives in
  // AdaptiveGridMarker.tsx; both halves are needed to cover every open-state.
  const prevDetailOpenRef = useRef(detailOpen);
  useEffect(() => {
    if (detailOpen && !prevDetailOpenRef.current) {
      setSelectedObs(null);
      setClusterList(null);
    }
    prevDetailOpenRef.current = detailOpen;
  }, [detailOpen]);
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

  // ── #1049 (M-12) basemap-failure watchdog ────────────────────────────────
  // OpenFreeMap CDN flakiness (ERR_CONNECTION_CLOSED/429 on tiles.openfreemap.org)
  // can leave the basemap blank with NO `load`/`style.load` and no console
  // error/warning — floating chrome over a silent void. `basemapFailed` drives
  // the transient-layer tier-2 retry card (the four-corner anchor contract's
  // transient surface — it mirrors the `.map-error-overlay` precedent). It is
  // set by (a) a style-load timeout (neither `load` nor `style.load` within
  // BASEMAP_WATCHDOG_MS of mount/Retry) or (b) BASEMAP_ERROR_THRESHOLD
  // consecutive clause-(ii) basemap-source errors. AbortErrors (clause i) are
  // NEVER counted (the #854 benign swallow is preserved verbatim).
  const [basemapFailed, setBasemapFailed] = useState(false);
  // `basemapHealthyRef` flips true the moment the basemap reports healthy — the
  // first `load` (via handleLoad) and every `style.load` thereafter. The
  // watchdog timer reads it on expiry so a healthy-but-slow load never trips
  // the card. A ref (not state) because the timer closure must see the LIVE
  // value without re-arming on every render.
  const basemapHealthyRef = useRef(false);
  // Consecutive clause-(ii) basemap-error tally. A ref so incrementing it does
  // not re-render; it crosses the threshold → setBasemapFailed(true). Reset to
  // zero on any successful `style.load` (the CDN recovered).
  const basemapErrorCountRef = useRef(0);
  // Bumped on each Retry to re-arm the watchdog effect (its dep). Starting the
  // timer is idempotent w.r.t. mount; the epoch is the explicit re-trigger.
  const [watchdogEpoch, setWatchdogEpoch] = useState(0);

  // State-artboard machinery (#760/#762/#763/#765/#849/#850 blank-map class) is
  // consolidated into `useStateArtboard` (`use-state-artboard.ts`, epic #884 ·
  // U13 / #898): the four mask/label-isolation effects, the `[data-theme]`
  // MutationObserver (basemap `setStyle` + mask-fill re-tint), and the
  // `renderWorldCopies` reassertion — moved as ONE indivisible unit, owning ALL
  // their cross-effect state (`maskTheme`, `savedFiltersRef`, `maskPolygonRef`,
  // `styleEpoch`, and the MutationObserver-private `prevThemeRef` same-value
  // guard). The hook is called below (once `maskPolygon` is in scope) and returns
  // `{ maskTheme }` — the reactive mask-fill theme the `<Layer>` `paint` prop
  // reads. `mapRef` + the `<Map>`/`<Source>`/`<Layer>` JSX stay here.
  /* Coarse-pointer detection (#247, mobile; also used by auto-spider hit
     targets in #277). Extracted to a generic sensor hook in #889 (epic #884);
     reactive — reads on mount and listens for `change`. */
  const isCoarsePointer = useCoarsePointer();

  // #1063: `usePrefersReducedMotion` is a LIVE sensor — it tracks the OS
  // reduce-motion preference across the session (CSS already responded live via
  // motion.css; this aligns the JS camera-flight gate so the two no longer
  // split-brain for vestibular-sensitive users). The camera flights below read
  // the preference through `prefersReducedMotionRef.current` rather than the
  // value directly: the `clusters` click handler is registered ONCE in
  // `handleLoad` (it would otherwise capture the mount-time value forever), and
  // the scope-reframe effect (`useScopeCamera`) must NOT take a live value as a
  // dep or an OS toggle would spuriously re-fire the reframe (#848/#736). The ref
  // mirrors the live value every render; flights read `.current` at dispatch time.
  const prefersReducedMotion = usePrefersReducedMotion();
  const prefersReducedMotionRef = useRef(prefersReducedMotion);
  prefersReducedMotionRef.current = prefersReducedMotion;

  // #1059 (M-30) — live viewport span `[lngSpan, latSpan]` in degrees, feeding
  // the ZOOM-AWARE artboard clamp in `useScopeCamera` below. Updated on the
  // `zoomend` settle (the span is a function of zoom + viewport px; pan does not
  // change it materially, and a per-frame update would churn React and re-apply
  // `maxBounds` mid-gesture). `undefined` until the first settle so the clamp
  // falls back to the STATIC padded value at mount — keeping entry framing
  // byte-identical to the pre-#1059 path (the fitBounds frame). The `zoomend`
  // setter is registered in `handleLoad` alongside `setMapZoom`.
  const [viewportSpan, setViewportSpan] = useState<[number, number] | undefined>(
    undefined,
  );

  // SINGLE scope-driven camera-intent hook (#736 — Task C3; extracted to
  // `use-scope-camera.ts`, epic #884 · U12 / #897). Owns the flyTo-vs-fitBounds
  // chooser, the #848 moveend longitude corrector, and the derived bounds-math.
  // `clampBounds` is the REACTIVE `<MapView maxBounds>` prop; `initialViewState`
  // is the mount first-paint frame. Both feed the JSX below. The hook's JSDoc
  // carries the full rationale (mapReady load-gating, flyTo-preference,
  // essential:true reduced-motion bypass, and the #848 transform-clone clobber).
  const { clampBounds, initialViewState } = useScopeCamera(
    mapRef,
    mapReady,
    bounds,
    boundsKey,
    flyTo,
    clampPad,
    prefersReducedMotionRef,
    // #1059 — live viewport span drives the zoom-aware artboard clamp; a wider
    // `clampBounds` change on zoom re-applies reactively via the `maxBounds`
    // prop (no remount), same mechanism as the static clamp.
    viewportSpan,
  );

  // Corrective `map.resize()` on the S2 flex→fixed container transition (#737,
  // gap 8 of #761). Extracted to `use-map-resize.ts` (epic #884 · U9): the
  // `mapWrapperRef` ref + its JSX stay here, only the rAF-debounced
  // CAMERA-NEUTRAL ResizeObserver effect moved. The hook's JSDoc carries the
  // full rationale (containing-block reparent, the IDEMPOTENT debounce, the
  // DISCONNECTED-on-cleanup `<Map>`-remount guard, and the S4 scope-gate
  // invariant that the observer only ever calls `map.resize()`).
  useMapResize(mapRef, mapWrapperRef, mapReady);

  // Active basemap-theme id state (C1.5 · #1213) — the reactive source of truth
  // for the basemap swap. C8 (#1220) lifts the canonical id to App.tsx
  // (`useActiveThemeId` seeded from `resolveInitialTheme`) and threads it in as
  // the `activeThemeId` prop, so the <ThemeSelector> and this swap share ONE
  // source of truth and every theme — including same-kind switches and a stored
  // `bright`/`liberty`/`fiord` — is reachable. The local `useActiveThemeId()`
  // call is retained ONLY as the fallback seed/descriptor for legacy/test callers
  // that omit the prop (behavior-identical to pre-C8: seeded from `[data-theme]`).
  // When the prop is present it WINS for both the id (swap key + initial mapStyle)
  // and the resolved descriptor (marker halo / float colors).
  const { themeId: localThemeId, descriptor: localDescriptor } =
    useActiveThemeId();
  const activeThemeId = activeThemeIdProp ?? localThemeId;
  const activeDescriptor =
    activeThemeIdProp != null ? resolveDescriptor(activeThemeIdProp) : localDescriptor;

  // #1230: the INITIAL `<MapView mapStyle>` gets a PRE-SANITIZED style OBJECT,
  // never a raw URL. The constructor has no `transformStyle` hook (it is a
  // `setStyle`-only option), so a raw URL would let the worker parse a
  // null-prone expression and fire `warnOnce("Expected value to be of type
  // number…")` on the first paint (bright's POI rank filters trip it the moment
  // bright is default). The hook fetches + sanitizes + memoizes the style; until
  // it resolves the constructor shows a solid theme-colored background (no raw
  // URL ever reaches maplibre, the always-mounted #761 invariant holds, and
  // bg → basemap is the normal load appearance, not a flash). Subsequent theme
  // swaps + Retry still route through `setStyle(url, { transformStyle })`
  // (use-state-artboard `swapBasemap` / the Retry handler) — the constructor is
  // the only entry point that needs the object form.
  const initialBasemapStyle = useSanitizedBasemapStyle(activeThemeId);

  // State-artboard machinery consolidated into ONE hook (`use-state-artboard.ts`,
  // epic #884 · U13 / #898; the #760/#762/#763/#765/#849/#850 blank-map class).
  // `useStateArtboard` owns the four mask/label-isolation effects, the id-driven
  // basemap swap (C1.5 · #1213: an effect keyed on `activeThemeId` →
  // `swapBasemap`, with a `[data-theme]` MutationObserver kept only as a belt for
  // external/devtools attribute writes), and the `renderWorldCopies` reassertion —
  // moved as ONE indivisible unit with ALL their cross-effect state (`maskTheme`,
  // `savedFiltersRef`, `maskPolygonRef`, `styleEpoch`, and the swap-private
  // `prevThemeIdRef` id-keyed same-value guard). The hook's JSDoc carries the full
  // rationale (the load-bearing 3a/3b reconcile-sequencing split deferred via the
  // `styleEpoch` re-fire, the once-registered `style.load` fresh-closure
  // ref-mirror, the camera↔`renderWorldCopies` transform-clone race, and the
  // no-op-id swap guard). `maskTheme` is the reactive mask-fill theme consumed by
  // the `<Layer>` `paint` prop below; `mapRef` + the `<MapView>`/`<Source>`/
  // `<Layer>` JSX stay here. Behaviour-preserving: only positron/dark are reachable,
  // so the toggle still flips light↔dark and swaps the basemap exactly as today.
  const { maskTheme } = useStateArtboard(
    mapRef,
    mapReady,
    maskPolygon,
    activeThemeId,
  );

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
   * Silhouette catalogue derives (epic #884, U7 / #891). The monotonic
   * `silhouettesVersion` render-phase counter + the `silhouettesById` lookup
   * memo (keyed `[silhouettes]`, referentially stable) are extracted into
   * `use-silhouette-catalogue.ts` — behavior-preserving. The version counter
   * is NOT `silhouettes.length` (a length-only proxy misses in-place row
   * replacement — Phylopic refreshes, low-res→hi-res swaps); it bumps on a
   * silhouettes-prop reference change, which is where the supercluster
   * catalogue is rebuilt. Carried into the per-grid memo key + the
   * cache-generation effect; `silhouettesById` (an empty map signals
   * "catalogue not loaded yet") threads into `buildAdaptiveTiles`.
   */
  const { silhouettesById, silhouettesVersion } = useSilhouetteCatalogue(silhouettes);

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
  // #1216: the marker halo color now comes from the active descriptor, so the
  // spec must be recomputed when the descriptor changes (a live theme swap).
  // react-map-gl `<Layer>` specs are built once at mount and only re-diff on a
  // NEW spec object — without `activeDescriptor` in the deps the halo would
  // freeze at the mount-time descriptor and never update on swap.
  const unclusteredLayer = useMemo(
    () => buildUnclusteredPointLayerSpec(activeDescriptor),
    [activeDescriptor],
  );

  // Observation lookup by subId for click handler. Pure derive extracted to
  // obs-derive.ts (#892); prototype-free record built there.
  const obsLookup = useMemo(() => buildObsLookup(observations), [observations]);

  /**
   * Per-subId silhouette-render lookup (issue #554 scope expansion 2026-05-15).
   * Maps each observation's subId → its rendered silhouette path + color, so
   * the displaced-silhouette render block can paint an inline SVG that
   * visually matches the symbol-layer rendering it replaces.
   * `svgData === null` means the family has no usable Phylopic silhouette —
   * the displaced marker falls through to the _FALLBACK shape.
   * Pure derive extracted to obs-derive.ts (#892).
   */
  const silhouetteRenderById = useMemo(
    () => buildSilhouetteRenderById(observations, silhouettesById),
    // silhouettesById captures the silhouettes prop transitively (see its useMemo above).
    [observations, silhouettesById],
  );

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
    // #1049: the first `load` IS the basemap reporting healthy — mark it so the
    // watchdog timer (which reads this ref on expiry) cancels. `load` fires only
    // once per map lifetime; subsequent recovery is signalled by `style.load`
    // (wired in the dedicated effect below), per the #854 / load-once contract.
    basemapHealthyRef.current = true;
    basemapErrorCountRef.current = 0;

    // #947: the dark/fiord `circle-11` styleimagemissing warning is fixed
    // STRUCTURALLY, not here — the style sanitizer
    // (`basemap-style-sanitizer.ts`, `neutralizeMissingIconImages`) strips the
    // broken icon-image reference BEFORE the worker parses the style, at the
    // same pre-worker chokepoint as the null-numeric guard. A `load`-time
    // `styleimagemissing` listener could only `addImage` AFTER the worker had
    // already `warnOnce`d, so it can never prevent the first/only warning.

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
                // Read via ref: this handler is registered once in handleLoad,
                // so a captured value would freeze at mount; .current is live.
                ...(prefersReducedMotionRef.current ? { duration: 0 } : {}),
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
      // #1059 — refresh the live viewport span for the zoom-aware artboard
      // clamp. `getBounds()` is the current viewport rectangle in lng/lat; its
      // width/height are the per-axis spans the clamp caps its pad against.
      const vb = map.getBounds();
      setViewportSpan([
        Math.abs(vb.getEast() - vb.getWest()),
        Math.abs(vb.getNorth() - vb.getSouth()),
      ]);
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

  // ── #1049 (M-12) watchdog timer ──────────────────────────────────────────
  // Arms on mount and re-arms on each Retry (watchdogEpoch). If the basemap has
  // not reported healthy (`basemapHealthyRef`) by BASEMAP_WATCHDOG_MS, surface
  // the card. Real-timer-safe: the multi-second default never fires inside the
  // suite's real-timer tests; the watchdog tests advance fake timers.
  useEffect(() => {
    // A prior success (or a Retry that already recovered) means nothing to watch.
    if (basemapHealthyRef.current) return;
    const timer = setTimeout(() => {
      if (!basemapHealthyRef.current) {
        setBasemapFailed(true);
      }
    }, BASEMAP_WATCHDOG_MS);
    return () => clearTimeout(timer);
  }, [watchdogEpoch]);

  // ── #1049: `style.load` health signal ────────────────────────────────────
  // `load` fires once per map lifetime (handleLoad), so basemap RECOVERY after a
  // Retry's `setStyle` is signalled by `style.load` instead (reviewer addendum
  // (2)). Registered once after mapReady (ref-read deps, like the artboard's own
  // style.load listener); on each style reload it marks the basemap healthy,
  // zeroes the error tally, and clears any showing failure card.
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    const onStyleLoad = () => {
      basemapHealthyRef.current = true;
      basemapErrorCountRef.current = 0;
      setBasemapFailed(false);
    };
    map.on('style.load', onStyleLoad);
    return () => {
      map.off('style.load', onStyleLoad);
    };
  }, [mapReady]);

  // ── #1128: dark-label contrast fixup at style.load ────────────────────────
  // The null-numeric-comparison guard is NO LONGER applied here — it now runs
  // BEFORE the worker parses the style, at every entry point: the constructor
  // gets a pre-sanitized OBJECT (useSanitizedBasemapStyle → loadSanitizedStyle)
  // and `setStyle` swaps/Retry route through `transformStyle`
  // (transformStyleSanitizeNull, via setBasemapStyle). The old live-map
  // `style.load` sweep ran AFTER the worker had already warned, so it could
  // never stop the first warning — a redundant band-aid, now deleted (#1230).
  //
  // What remains is #1128 `enforceDarkLabelContrast`: the dark basemap is a
  // DIFFERENT style (setStyle, not a CSS filter) that ships LIGHT-mode label
  // text colors, so at z14 every label layer fails WCAG AA against the
  // rgb(12,12,12) dark canvas. This recolors the failing symbol layers to
  // AA-passing light text + dark halo (no-op on the light style — it gates on
  // the measured background luminance; see basemap-label-contrast.ts). It MUST
  // stay a live-map `style.load` pass: it measures the rendered background
  // luminance, so it has nothing to act on until the style is committed.
  // Re-runs on initial load AND on every `style.load` (theme swap / Retry), with
  // the active descriptor re-resolved per theme (C2 · #1214).
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    const apply = () => {
      enforceDarkLabelContrast(map, resolveDescriptor(activeThemeId));
    };
    apply(); // mapReady ⇒ first style already parsed; fix it up now
    map.on('style.load', apply);
    return () => {
      map.off('style.load', apply);
    };
  }, [mapReady, activeThemeId]);

  // ── #1049: error-counting handler ────────────────────────────────────────
  // Wraps the exported `handleMapError` (which is UNCHANGED — same #854 console
  // hygiene) with consecutive-failure counting. Only clause-(ii) basemap-source
  // errors that are NOT AbortErrors tally; an AbortError (clause i) is benign
  // camera-move noise and is never counted. Crossing BASEMAP_ERROR_THRESHOLD
  // surfaces the card.
  const handleMapErrorWithWatchdog = useCallback((e: MapErrorEvent) => {
    const isBasemapTileFailure =
      e.error?.name !== 'AbortError' && e.sourceId === BASEMAP_SOURCE_ID;
    if (isBasemapTileFailure) {
      basemapErrorCountRef.current += 1;
      if (basemapErrorCountRef.current >= BASEMAP_ERROR_THRESHOLD) {
        setBasemapFailed(true);
      }
    }
    // Delegate logging verbatim to the unchanged #854 handler.
    handleMapError(e);
  }, []);

  // ── #1049: Retry ─────────────────────────────────────────────────────────
  // Re-fetch the basemap by re-setting the current-theme style. `setStyle` fires
  // a fresh `style.load` — the artboard's own style.load listener
  // (use-state-artboard.ts) re-applies label isolation + bumps styleEpoch, and
  // our style.load health listener above marks the basemap healthy + clears the
  // card. So Retry coordinates with the existing setStyle/styleEpoch machinery
  // rather than racing it (reviewer addendum (1)): it routes through the SAME
  // `style.load` re-apply path the [data-theme] swap uses. We optimistically
  // clear the card and re-arm the watchdog so a still-dead CDN re-surfaces it.
  const handleBasemapRetry = useCallback(() => {
    const map = mapRef.current?.getMap();
    // C1.5 (#1213): resolve the CURRENT basemap URL from the active theme id (the
    // reactive source of truth), not the lossy `[data-theme]` attribute ternary.
    const style = resolveDescriptor(activeThemeId).url;
    basemapHealthyRef.current = false;
    basemapErrorCountRef.current = 0;
    setBasemapFailed(false);
    // Guarded: if the map ref is somehow gone, the watchdog re-arm below still
    // re-surfaces the card after the window (no silent dead-end). #1230: routes
    // through `setBasemapStyle` — the SAME transform-guarded setter the theme
    // swap uses — so a Retry re-fetch of a null-prone style never re-logs the
    // worker warning.
    if (map) setBasemapStyle(map, style);
    setWatchdogEpoch((n) => n + 1);
  }, [activeThemeId]);

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

      // Pure middle (epic #884 · U10, #895): deconflict → displace →
      // unproject-round-trip → feature-state diff, lifted into
      // reconcile-viewport.ts. The map dependency injected is `unproject`
      // ONLY — the caller owns projection (both `map.project` calls above ran
      // while assembling `inputs`, whose px/py are already projected). The
      // pure fn returns the feature-state diff as DATA; the shell applies it
      // and owns the `prevHiddenSubIdsRef` write-back.
      const { groups: nextGroups, offsets: nextOffsets, featureStateDiff } =
        reconcileToGroups(
          inputs,
          floorZoom,
          (point) => map.unproject(point),
          prevHiddenSubIdsRef.current,
        );
      setGroups(nextGroups);
      setSilhouetteOffsets(nextOffsets);

      // Feature-state sync: hide the canvas-painted twin for every
      // displaced silhouette; clear feature-state for silhouettes that
      // were displaced last pass but aren't now. promoteId="subId" on
      // the Source ensures setFeatureState({id: subId}) targets the
      // right feature.
      for (const subId of featureStateDiff.toHide) {
        map.setFeatureState(
          { source: 'observations', id: subId },
          { hidden: true },
        );
      }
      for (const subId of featureStateDiff.toClear) {
        map.removeFeatureState(
          { source: 'observations', id: subId },
          'hidden',
        );
      }
      // The pure fn computes the diff against the PASSED-IN hidden set but does
      // NOT own the ref — the shell advances it after applying the diff.
      prevHiddenSubIdsRef.current = new Set<string>(nextOffsets.keys());

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

  // The [data-theme] MutationObserver (basemap `setStyle` swap + mask-fill
  // re-tint via `setMaskTheme`, with the `prevThemeRef` no-op-write guard) was
  // consolidated into `useStateArtboard` (`use-state-artboard.ts`, epic #884 ·
  // U13 / #898) — it is part of the same indivisible artboard machinery and
  // runs alongside the four mask/label-isolation effects + the world-copies
  // reassertion. See the hook for the full rationale.

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
                ...(prefersReducedMotionRef.current ? { duration: 0 } : {}),
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
            ...(prefersReducedMotionRef.current ? { duration: 0 } : {}),
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
    // prefersReducedMotion is read through the stable ref (`.current`), so it is
    // intentionally NOT a dep — the callback need not be re-created on an OS
    // reduce-motion toggle; the flight `duration` picks up the live value anyway.
    [aggregated, observations, openClusterListFromGroup],
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
        // Live preference via the stable ref — see prefersReducedMotionRef above.
        ...(prefersReducedMotionRef.current ? { duration: 0 } : {}),
      });
    },
    // prefersReducedMotion read through the ref (`.current`); not a dep.
    [],
  );

  /* Hit-target layer: render hit targets at zoom >= CLUSTER_MAX_ZOOM
     (now 22, post-cutover) for individual observations. The adaptive-grid
     reconciler renders 1×1 grid markers for singletons at this zoom; the
     hit layer is the wider clickable surface that survives small marker
     sizes. Below CLUSTER_MAX_ZOOM, observations are clustered, so the
     overlay is suppressed and cluster-marker clicks (AdaptiveGridMarker /
     ClusterPill) drive the interaction.
     Pure derive extracted to obs-derive.ts (#892); the #921 upstream
     colloquial-family-name resolution + #247/#277 displaced re-anchoring
     live in buildHitMarkers. */
  const hitMarkers: HitTargetMarker[] = useMemo(
    () => buildHitMarkers(observations, mapZoom, silhouetteOffsets, silhouettesById),
    [observations, mapZoom, silhouetteOffsets, silhouettesById],
  );

  const handleHitSelect = useCallback(
    (subId: string) => {
      const obs = obsLookupRef.current[subId];
      if (obs) openPopover(obs);
    },
    [openPopover],
  );

  const map = mapReady ? mapRef.current?.getMap() ?? null : null;

  return (
    <div
      ref={mapWrapperRef}
      data-testid="map-canvas"
      // #1031: programmatically focusable, but OUT of the keyboard tab order.
      // ObservationPopover.returnFocus() falls back to `.focus()`-ing this
      // wrapper when the originating marker has left the DOM/viewport; a plain
      // <div> with no tabIndex is not focusable, so that `.focus()` is a silent
      // no-op and focus drops to document.body — the exact outcome the fallback
      // exists to prevent. `-1` makes the programmatic focus land here while
      // keeping the map out of the Tab sequence (it is not a keyboard control).
      tabIndex={-1}
      style={{ width: '100%', height: '100%', position: 'relative' }}
    >
      <MapView
        ref={mapRef}
        initialViewState={initialViewState}
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
        // #1230: never diff the `mapStyle` PROP change. The only prop-driven
        // style change is the placeholder → real-style swap on first load
        // (`useSanitizedBasemapStyle` returns `backgroundPlaceholderStyle` until
        // `loadSanitizedStyle` resolves, then swaps in the real style). Diffing
        // that races the placeholder's own load: when the real style arrives
        // before the trivial placeholder has fired `style.load`, maplibre `warn`s
        // "Unable to perform style diff: Style is not done loading. Rebuilding the
        // style from scratch." and rebuilds anyway — an intermittent console-noise
        // flake (caught by the state-artboard assertCleanConsole gate). The
        // placeholder and the real style are unrelated, so a diff yields nothing;
        // disable it and the swap is a clean, warning-free rebuild. This is the
        // FIRST-load swap only, before any custom layers (clusters/observations/
        // artboard) are added, so the rebuild has nothing to tear down. (We do
        // NOT force `diff: false` on the imperative theme-swap `setStyle` in
        // theme-state: a mid-session rebuild there briefly drops the custom
        // layers, and an in-flight `clusters-hit` queryRenderedFeatures would log
        // "layer does not exist". maplibre already rebuilds across different style
        // URLs, so a theme swap doesn't hit the "not done loading" path anyway.)
        styleDiffing={false}
        style={{ width: '100%', height: '100%' }}
        // C1.5 (#1213) + #1230: the initial basemap is a PRE-SANITIZED style
        // OBJECT for the active theme id (`useSanitizedBasemapStyle`), NOT a raw
        // URL and NOT the lossy `[data-theme]` ternary — so the worker never
        // parses a null-prone expression on the first paint. The id-driven swap
        // effect in `useStateArtboard` owns every subsequent swap (via
        // `setStyle(url, { transformStyle })`).
        mapStyle={initialBasemapStyle}
        onLoad={handleLoad}
        // #854: swallow benign transient map errors (AbortErrors from tile
        // fetches cancelled mid-camera-move; OpenFreeMap CDN hiccups keyed on
        // the basemap source) and re-log everything else. Without an `onError`
        // prop, react-map-gl's `_onEvent` falls back to `console.error(e.error)`
        // for every maplibre `error` event — dirtying the console during a
        // scope `fitBounds` fly. Passing this handler diverts that fallback, so
        // `handleMapError` re-surfaces genuine errors itself. See the handler's
        // doc comment + isBenignMapError for the narrow swallow predicate.
        //
        // #1049 (M-12): `handleMapErrorWithWatchdog` WRAPS that handler — it
        // counts consecutive clause-(ii) basemap-source failures toward the
        // retry-card threshold, then delegates logging to the UNCHANGED
        // `handleMapError` (so the #854 console-hygiene contract is preserved).
        onError={handleMapErrorWithWatchdog}
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
          Unified deconflict render (issue #554). Iterates the `groups`
          slice — one entry per overlap component — and dispatches to
          <AdaptiveGridMarker> or <ClusterPill> based on the anchor's
          rendered.kind. The spatial-bucket key (group.key) is stable when
          the anchor stays in the same ~14px bucket, so React's reconciler
          doesn't churn under pan. Extracted to `GroupMarkerLayer.tsx`
          (epic #884 · U11 / #896) — presentational; MapCanvas keeps the
          handlers and threads them as props. */}
        <GroupMarkerLayer
          groups={groups}
          isCoarsePointer={isCoarsePointer}
          detailOpen={detailOpen}
          onGroupClick={handleGroupClick}
          {...(onSelectSpecies ? { onSelectSpecies } : {})}
          onDrillIn={handleDrillInToCenter}
        />
        {/*
          Displaced silhouettes (issue #554 scope expansion 2026-05-15) +
          the co-located hit-target overlay (#247/#277). Both are overlay
          siblings of the maplibre canvas: the twins keep a deconflicted
          silhouette VISIBLE (its canvas-painted original is hidden via
          feature-state), and the hit layer hosts the wider clickable hit
          targets. Extracted to `DisplacedSilhouetteLayer.tsx` (epic #884 ·
          U11 / #896) — presentational; MapCanvas keeps openPopoverAt /
          handleHitSelect and threads them as props. The `map && (...)`
          guard on the hit-layer mount is preserved inside the component. */}
        <DisplacedSilhouetteLayer
          silhouetteOffsets={silhouetteOffsets}
          obsLookup={obsLookup}
          silhouetteRenderById={silhouetteRenderById}
          onOpen={openPopoverAt}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          map={map as any}
          hitMarkers={hitMarkers}
          onSelect={handleHitSelect}
          isCoarsePointer={isCoarsePointer}
        />
      </MapView>
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
      {/* #1049 (M-12): basemap-failure retry card. Transient-layer tier-2
          surface per the four-corner anchor contract — it mirrors the
          `.map-error-overlay` precedent (App.tsx data-error overlay): a focused,
          recoverable card floating over the still-mounted map, NOT a blocking
          modal. Surfaced when the watchdog times out or M consecutive basemap-
          source errors land. Retry re-sets the current-theme style and re-arms
          the watchdog. Uses StatusBlock's first-class `action` prop — no
          hand-rolled retry button. */}
      {basemapFailed && (
        <div
          className="map-basemap-error"
          role="dialog"
          aria-modal="false"
          aria-label="Basemap error"
          data-testid="basemap-error-overlay"
        >
          <StatusBlock
            state="error"
            title="Basemap unavailable"
            body="The map background failed to load. Your connection or the tile provider may be temporarily unavailable."
            surface="overlay"
            action={{ label: 'Retry', onClick: handleBasemapRetry }}
          />
        </div>
      )}
    </div>
  );
}

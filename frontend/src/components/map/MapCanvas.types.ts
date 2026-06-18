// Type-only module extracted from MapCanvas.tsx (epic #884, U1 / #885).
//
// This holds the three top-level type declarations that have no runtime
// footprint — they are `import type`-erased at build. The heavy doc-comments
// are preserved verbatim: they encode the App.tsx scope/camera/artboard wiring
// contract (#736/#740/#760/#761/#782) and the popover-projection contract
// (#718), which the implementation in MapCanvas.tsx relies on.
//
// GeoJSON structural types come from `geojson` (@types/geojson), NOT maplibre-gl
// (5.x does not re-export them). All imports below are `import type`, erased at
// build — see mask.ts for the same idiom.
import type { MutableRefObject } from 'react';
import type { MultiPolygon } from 'geojson';
import type { RefObject } from 'react';
import type { AggregatedBucket, FamilySilhouette, Observation } from '@bird-watch/shared-types';
import type { SpeciesDictionary } from '@/data/use-species-dictionary.js';
import type { ViewboxCamera } from '@/state/viewbox-link.js';
import type { AdaptiveTile, ResolvedGrid } from './geometry/adaptive-grid.js';
import type { ThemeId } from './geometry/basemap-style.js';

/**
 * Resolved per-cluster adaptive data — the unit the Concern B cache stores
 * Promises of. `kind: 'pill'` is the pill-fallback sentinel (uniqueFamilies
 * > 16 OR pointCount > 64); `kind: 'grid'` carries the shape + tiles.
 */
export type ResolvedAdaptiveData =
  | { kind: 'pill'; uniqueFamilies: number }
  | {
      kind: 'grid';
      shape: ResolvedGrid;
      tiles: ReadonlyArray<AdaptiveTile>;
      uniqueFamilies: number;
      isNotablePoint: boolean;
    };

export interface MapCanvasProps {
  observations: Observation[];
  /**
   * Aggregated low-zoom buckets (#859). Populated only in `mode === 'aggregated'`
   * (z < 6); the map renders ONE clustered feature per bucket carrying its real
   * families/species, instead of per-observation rows. Empty / unused in
   * per-observation mode. Defaults to `[]` for legacy/test callers.
   */
  buckets?: AggregatedBucket[];
  /**
   * Which render path is active (#859). `'aggregated'` ⇒ feed `buckets` to the
   * cluster source + bucket-aware popovers; `'observations'` ⇒ the unchanged
   * per-observation path. Defaults to `'observations'`.
   */
  mode?: 'observations' | 'aggregated';
  /**
   * Species code→{comName} dictionary (#859) used to resolve the real species
   * names carried (as codes) in aggregated buckets. Tolerates a cold/empty Map
   * (rows fall back to the bare code, never crash). Unused in per-observation
   * mode. Defaults to an empty Map.
   */
  dictionary?: SpeciesDictionary;
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
  /**
   * Fired on every camera-settle `idle` event with the current bounds and
   * integer floor of the map zoom. Zoom was added in #627 so App.tsx can
   * forward it to /api/observations and trigger server-side aggregation at
   * low zoom (<6).
   */
  onViewportChange?: (bounds: import('maplibre-gl').LngLatBounds, zoom: number) => void;
  /**
   * Scope selector (#736 — Task C3). The `[[w,s],[e,n]]` envelope the camera
   * should both FRAME (`fitBounds`) and CLAMP (`maxBounds`). For a state scope
   * this is the state envelope (from `GET /api/states` `StateSummary.bbox`,
   * converted to `[[w,s],[e,n]]` order by App.tsx); for `?scope=us` it is the
   * CONUS envelope `[[-130,20],[-65,52]]`. When omitted (legacy callers —
   * MapSurface without scope wiring, skeletal unit tests) the camera keeps its
   * legacy uncontrolled CONUS `initialViewState` and clamps to `CONUS_BOUNDS`;
   * no scope reframe fires. Owned/passed by App.tsx (#740); the prop shape
   * mirrors the proven `ScopedMapProps` from the C0 prototype.
   */
  bounds?: [[number, number], [number, number]];
  /**
   * Changes on every scope change (e.g. the state code, or `'us'`). The single
   * `fitBounds` re-trigger key — it drives the camera effect without re-firing
   * on `bounds` array-reference churn. Pair with `bounds`.
   */
  boundsKey?: string;
  /**
   * Present on a ZIP scope: fly to this point at `ZIP_FLYTO_ZOOM` instead of
   * fitting the whole-state envelope. PREFERRED over `fitBounds` when both are
   * pending on the same (mount/ready) cycle — a ZIP is a "point inside the
   * state" intent that must win over the whole-state framing (finding (f)).
   * `center` is `[lng, lat]` (MapLibre order); `zoom` is `ZIP_FLYTO_ZOOM`;
   * `key` changes per ZIP entry to re-trigger the move.
   */
  flyTo?: { center: [number, number]; zoom: number; key: string } | undefined;
  /**
   * State-artboard mask (#760/#762). The selected state's render-only
   * MultiPolygon (from `useStatePolygon` → `/state-polygons.json`). When set,
   * MapCanvas paints a single inverse-mask fill — flat opaque theme-aware gray
   * everywhere EXCEPT this polygon — above the basemap and below the
   * observation/cluster layers, so the scope reads as a Sketch-style artboard.
   * `null`/absent (`?scope=us`, the chooser, or while the asset loads) renders
   * no mask AND leaves `renderWorldCopies` unforced (world copies stay on).
   */
  maskPolygon?: MultiPolygon | null;
  /**
   * State-artboard clamp padding (#760/#762). When present (state scope only),
   * the reactive `maxBounds` clamp is `padBounds(bounds, clampPad)` — the tight
   * state envelope expanded outward by `clampPad`× per side — so the user can
   * zoom OUT until the state shrinks on the gray field, bounded by the padded
   * artboard margin (not an infinite void). This is the single authoritative
   * zoom-out gate. The `fitBounds` ENTRY framing stays tight on the raw `bounds`
   * regardless. Absent (`?scope=us`, legacy callers) ⇒ the clamp stays the raw
   * `bounds ?? CONUS_BOUNDS` (unchanged behavior).
   */
  clampPad?: number;
  /**
   * #761 O6 (#782) → reversed by #976: true when a detail overlay
   * (SpeciesDetailRail / Sheet) is open under an active scope (App-level
   * `scopeActive && state.detail`). Forwarded VERBATIM to every
   * `<AdaptiveGridMarker>`. #782 originally SUPPRESSED the passive
   * `<CellHoverPreview>` mount in this state; #976 reverses that product
   * decision (hover-to-compare must work with a detail open). The preview now
   * ALWAYS mounts and this flag is forwarded as `belowDetail`, which DEMOTES
   * the tooltip beneath every detail surface (z `--z-under-detail`, below sheet
   * peek/half/full AND the rail) so it stays visible on the map but is occluded
   * wherever it overlaps the detail — honoring #782's anti-clutter intent
   * without suppression. The click-driven cell/cluster popovers are unaffected.
   * Defaults to `false` (legacy/test callers).
   */
  detailOpen?: boolean;
  /**
   * #1220 (C8) — the active basemap theme id, lifted to App.tsx (`useActiveThemeId`
   * seeded from `resolveInitialTheme`) so the <ThemeSelector> in <AppHeader> and
   * the id-keyed basemap swap here share ONE source of truth. When supplied it
   * seeds + drives the swap (so a stored `bright`/`liberty`/`fiord` and every
   * SAME-KIND switch reach the basemap). When OMITTED (legacy/test callers), the
   * component falls back to an internal `useActiveThemeId()` seeded from the
   * `[data-theme]` attribute — behavior-identical to pre-C8. Optional.
   */
  activeThemeId?: ThemeId;
  /**
   * #1242 (C4) — viewbox-restore wiring, forwarded VERBATIM from App.tsx via
   * MapSurface into `useScopeCamera`. The map camera is otherwise scope-derived;
   * these make a copied `#map=<z>/<lat>/<lng>` link self-restoring on cold load
   * and write the live camera back to the hash on user pan. All optional —
   * legacy/test callers omit them and the camera stays purely scope-driven.
   *   - `initialHashCamera` — the RAW camera App parsed ONCE (non-reactive) from
   *     `window.location.hash`; drives the first-paint frame + the imperative
   *     restore. `undefined` when there is no `#map=`.
   *   - `hashCameraInScope` — App's validation verdict of that camera's center
   *     against the resolved scope envelope (`null` while `/api/states` holds,
   *     `true` in-scope, `false` out-of-scope → fall back to the scope fit).
   *   - `writeBackGate` — App's live gate refs (`scopeActiveRef` +
   *     `scopeMoveUntilRef`) for the idle write-back; evaluated at `idle` time
   *     so the settle-window verdict is fresh, never stale-at-render.
   */
  initialHashCamera?: ViewboxCamera;
  hashCameraInScope?: boolean | null;
  writeBackGate?: {
    scopeActiveRef: RefObject<boolean>;
    scopeMoveUntilRef: RefObject<number>;
  };
  /**
   * C2 (#1240, epic #1238) — live-camera exposure for the "Copy link to this
   * view" control. `MapCanvas` holds the private MapLibre `getMap()` ref; the
   * header needs to read the LIVE camera (zoom/center/bearing/pitch) at click
   * time. Rather than convert this component to `forwardRef` (a large surface
   * threaded through MapSurface's React.lazy boundary), App passes a ref here
   * and MapCanvas populates `.current` with a LIVE getter that reads the map on
   * each call — `null` until the map is ready, then a fresh `ViewboxCamera` per
   * invocation. App reads it through the button's `getCamera` prop. Cleared to
   * `null` on unmount so a stale closure never reads a torn-down map. Optional;
   * legacy/test callers omit it.
   */
  cameraRef?: MutableRefObject<(() => ViewboxCamera | null) | null>;
}

/**
 * Issue #718: ObservationPopover state. Pairs the observation with the
 * projected screen position (px, relative to the .map-canvas wrapper)
 * computed at click time from the marker's lng/lat via map.project().
 *
 * The displaced-silhouette path (silhouetteOffsets.entries() render at
 * the bottom of MapCanvas) MUST pass `entry.longitude/entry.latitude`
 * (the displaced visual position) into openPopoverAt rather than the
 * obs's original survey point — otherwise the popover would project
 * from the hidden canvas-painted twin and appear offset from the
 * visible silhouette the user actually clicked.
 */
export interface SelectedObsState {
  obs: Observation;
  pos: { x: number; y: number };
}

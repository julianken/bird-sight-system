import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LngLatBounds } from 'maplibre-gl';
import { analytics } from './analytics.js';
import { ApiClient, ApiError } from './api/client.js';
import { useUrlState, DEFAULTS } from './state/url-state.js';
import type { Scope } from './state/url-state.js';
import type { ScopeResolution } from './state/scope-types.js';
import { useBirdData } from './data/use-bird-data.js';
import { useSilhouettes } from './data/use-silhouettes.js';
import { useStates } from './data/use-states.js';
import { useStatePolygon } from './data/state-polygons.js';
import { useSpeciesDetail } from './data/use-species-detail.js';
// ARTBOARD_PAD lives in the map's mask util but mask.ts imports only `geojson`
// *types* (erased at build), so this does NOT pull the lazy maplibre chunk into
// the entry bundle — App owns the scope→clampPad derivation (#760/#762).
import { ARTBOARD_PAD } from './components/map/mask.js';
import { FiltersBar } from './components/FiltersBar.js';
import { FamilyLegend } from './components/FamilyLegend.js';
import { MapSurface } from './components/MapSurface.js';
import { ScopeChooser } from './components/ScopeChooser.js';
import { SpeciesDetailRail } from './components/SpeciesDetailRail.js';
import { SpeciesDetailSheet } from './components/SpeciesDetailSheet.js';
import type { SnapState } from './components/SpeciesDetailSheet.js';
import { AppHeader } from './components/AppHeader.js';
import { useIsCompact } from './lib/use-is-compact.js';
import { useIsPhone } from './lib/use-is-phone.js';
import { AttributionModal } from './components/AttributionModal.js';
import { deriveFamilies, deriveSpeciesIndex } from './derived.js';
import { filterObservationsByBounds } from './lib/viewport-filter.js';
import { regionLabelFor } from './config/region.js';
import { prefetchMapCanvas } from './prefetch.js';
import { SurfaceTitleSync } from './components/SurfaceTitleSync.js';
import { StatusBlock } from './components/ds/StatusBlock.js';
import { deriveFreshness } from './lib/freshness.js';

const apiClient = new ApiClient({ baseUrl: import.meta.env.VITE_API_BASE_URL ?? '' });

/**
 * #740 (C6) — the whole-US (`?scope=us`) camera envelope, in MapLibre
 * `[[w,s],[e,n]]` order. This is the SAME production constant the C0 prototype
 * verified (`CONUS_BOUNDS` in `frontend/prototypes/scope-prototype/states.ts`)
 * and the MapCanvas `CONUS_BOUNDS` fallback (`frontend/src/components/map/
 * MapCanvas.tsx`). The camera both FRAMES (`fitBounds`) and CLAMPS
 * (`maxBounds`) to it for the whole-US view. Kept here (not imported from
 * MapCanvas) because MapCanvas's copy is the lazy-loaded map chunk's private
 * fallback; App owns the scope→bounds derivation and must not pull the map
 * chunk into the entry bundle just to read a constant.
 */
const CONUS_BOUNDS: [[number, number], [number, number]] = [[-130, 20], [-65, 52]];

/**
 * O2 (#770): Default-expanded breakpoint for FamilyLegend, moved here from
 * MapSurface so the legend can render as a persistent App-root sibling.
 *
 * Originally mirrored the global `(max-width: 760px)` mobile breakpoint, but
 * the CONUS default viewport puts the AZ-only data cluster in the lower-left
 * of the map — directly under the bottom-left FamilyLegend overlay. At
 * 768×1024 (iPad portrait) the expanded legend covers the only visible marker
 * on first paint. Lift the JS threshold to 1024 so tablet-portrait (and
 * narrower) start collapsed; tablet-landscape and desktop still default
 * expanded. localStorage `family-legend-expanded.v2` still overrides the
 * default once the user toggles.
 */
const LEGEND_EXPAND_MIN_WIDTH = 1024;

function readLegendDefaultExpanded(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    // SSR / jsdom-without-matchMedia — default to expanded so server-rendered
    // HTML matches the desktop fallback. The component re-evaluates from
    // localStorage on mount regardless.
    return true;
  }
  return window.matchMedia(`(min-width: ${LEGEND_EXPAND_MIN_WIDTH}px)`).matches;
}

/**
 * Maps an Error to a user-facing body string for the top-level error screen.
 * The title is always "Couldn't load bird data" (unchanged from existing copy).
 * The body replaces the raw error.message with a crafted string that matches
 * the Position B voice register (declarative, no apology language, no
 * exclamation marks).
 *
 * New error classes should be added here with a dated comment.
 * Voice spec: docs/design/01-spec/voice-and-content.md §Copy register inventory
 */
function craftedFromError(error: Error): string {
  const msg = error.message.toLowerCase();

  // Network failure (fetch failed, no connection)
  if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('err_connection')) {
    return 'The server could not be reached. Check your connection and try refreshing.';
  }

  // Request timeout / abort
  if (msg.includes('aborterror') || msg.includes('timed out') || msg.includes('timeout')) {
    return 'The request took too long. Try refreshing.';
  }

  // HTTP 5xx (server error passed through as a thrown Error)
  if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504')) {
    return 'The data service is temporarily unavailable. Try again in a moment.';
  }

  // Safe fallback — never expose the raw message
  return 'Something went wrong loading the bird data. Try refreshing.';
}

export function App() {
  const { state, set } = useUrlState();
  const isCompact = useIsCompact();
  // O5 (#783): phone-only hook keyed to ≤480px (P1's overlay breakpoint).
  // Deliberately separate from isCompact (1199px) so force-collapse does NOT
  // trigger on tablet (768×1024) or laptop (1024×768) viewports.
  const isPhone = useIsPhone();
  // Tag the current Clarity session with the active view so dashboards can
  // filter sessions by surface (map | detail). Fires on initial mount
  // and on every view change; analytics.setView no-ops safely when Clarity
  // isn't initialized (dev/test/missing project ID). PR #659 follow-up.
  useEffect(() => {
    analytics.setView(state.view);
  }, [state.view]);
  // Phase 3: filters panel state + badge count.
  const [filtersOpen, setFiltersOpen] = useState(false);

  // O7 (#786) — error overlay dismiss state. When the user dismisses the
  // overlay, the error is hidden but the last-good observations stay on the
  // live map. Resetting to `false` when the error clears (a successful retry
  // or a scope change that resolves the error) so stale dismissals don't
  // suppress genuine new errors. The error itself is cleared by `refetch`
  // (sets `setError(null)` before bumping the reload key).
  const [errorDismissed, setErrorDismissed] = useState(false);

  // O5 (#783) — track the detail sheet's snap state so forceCollapsed can be
  // computed. Starts at 'peek' (the sheet's initial snap); reset to 'peek'
  // when the sheet unmounts (detail closes). Only relevant on compact/mobile
  // viewports where the sheet renders instead of the rail.
  const [sheetSnap, setSheetSnap] = useState<SnapState>('peek');

  // O5 (#783) — forceCollapsed: collapse the legend while another overlay holds
  // focus on mobile (≤480px). Scoped to isPhone so it does NOT fire at 1024×768
  // (iPad landscape) or 1440×900 (laptop) — those use isCompact/rail, not isPhone.
  // Three overlay signals:
  //   - !scopeActive: S1 chooser scrim is open (unscoped landing)
  //   - filtersOpen: O4 filters sheet is open
  //   - sheetSnap !== 'peek': detail sheet is at half or full (not just peeking)
  // forceCollapsed is derived here (at render time) — no extra state needed.
  // The `scopeActive` ref is not yet available at this point; use
  // `state.scope.kind !== 'unscoped'` directly (same derivation as line 269).
  const legendForceCollapsed =
    isPhone && (
      state.scope.kind === 'unscoped' ||
      filtersOpen ||
      (sheetSnap === 'half' || sheetSnap === 'full')
    );

  // O4 (#780) — ref to the floating filters sheet panel. Focus moves into the
  // panel on open (specifically the close button, first focusable element).
  const filtersPanelRef = useRef<HTMLDivElement | null>(null);

  // O4 (#780) — tracks whether the filters sheet has ever been opened in this
  // session. Used to guard the close-path focus restore: we must NOT steal
  // focus to the trigger on the initial mount (when filtersOpen===false and
  // the effect fires for the first time). Focus restore only belongs on an
  // actual open→close TRANSITION.
  const hasOpenedFiltersRef = useRef(false);

  // O4 (#780) — inert + focus handshake for the filters floating sheet.
  //   Open: set `inert` on #map-layer (same target as S1 scrim / full-snap
  //         detail sheet); move focus into the sheet (close button); add a
  //         Tab/Shift+Tab wrap handler so focus cannot escape to AppHeader
  //         (mirrors the S1-scrim inert+focus-trap useLayoutEffect, deps: [scopeActive]).
  //   Close: remove `inert` from #map-layer; restore focus to the trigger
  //         ONLY when transitioning from open→close (not on initial mount).
  // useLayoutEffect so the DOM mutation (inert) lands before the browser
  // paints, matching SpeciesDetailSheet's sequencing discipline.
  useLayoutEffect(() => {
    const mapLayer = mapLayerRef.current;
    const panel = filtersPanelRef.current;

    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), ' +
      'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = (): HTMLElement[] =>
      panel ? Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector)) : [];

    if (filtersOpen) {
      // Record that the sheet has been opened at least once.
      hasOpenedFiltersRef.current = true;
      // Mute the map while filters sheet is open — O1 target is #map-layer.
      mapLayer?.setAttribute('inert', '');
      // Move focus into the sheet so keyboard users land inside the panel.
      // The close button is the first focusable element; focus it directly.
      const items = focusables();
      items[0]?.focus();

      // Trap Tab / Shift+Tab within the panel so focus cannot escape into
      // AppHeader siblings (Attribution, theme-toggle, scope-control).
      // `inert` on #map-layer covers only the map subtree; AppHeader sits
      // above the backdrop and stays tabbable without this wrap handler.
      // Pattern mirrors the S1-scrim onKeyDown wrap handler inside the
      // S1-scrim inert+focus-trap useLayoutEffect (deps: [scopeActive]).
      const onKeyDown = (e: KeyboardEvent): void => {
        if (e.key !== 'Tab') return;
        const items = focusables();
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) {
          e.preventDefault();
          return;
        }
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          // Backward from the first control (or from outside) → last.
          if (active === first || !panel!.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          // Forward from the last control (or from outside) → first.
          if (active === last || !panel!.contains(active)) {
            e.preventDefault();
            first.focus();
          }
        }
      };
      panel?.addEventListener('keydown', onKeyDown);

      // Cleanup: remove the wrap handler when the sheet closes or unmounts.
      return () => {
        panel?.removeEventListener('keydown', onKeyDown);
      };
    } else {
      // Remove inert from #map-layer on close — matches S1 scrim cleanup.
      mapLayer?.removeAttribute('inert');
      // Restore focus to the Filters trigger ONLY on an open→close transition,
      // never on the initial mount (where filtersOpen===false and the sheet was
      // never open). Without this guard, focus is stolen to the trigger on every
      // scoped page load. The S1 scrim effect early-returns on scopeActive and
      // does not override this, so the guard here is load-bearing.
      if (hasOpenedFiltersRef.current) {
        filtersTriggerRef.current?.focus();
      }
    }
  }, [filtersOpen]);

  // O4 (#780) — Escape key dismisses the filters sheet from anywhere (not
  // just when focus is inside the sheet, since inert mutes the map subtree
  // but AppHeader and other siblings remain interactive). Listening on the
  // document level (capture phase) matches the attribution modal pattern.
  useEffect(() => {
    if (!filtersOpen) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setFiltersOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [filtersOpen]);

  // Active-filter count: every non-default URL-state field counts as 1.
  // since !== '14d', notable, speciesCode, familyCode. Detail/view do not
  // count (they're navigation, not filter narrowing).
  const filterCount =
    (state.since !== '14d' ? 1 : 0) +
    (state.notable ? 1 : 0) +
    (state.speciesCode ? 1 : 0) +
    (state.familyCode ? 1 : 0);
  // CONUS bbox [west, south, east, north] — initial-mount default for
  // /api/observations. Matches MapCanvas's CONUS_LONGITUDE/CONUS_LATITUDE
  // initial view (zoom 3–4 framing); the map fires `idle` shortly after
  // mount with the actual fitted bounds, which then drives the bbox state
  // via `onViewportChange` below.
  const DEFAULT_BBOX_CONUS: [number, number, number, number] = [-125, 24, -66, 50];
  const [debouncedBbox, setDebouncedBbox] = useState<[number, number, number, number]>(DEFAULT_BBOX_CONUS);
  // Initial zoom mirrors MapCanvas's CONUS framing (zoom 3 narrow / 4 desktop).
  // The actual map reports a real value on first `idle`; meanwhile we send
  // 3 so the very first /api/observations call hits aggregated mode and never
  // pulls the full CONUS observation set on cold start. Issue #627.
  const [debouncedZoom, setDebouncedZoom] = useState<number>(3);

  // hotspots intentionally fetched but unused — cheap insurance for v2
  // hotspot-marker layer (Plan 7 decision 5, docs/plans/2026-04-22-plan-7-map-v1.md).
  // Phase 2 going-national pre-condition: viewport bbox is a hard input
  // to /api/observations so the frontend stops pulling the full CONUS
  // observation set on every map load. The bbox is held in a debounced
  // state (250ms) below; the value passed here is the debounced one so
  // continuous panning doesn't hammer the API. Initial value frames CONUS
  // (`DEFAULT_BBOX_CONUS`) rather than `undefined` — passing `undefined`
  // would degrade to a full-region fetch on first paint, exactly the
  // failure mode this wiring exists to prevent.
  // Issue #720: split loading into hotspots- vs observations-specific flags
  // because the cold-load lede guard (MapLede #716) must key off the
  // observation fetch specifically — under typical network conditions
  // hotspots resolves first, flipping a shared `loading` flag to false
  // while observations is still in flight and triggering the very
  // Template-1 misfire #716 set out to suppress. The MapLede and the
  // #map-layer aria-busy attribute narrate observation data, so they switch
  // to `observationsLoading` too. `loading` (combined) is retained for
  // `data-render-complete`, which tracks the whole tree being ready.
  // #740 (C6) — the scope gate. The observations (+ hotspots) fetch fires ONLY
  // once a scope exists; on the unscoped/chooser landing the cold-load CONUS
  // fetch is SUPPRESSED entirely (AC 1 — net /api/observations requests = 0).
  // The early `<ScopeChooser>` return below also unmounts the data-driven map,
  // but the fetch gate is the load-bearing half: it keeps the network panel
  // empty even though the hooks above this return are always evaluated.
  const scopeActive = state.scope.kind !== 'unscoped';
  // S4 (#769) — live-readable mirror of `scopeActive` for the empty-deps
  // `onViewportChange` callback (below). It is read through `.current` so the
  // callback can hard scope-gate WITHOUT taking `state.scope` as a dep (which
  // would re-create the `useCallback(…, [])` and risk the #690 bbox/zoom
  // de-pairing). Same per-render-assignment idiom as MapCanvas's
  // `onViewportChangeRef` (MapCanvas.tsx:1016-1017): assign on every render so
  // the ref always holds the current value by the time an `idle` fires.
  const scopeActiveRef = useRef(scopeActive);
  scopeActiveRef.current = scopeActive;
  // #740 (C6) — only a `?state=US-XX` scope sends `?state=` to the API (the
  // server clips via ST_Intersects). UNSCOPED and `?scope=us` both leave
  // `stateCode` unset, so the backend stays untouched (data invariant, #735).
  const scopeStateCode = state.scope.kind === 'state' ? state.scope.stateCode : undefined;
  const { loading, observationsLoading, error, observations, freshestObservationAt, refetch } = useBirdData(
    apiClient,
    {
      since: state.since,
      notable: state.notable,
      ...(state.speciesCode ? { speciesCode: state.speciesCode } : {}),
      ...(state.familyCode ? { familyCode: state.familyCode } : {}),
      ...(scopeStateCode ? { stateCode: scopeStateCode } : {}),
      bbox: debouncedBbox,
      zoom: debouncedZoom,
    },
    scopeActive,
  );

  // O9 (#781) — scope-gated MapCanvas chunk prefetch. `MapCanvas` (+ its ~273 kB
  // gzip `maplibre-gl` dep) is code-split behind the React.lazy boundary in
  // MapSurface.tsx; that boundary only STARTS the chunk fetch once <MapSurface>
  // mounts, i.e. after a scope is already chosen. Warm the chunk earlier — but
  // ONLY once a scope is known. This effect covers the SCOPED LANDING: a
  // `?state=`/`?scope=us` deep-link mounts with `scopeActive` already true, so
  // the warm-up fires on first paint instead of waiting for the map to mount.
  // It early-returns when unscoped, so the fetch-light chooser landing (#740/C6)
  // never warms the chunk. `prefetchMapCanvas` is idempotent (module-level
  // guard) — this effect and the scope-pick handlers below coalesce to one
  // underlying import(). The scope-pick handlers ALSO call it directly to shave
  // the extra render-commit latency between click and mount.
  useEffect(() => {
    if (!scopeActive) return;
    prefetchMapCanvas();
  }, [scopeActive]);

  // #740 (C6) — the CONUS state name + envelope table (#732/#748). Drives the
  // chooser/control `<select>` display names AND the per-state camera
  // `fitBounds`/`maxBounds` envelope. Cached for the tab lifetime (see
  // useStates). Threaded into regionLabelFor (state name) below.
  // #758: `error` is threaded into <ScopeChooser> so a terminal /api/states
  // outage shows an honest "Couldn't load states" placeholder instead of a
  // perpetual "Loading states…" — on failure `statesLoading` flips false but
  // `states` stays empty, so the loading copy would otherwise stick forever.
  const { states, loading: statesLoading, error: statesError } = useStates(apiClient);

  const families = useMemo(() => deriveFamilies(observations), [observations]);
  const speciesIndex = useMemo(() => deriveSpeciesIndex(observations), [observations]);

  // #738/C5: runtime region label for the active scope (#735). `null` ⟺
  // unscoped (the chooser landing) — every consumer degrades to no region
  // claim. #740 threads the `/api/states` name table (#732) so a `?state=US-XX`
  // scope resolves to the state name (e.g. "Arizona"); regionLabelFor falls
  // back to the bare `stateCode` while the table is still loading.
  const region = regionLabelFor(state.scope, states);

  // #738/C7: "no filters active" — the data-availability vs filter-narrowing
  // split (MapLede) keys off this. A request is unfiltered ONLY when no
  // species/family/notable filter is set AND `since` is the default. The
  // `since === DEFAULTS.since` comparison lives here (once, at the call site)
  // so MapLede stays presentational. DEFAULTS is the exported symbol (#735),
  // not a re-declared literal.
  const noFiltersActive =
    state.speciesCode === null &&
    state.familyCode === null &&
    state.notable === false &&
    state.since === DEFAULTS.since;

  // #740 (C6) — scope-derived camera intent, threaded MapSurface → MapCanvas
  // (#736 owns the imperative `fitBounds`/`flyTo`/reactive `maxBounds`). Two
  // values:
  //   - `scopeBounds` — the `[[w,s],[e,n]]` envelope the camera frames + clamps
  //     to. For `?scope=us` it is the CONUS production constant; for a
  //     `?state=US-XX` scope it is the state envelope from `/api/states`
  //     (`StateSummary.bbox` is `[w,s,e,n]`, converted to `[[w,s],[e,n]]`).
  //     `undefined` while unscoped (the map is unmounted then anyway).
  //   - `boundsKey`   — the single `fitBounds` re-trigger key: it changes once
  //     per scope change (the state code, or `'us'`) so MapCanvas's
  //     camera-intent effect (keyed on `boundsKey`) fires EXACTLY once per
  //     scope change, not on `scopeBounds` array-reference churn (gotcha 1/4).
  const { scopeBounds, boundsKey } = useMemo<{
    scopeBounds: [[number, number], [number, number]] | undefined;
    boundsKey: string | undefined;
  }>(() => {
    if (state.scope.kind === 'us') {
      return { scopeBounds: CONUS_BOUNDS, boundsKey: 'us' };
    }
    if (state.scope.kind === 'state') {
      const { stateCode } = state.scope;
      const summary = states.find(s => s.stateCode === stateCode);
      if (summary) {
        const [w, s, e, n] = summary.bbox;
        return { scopeBounds: [[w, s], [e, n]], boundsKey: stateCode };
      }
      // States table not loaded yet — frame CONUS as a holding pattern and key
      // on the state code so the camera re-frames once the envelope arrives
      // (boundsKey already carries the code, so the effect re-runs).
      return { scopeBounds: CONUS_BOUNDS, boundsKey: stateCode };
    }
    // unscoped — no scope camera (the chooser is shown, the map is unmounted).
    return { scopeBounds: undefined, boundsKey: undefined };
  }, [state.scope, states]);

  // #760/#762 — state-artboard mask. A `?state=US-XX` scope (and the state a ZIP
  // resolves into, which is also a `state` scope) gets the inverse mask: the
  // exterior is painted flat opaque gray and the camera can zoom out onto that
  // gray field (clamp padded by ARTBOARD_PAD). `?scope=us` and the chooser get
  // no mask (and `renderWorldCopies` stays unforced). `useStatePolygon`
  // lazy-fetches the render-only polygon from the static `/state-polygons.json`
  // asset (module-cached, single fetch per tab); it returns `null` for a null
  // code, an unknown code, or while loading — in which case MapCanvas simply
  // renders no mask (degrades to the plain view).
  const isStateScope = state.scope.kind === 'state';
  const statePolygon = useStatePolygon(
    state.scope.kind === 'state' ? state.scope.stateCode : null,
  );

  // #740 (C6) — a transient ZIP `flyTo` staged by `onResolve`. NOT URL state
  // (`?zip=` is never persisted, locked decision #5) — it lives in component
  // state and is re-triggered by its `key`. PREFERRED over the whole-state
  // `fitBounds` when both are pending on the same chooser→map mount (gotcha 2 /
  // finding (f)): a ZIP is a "point inside the state" intent that must win over
  // the whole-state framing. The MapCanvas camera-intent effect (keyed on
  // `flyTo?.key`) implements the preference; App just stages it.
  const [flyTo, setFlyTo] = useState<
    { center: [number, number]; zoom: number; key: string } | undefined
  >(undefined);

  // Resolve human-readable family name when a familyCode filter is active.
  // Derived from families (prettyFamily-capitalised code from deriveFamilies).
  const familyName = useMemo(
    () => (state.familyCode ? families.find(f => f.code === state.familyCode)?.name : undefined),
    [families, state.familyCode],
  );

  // Issue #351: viewport-aware FamilyLegend counts. MapCanvas reports
  // the current bounds on each `idle` (camera-change settle) via
  // onViewportChange; we hold that here so the FamilyLegend can render
  // counts narrating what's in view, while MapCanvas itself continues
  // to render the full observation set (clustering math depends on a
  // stable observations identity).
  //
  // No reset effect on view transitions: the `viewportBounds` value is
  // never read directly — only through the `viewportObservations` memo
  // below, which is gated on `state.view === 'map'`. Stale bounds left
  // in state when the user switches to the detail view are therefore
  // harmless; an explicit reset effect would race the memo on re-entry
  // and is unnecessary.
  const [viewportBounds, setViewportBounds] = useState<LngLatBounds | null>(null);
  // #663: the Map stays mounted on view === 'map' OR 'detail' (rail/sheet
  // coexist over it). The viewport-bounds filter applies in both cases.
  const mapVisible = state.view === 'map' || state.view === 'detail';

  // O2 (#770): compute the legend's expand-by-default once at mount. The
  // component itself (FamilyLegend) handles localStorage precedence + manual
  // toggle. Evaluated here (App level) because the legend is now an App-root
  // sibling, not a child of MapSurface.
  const legendDefaultExpanded = useMemo(readLegendDefaultExpanded, []);

  const viewportObservations = useMemo(
    () =>
      mapVisible && viewportBounds
        ? filterObservationsByBounds(observations, viewportBounds)
        : observations,
    [observations, viewportBounds, mapVisible],
  );
  // Debounced bbox derivation: MapLibre's `idle` event already fires once
  // per camera settle (not per-frame), but we add a 250ms trailing-edge
  // debounce on top so rapid pan→zoom→pan sequences only trigger a single
  // /api/observations fetch. See `useBirdData` which receives `debouncedBbox`
  // via the filters object.
  const bboxDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (bboxDebounceRef.current !== null) clearTimeout(bboxDebounceRef.current);
    },
    []
  );
  // #740 (C6) gotcha 4 — "one refetch per scope change". A `?state`/scope
  // change is a DISCRETE URL-state transition, NOT a viewport event, so the
  // 250ms `bboxDebounceRef` (keyed on map pan/zoom `idle`) does NOT coalesce
  // it. The scope change itself is the single refetch trigger (via the
  // `stateCode`/`enabled` deps of useBirdData). The programmatic
  // `fitBounds`/`flyTo` that follows then settles and fires ONE `idle` →
  // `onViewportChange`; without a guard, that settle-frame would write a new
  // bbox/zoom and trigger a SECOND, mid-animation refetch for the same scope.
  //
  // The guard: `scopeMoveUntilRef` holds a timestamp through which idle-driven
  // bbox refetches are suppressed. It is set on every scope-framing change (the
  // boundsKey/flyTo effect below) to `now + SCOPE_MOVE_SETTLE_MS`, a window that
  // covers the whole programmatic camera animation (the ZIP `flyTo` is the
  // longest at 800ms; `fitBounds` is 600ms) PLUS the 250ms idle debounce
  // headroom — a one-shot counter is too fragile because a single
  // `fitBounds`/`flyTo` can emit MORE than one settle `idle` (the uncontrolled
  // `initialViewState` frame AND the imperative move each settle). Within the
  // window the settle idles still update `viewportBounds` (so the legend stays
  // correct) but do NOT schedule a bbox/zoom refetch — the scope change itself
  // is the single fetch trigger (via the `stateCode`/`enabled` deps of
  // useBirdData). After the window, genuine user pan/zoom within the scope
  // refetches normally. Unscoped (`boundsKey === undefined`) needs no
  // suppression here — but the reason is NO LONGER "the map is unmounted and no
  // idle fires." #761 (S1) made the map persistently mounted behind the chooser
  // scrim, so an unscoped map DOES emit `idle`. The unscoped no-op is now
  // enforced one level up by the `scopeActiveRef` early-return at the top of
  // `onViewportChange` below (S4, #769) — it returns before this window is even
  // read while unscoped, so `scopeMoveUntilRef` is never consulted on the
  // unscoped landing.
  const SCOPE_MOVE_SETTLE_MS = 1000;
  const scopeMoveUntilRef = useRef(0);
  useEffect(() => {
    if (boundsKey !== undefined) {
      scopeMoveUntilRef.current = Date.now() + SCOPE_MOVE_SETTLE_MS;
      // O1 (#776) — data-scope-fitted: reset to false on each new camera move,
      // then flip to true after the programmatic animation window expires.
      // Both this timer and scopeMoveUntilRef share SCOPE_MOVE_SETTLE_MS so
      // they settle in lockstep. This is an App-local timer — not driven by any
      // existing settle hook (onViewportChange swallows settle frames in the
      // window). Scoped-path-only: boundsKey is only defined when scoped.
      setDataScopeFitted(false);
      if (scopeFittedTimerRef.current !== null) clearTimeout(scopeFittedTimerRef.current);
      scopeFittedTimerRef.current = setTimeout(() => {
        setDataScopeFitted(true);
      }, SCOPE_MOVE_SETTLE_MS);
    }
    return () => {
      if (scopeFittedTimerRef.current !== null) clearTimeout(scopeFittedTimerRef.current);
    };
  }, [boundsKey, flyTo?.key]);
  const onViewportChange = useCallback((bounds: LngLatBounds, zoom: number) => {
    // S4 (#769) — hard scope-gate. #761 (S1) made the map persistently mounted
    // behind the chooser scrim, so a still-UNSCOPED map keeps emitting `idle`.
    // The `scopeMoveUntilRef` window below only covers the scope-framing settle
    // and historically assumed the map was UNMOUNTED while unscoped. Under the
    // always-mounted model an unscoped idle must do ZERO refetch work — not even
    // `setViewportBounds` or a `scopeMoveUntilRef` read — because
    // `useBirdData(enabled=false)` is a SINGLE backstop, not the load-bearing
    // gate (R1, the epic's highest risk). Returning here makes the two gates
    // independently sufficient: an unscoped idle cannot stage a bbox/zoom even
    // if a scope is then activated mid-pan.
    //
    // Skipping `setViewportBounds(bounds)` while unscoped is safe because of the
    // EMPTY-OBSERVATIONS invariant, NOT the `mapVisible` view-gate. `mapVisible`
    // (`state.view === 'map' || 'detail'`) is gated on VIEW, not scope — on the
    // unscoped landing the view is still `'map'`, so `mapVisible === true` and
    // it does not discriminate the unscoped case at all. The load-bearing reason
    // is that while unscoped `useBirdData(enabled=false)` leaves
    // `observations === []` (use-bird-data.ts:116, the `!enabled` short-circuit
    // at :148, and `setObservations([])` at :153), so the `viewportObservations`
    // memo computes `filterObservationsByBounds([], bounds) === []` independent
    // of `viewportBounds` — a stale/absent `viewportBounds` is therefore inert.
    // (Secondary, belt-and-suspenders: under S1 the inert scrim also suppresses
    // map-marker render and the FamilyLegend it feeds; but the primary safety
    // rests on the empty-observations invariant, not the scrim.)
    if (!scopeActiveRef.current) {
      return;
    }
    setViewportBounds(bounds);
    // Swallow the scope-change settle window: keep the legend's bounds fresh
    // (set above) but skip the bbox/zoom refetch while the programmatic camera
    // move is in flight (gotcha 4 — one refetch per scope change).
    if (Date.now() < scopeMoveUntilRef.current) {
      return;
    }
    const next: [number, number, number, number] = [
      bounds.getWest(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getNorth(),
    ];
    if (bboxDebounceRef.current !== null) clearTimeout(bboxDebounceRef.current);
    bboxDebounceRef.current = setTimeout(() => {
      // Issue #690: setDebouncedZoom MUST fire inside the same task as
      // setDebouncedBbox so {bbox, zoom} stays paired in the useBirdData
      // filters. Firing the zoom setter synchronously above (outside the
      // timeout) decoupled the pair — during the 250ms window the effect
      // would re-run with {bbox: STALE_previous_viewport, zoom: NEW_zoom},
      // which trips the server's bbox-area cap (services/read-api/src/
      // validate.ts assertBboxAreaCap: zoom ≥ 6 && lngSpan > 45 → 400
      // "bbox too large") on any zoom-in across the < 6 → ≥ 6 boundary.
      // React 18 automatic batching coalesces both setters into a single
      // render so useBirdData re-fires exactly once with a consistent pair.
      setDebouncedZoom(zoom);
      setDebouncedBbox(prev => {
        // No-op guard: skip the state update (and the consequent refetch)
        // if the bbox hasn't moved meaningfully. ~1e-4 degrees ≈ 10m at
        // mid-latitudes — well below user-visible pan, well above
        // floating-point jitter from repeated getBounds() calls.
        const epsilon = 1e-4;
        if (
          Math.abs(prev[0] - next[0]) < epsilon &&
          Math.abs(prev[1] - next[1]) < epsilon &&
          Math.abs(prev[2] - next[2]) < epsilon &&
          Math.abs(prev[3] - next[3]) < epsilon
        ) {
          return prev;
        }
        return next;
      });
    }, 250);
  }, []);

  // Family color + silhouette SOT (issue #55 option (a)): colors and
  // silhouette payloads resolve via the DB-backed `/api/silhouettes`
  // endpoint. The hook caches aggressively (response is static per deploy
  // + 1-week immutable Cache-Control) so mounting it here is effectively
  // free. Issue #249 threads the resulting `silhouettes` value to
  // MapSurface → FamilyLegend; descendants that need a color resolver
  // can still compose `buildFamilyColorResolver` from
  // `./data/family-color.js`. Single mount, prop-thread to consumers
  // (per #246's strict-mount discipline).
  const {
    silhouettes,
    loading: silhouettesLoading,
    error: silhouettesError,
  } = useSilhouettes(apiClient);

  // Active species meta for the detail view (issue #327 task-11). The
  // hook fires only when state.view === 'detail' AND state.detail is set
  // — passing `null` is a clean no-op. The Read API serves /api/species/:code
  // with `Cache-Control: max-age=31536000, immutable`, so the parallel
  // mount in SpeciesDetailSurface (which has its own per-instance cache)
  // hits the browser HTTP cache on the second fetch — no duplicate
  // network round-trip in practice. The threading exists to feed the
  // photo credit into AttributionModal's Photos section without forcing
  // a refactor of either the hook or SpeciesDetailSurface.
  // #663: detail is now an overlay, decoupled from view. Fetch species meta
  // whenever a detail code is set, regardless of view (map+detail coexist).
  const activeDetailCode = state.detail ? state.detail : null;
  const { data: activeSpeciesMeta } = useSpeciesDetail(apiClient, activeDetailCode);

  // FamilyLegend toggle: clear when the active family is clicked again,
  // otherwise set. Single source of truth for URL-state writes lives here;
  // FamilyLegend never calls useUrlState directly. Mirrors the
  // FiltersBar `onChange` pattern.
  const onFamilyToggle = useCallback(
    (code: string) => {
      set({ familyCode: state.familyCode === code ? null : code });
    },
    [set, state.familyCode],
  );

  // #740 (C6) — scope-selection callbacks shared by <ScopeChooser> (the landing
  // surface) and <ScopeControl> (the in-state on-map bar). Each emits ONE clean
  // URL-state transition; the components are purely presentational and never
  // touch the URL/map themselves.
  //
  // pick-state → `?state=US-XX`; pick-whole-US → `?scope=us`; ZIP onResolve →
  // `?state=US-XX` (NOT `?zip=`, locked decision #5) + a staged `flyTo` at
  // `ZIP_FLYTO_ZOOM`; clear-scope → `unscoped` (back to the CHOOSER, not a CONUS
  // home — AC "whole-US reset returns to the chooser", #741 e2e contract).
  const onPickState = useCallback(
    (stateCode: string) => {
      // O9 (#781) — warm the MapCanvas chunk on the click, ahead of the resulting
      // state change + <MapSurface> mount. Idempotent; the scopeActive effect
      // re-fires on the state change but the module-level guard no-ops it.
      prefetchMapCanvas();
      setFlyTo(undefined);
      set({ scope: { kind: 'state', stateCode } as Scope });
    },
    [set],
  );

  const onPickWholeUs = useCallback(() => {
    // O9 (#781) — warm the MapCanvas chunk on the click (see onPickState).
    prefetchMapCanvas();
    setFlyTo(undefined);
    set({ scope: { kind: 'us' } });
  }, [set]);

  const onResolveZip = useCallback(
    (resolution: ScopeResolution) => {
      // O9 (#781) — warm the MapCanvas chunk on the resolve (see onPickState).
      prefetchMapCanvas();
      // Set the state scope first (so `?state=` + the clip fetch land), then
      // stage the transient metro `flyTo`. MapCanvas's camera-intent effect
      // prefers the `flyTo` over the whole-state `fitBounds` on the same mount
      // (gotcha 2 / finding (f)). `key` is unique per resolution so re-entering
      // the same ZIP re-triggers the move.
      set({ scope: { kind: 'state', stateCode: resolution.stateCode } as Scope });
      setFlyTo({
        center: resolution.center,
        zoom: resolution.zoom,
        key: `${resolution.stateCode}:${resolution.center.join(',')}:${Date.now()}`,
      });
    },
    [set],
  );

  const onExitScope = useCallback(() => {
    setFlyTo(undefined);
    set({ scope: { kind: 'unscoped' } });
  }, [set]);

  // Phase 3: Attribution modal trigger — AppHeader's "Attribution" button
  // dispatches a click into the existing AttributionModal trigger inside the
  // footer (which remains rendered but visually de-emphasized). Phase 6 will
  // reconcile by removing the footer trigger and wiring a controlled-open API.
  // TODO(phase-6): replace this querySelector with a proper controlled-open prop.
  const onOpenAttribution = useCallback(() => {
    const trigger = document.querySelector<HTMLButtonElement>('.attribution-trigger');
    trigger?.click();
  }, []);

  const mainRef = useRef<HTMLElement | null>(null);

  // O1 (#776) — dedicated inert target for the map layer. Both the S1 unscoped
  // scrim and SpeciesDetailSheet (via the mainRef prop below) operate on this
  // wrapper so the live MapLibre canvas is frozen whenever a modal/scrim or a
  // full-snap detail sheet is active. `#main-surface` is kept as the readiness
  // gate (#586) and scroll-bypass affordance, but no longer receives `inert`.
  const mapLayerRef = useRef<HTMLDivElement | null>(null);

  // O4 (#780) — ref to the Filters trigger button in the top-right controls
  // pill. Held here so the filters-sheet close path can restore focus to the
  // trigger regardless of which dismiss mechanism fires (close button, backdrop
  // click, or Escape). AppHeader attaches this ref to the button element.
  // Typed as useRef<HTMLButtonElement>(null) → RefObject<HTMLButtonElement>
  // (current: HTMLButtonElement | null), matching AppHeaderProps.filtersTriggerRef.
  const filtersTriggerRef = useRef<HTMLButtonElement>(null);

  // O1 (#776) — camera data-attributes on #map-layer.
  // data-scope-fitted starts false on each new boundsKey/flyTo change and flips
  // true after SCOPE_MOVE_SETTLE_MS (the same window that suppresses idle refetch
  // in scopeMoveUntilRef). Driven by an App-local timer — not by any existing
  // settle hook (onViewportChange deliberately swallows settle frames).
  const [dataScopeFitted, setDataScopeFitted] = useState(false);
  const scopeFittedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // #761 (S1) — the unscoped landing is now an INERT, FOCUS-TRAPPED modal scrim
  // over a mounted-but-idle map (epic OQ1, option (a): modal-over-inert-map),
  // replacing the prior full-tree-unmount early-return. The map mounts behind
  // the scrim and fires ZERO /api/observations purely because `scopeActive ===
  // false` keeps `useBirdData`'s `enabled` false (the fetch gate above is the
  // load-bearing half — no render-gate change is needed to preserve the
  // #740/C6 zero-observations-on-landing AC). The scrim itself is rendered as a
  // floating sibling of <main> (the #663 floating-overlay pattern that
  // SpeciesDetailRail/Sheet already use) below.
  const scrimRef = useRef<HTMLDivElement | null>(null);

  // #761 (S1) — inert + focus-trap handshake for the unscoped scrim. Two
  // mechanisms, BOTH required by the focus-trap AC (they are distinct):
  //   (4) `inert` on #map-layer (O1 retarget from #main-surface) removes the
  //       live MapLibre canvas from the tab order and blocks pointer interaction
  //       while the scrim is open. The retarget freezes the map subtree wherever
  //       it sits (in-<main> pre-S2 or hoisted post-S2) — that's the whole point
  //       of the wrapper. Replicates the attribute-toggle pattern that
  //       SpeciesDetailSheet.tsx uses via the mapLayerRef prop (O1 unified target).
  //   (5a) Move initial focus into the scrim on mount — `inert` alone does NOT
  //       move focus, it only removes a subtree from the tab order. The focus
  //       landing target is the scrim wrapper itself (it carries `tabIndex={-1}`
  //       in the JSX below); the focus unit test keys off `scrimRef`/that
  //       wrapper holding focus.
  //   (5b) Trap Tab/Shift+Tab so focus cycles within the chooser and never
  //       escapes. `inert` on #map-layer covers the map subtree, but the
  //       ALWAYS-rendered shell now also mounts the <AppHeader> (wordmark,
  //       Attribution, Filters, ThemeToggle) AND the AttributionModal trigger as
  //       SIBLINGS of #map-layer — none of which #map-layer's `inert` covers.
  //       Rather than mark each of those inert, a keydown wrap handler on the
  //       scrim keeps focus inside the chooser regardless of what other focusable
  //       siblings exist (the defensive choice). `Escape` is deliberately NOT a
  //       dismiss path: there is no "no-scope" state to return to — the only
  //       exits are picking a scope.
  useLayoutEffect(() => {
    if (scopeActive) return;
    const mapLayer = mapLayerRef.current;
    const scrim = scrimRef.current;
    if (!scrim) return;

    // (4) Remove the map subtree from the tab order (O1: target is #map-layer).
    mapLayer?.setAttribute('inert', '');

    // The focusable descendants of the scrim, in DOM order. Recomputed inside
    // the handler so it stays correct if the chooser's controls change (e.g.
    // the state <select> enabling once /api/states resolves).
    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), ' +
      'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = (): HTMLElement[] =>
      Array.from(scrim.querySelectorAll<HTMLElement>(focusableSelector));

    // (5a) Move initial focus onto the scrim wrapper (the tabIndex={-1}
    // landing element). Keeping it on the wrapper rather than the first control
    // avoids stealing focus into the ZIP <input> on every render and matches
    // the focus unit test's target.
    scrim.focus();

    // (5b) Wrap Tab / Shift+Tab between the first and last focusable controls.
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return;
      const items = focusables();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        // Nothing focusable inside yet — keep focus pinned to the scrim.
        e.preventDefault();
        scrim.focus();
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        // Backward from the first control (or from the scrim wrapper) → last.
        if (active === first || active === scrim || !scrim.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !scrim.contains(active)) {
        // Forward from the last control (or from outside) → first.
        e.preventDefault();
        first.focus();
      }
    };
    scrim.addEventListener('keydown', onKeyDown);

    return () => {
      scrim.removeEventListener('keydown', onKeyDown);
      // Clearing `inert` happens when a scope is picked and the scrim unmounts
      // (this cleanup), or whenever `scopeActive` flips true.
      // O1: target is #map-layer, not #main-surface.
      mapLayer?.removeAttribute('inert');
    };
  }, [scopeActive]);

  // nowTick advances when the user returns to the tab so freshness labels
  // re-derive after the tab has been hidden for a long time. useRef(new Date())
  // would freeze `now` at first render and never advance — after 5 h open the
  // "Updated N min ago" label would stay stuck. Pattern A: bump on visibilitychange
  // (tab return is the primary freshness signal for a passive read-only UI).
  // Issue: #456 W3-A critic L3.
  const [nowTick, setNowTick] = useState(() => new Date());
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        setNowTick(new Date());
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);
  const now = nowTick;

  // Derive freshness state + label from meta.freshestObservationAt (#456 W3-A).
  // Uses the current `now` tick so the label re-derives on data fetch AND on
  // tab return (visibilitychange above). No polling interval needed.
  // Spec: docs/design/01-spec/voice-and-content.md §Freshness label state machine.
  const { state: freshnessState, label: freshnessLabel } = useMemo(
    () => deriveFreshness(freshestObservationAt, now),
    [freshestObservationAt, now],
  );

  // #800 / #779 — lede text computation for the AppHeader identity card.
  // Mirrors MapLede's template logic (now removed from MapSurface) so the
  // formerly-invisible context-strip content is lifted into the top-left card.
  // Returns null when region=null (unscoped) or while loading (cold-load guard).
  // Must come after freshnessState (computed above).
  const ledeText = useMemo<string | null>(() => {
    if (region === null) return null;
    const speciesCount = new Set(observations.map(o => o.speciesCode).filter(Boolean)).size;
    const observationCount = observations.length;
    // Cold-load guard (#716/#720): suppress Template 1 while the first fetch is
    // in flight. Same discipline as MapLede's `loading` guard.
    if (observationsLoading && observationCount === 0 && speciesCount === 0) return null;
    const speciesCommonName =
      speciesCount === 1 ? (observations[0]?.comName ?? null) : null;
    const periodText = state.since === '1d' ? '24 hours' : state.since.replace('d', ' days');
    const periodClause = freshnessState === 'stale' ? '' : ` in the last ${periodText}`;
    if (observationCount === 0 && speciesCount === 0) {
      return noFiltersActive
        ? `No recent sightings in ${region} yet.`
        : 'No sightings match your current filters.';
    } else if (speciesCommonName) {
      return `${observationCount} sightings of ${speciesCommonName} in ${region}${periodClause}.`;
    } else if (familyName) {
      return `${speciesCount} species of ${familyName} seen across ${region}${periodClause}.`;
    }
    return `${speciesCount} species seen across ${region}${periodClause}.`;
  }, [
    region,
    observations,
    observationsLoading,
    state.since,
    freshnessState,
    noFiltersActive,
    familyName,
  ]);

  // O1 (#776) — App-root polite aria-live result-settle narration (R9).
  // The AppHeader already announces scope changes ("Showing {region}"). This
  // region narrates the sightings-count/result settle ONCE per data load,
  // debounced to SCOPE_MOVE_SETTLE_MS so it fires only after the camera and
  // fetch both settle — not on every incremental render while loading.
  // It reuses ledeText (the same copy AppHeader displays) so the SR hears the
  // same summary a sighted user reads in the identity card, with no duplicate
  // narration vs the scope-change announcer (which announces the region name
  // while this announces the result count). Both are polite — they don't
  // interrupt; the SR hears: "Showing Arizona." → [data loads] → "{N} species …"
  const [settledLedeText, setSettledLedeText] = useState<string | null>(null);
  const ledeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // Only narrate once observations have settled (not while loading, not null).
    if (observationsLoading || ledeText === null) return;
    if (ledeDebounceRef.current !== null) clearTimeout(ledeDebounceRef.current);
    ledeDebounceRef.current = setTimeout(() => {
      setSettledLedeText(ledeText);
    }, SCOPE_MOVE_SETTLE_MS);
    return () => {
      if (ledeDebounceRef.current !== null) clearTimeout(ledeDebounceRef.current);
    };
  }, [ledeText, observationsLoading]);

  // #663: clicking a species in a popover opens the detail overlay
  // IN PLACE — the map stays mounted. New click flow writes only
  // `?detail=`; it does NOT write `?view=detail`. Old shared URLs that
  // include `?view=detail` continue to work via url-state's
  // backward-compat handling — see state/url-state.ts.
  const onSelectSpecies = useCallback(
    (speciesCode: string) => set({ detail: speciesCode }),
    [set],
  );

  // Close callback for detail rail/sheet wrappers (#663). The overlay
  // closes IN PLACE — return to whatever view was underneath (typically
  // 'map'). If the user landed via the legacy ?view=detail deep-link
  // (backward compat), reset to 'map' so they don't end up on a stale
  // detail-view shell with no detail code. The View union is now just
  // 'map' | 'detail', so 'map' is always the surface underneath.
  const onCloseDetail = useCallback(
    () => set({ view: state.view === 'detail' ? 'map' : state.view, detail: null }),
    [set, state.view],
  );

  // Log raw error details for debugging; show only a friendly message in UI.
  useEffect(() => {
    if (!error) return;
    if (error instanceof ApiError) {
      console.error(`API error ${error.status}: ${error.body}`);
    } else {
      console.error(error);
    }
  }, [error]);

  // O7 (#786) — reset the dismiss flag whenever the error clears (successful
  // retry or scope change). This ensures a new error after a dismissed one
  // will show the overlay again rather than staying suppressed.
  // Note: we use a ref to track the previous error value to avoid adding
  // `setErrorDismissed` to a stale closure. The standard pattern for
  // "react to a value clearing" is a separate effect keyed on the value.
  useEffect(() => {
    if (!error) {
      setErrorDismissed(false);
    }
  }, [error]);

  // #761 (S1) — the unscoped early-return is GONE. The `.app` shell now always
  // renders; the unscoped <ScopeChooser> is hosted as an inert, focus-trapped
  // modal scrim sibling of <main> (below), over a mounted-but-idle map. See the
  // inert/focus-trap `useLayoutEffect` above. The cold-load fetch stays
  // suppressed because `scopeActive === false` keeps `useBirdData`'s `enabled`
  // false (the #740/C6 zero-observations-on-landing AC is preserved, not
  // superseded). A `?detail=` riding an unscoped URL does NOT constitute a
  // scope: the detail rail/sheet render is gated on `scopeActive` below, so the
  // chooser scrim is the only overlay shown.
  //
  // O7 (#786): the error early-return has been REMOVED — replaced by a floating
  // dismissible overlay below. The shell+map render unconditionally so the map
  // is never torn down on a data-fetch failure. Retry calls `refetch()` in place
  // (camera preserved, no remount). Dismiss hides the overlay while leaving the
  // last-good `observations` on the live map.
  //
  // `scopeActive` gate is preserved: the overlay only renders on the
  // scoped/active path so a sticky error can't paint over the chooser scrim
  // (the same precedence the old early-return enforced).
  const showErrorOverlay = scopeActive && !!error && !errorDismissed;

  const renderComplete = !loading ? 'true' : 'false';

  return (
    <div className="app">
      <SurfaceTitleSync
        view={state.view}
        speciesCommonName={activeSpeciesMeta?.comName ?? null}
        region={region}
      />
      <AppHeader
        region={region}
        filterCount={filterCount}
        onOpenFilters={() => setFiltersOpen(true)}
        filtersOpen={filtersOpen}
        filtersTriggerRef={filtersTriggerRef}
        onOpenAttribution={onOpenAttribution}
        ledeText={ledeText}
        freshnessLabel={freshnessLabel}
        scope={state.scope}
        states={states}
        onPickState={onPickState}
        onPickWholeUs={onPickWholeUs}
        onExitScope={onExitScope}
        onResolveZip={onResolveZip}
      />
      {/* O2 (#770) — "Explore map markers" skip-link. WCAG 2.4.1 (Bypass
          Blocks): renders as the FIRST interactive App-root element after
          <AppHeader>, BEFORE <main id="main-surface"> and BEFORE #map-layer,
          so a fresh Tab into the scoped map view reaches this button BEFORE
          any ScopeControl or canvas element (DOM order determines tab order;
          position:fixed does NOT reorder focus). The skip-link activates
          focus on the first marker cell (the keyboard bypass for the 344-
          marker tap sequence). Gated on `mapVisible && scopeActive` so it
          does not render on the unscoped landing or the non-map view.
          The original "Skip to species list" skip-link was removed in #662. */}
      {mapVisible && scopeActive && (
        <button
          type="button"
          className="skip-link"
          data-testid="explore-map-markers-skip-link"
          aria-hidden={observations.length > 0 ? undefined : true}
          tabIndex={observations.length > 0 ? 0 : -1}
          onClick={() => {
            if (observations.length > 0) {
              const firstCell = document.querySelector(
                '[data-testid="adaptive-grid-marker-cell-rendered"], ' +
                '[data-testid="adaptive-grid-marker-cell-fallback"]',
              ) as HTMLElement | null;
              firstCell?.focus();
            }
          }}
        >
          Explore map markers
        </button>
      )}
      {/* O4 (#780) — Filters floating sheet. Replaces the old in-flow panel that
          displaced the map down. The sheet is `position: fixed` (see styles.css
          `.filters-panel`), anchored top-right under the controls pill, capped
          at `--card-maxw-rail` width so it never sprawls full-width on desktop.
          The backdrop covers the viewport at `--z-modal - 1` so it is below the
          sheet but above map overlays; clicking it dismisses the sheet.
          `inert` on #map-layer is managed by the useLayoutEffect above.
          The `role="region" aria-label="Filters"` accessible name is preserved
          exactly — the POM and history-nav.spec.ts resolve via
          `getByRole('region', { name: 'Filters' })`. */}
      {filtersOpen && (
        <>
          <div
            className="filters-backdrop"
            data-testid="filters-backdrop"
            onClick={() => setFiltersOpen(false)}
          />
          <div
            ref={filtersPanelRef}
            className="filters-panel"
            role="region"
            aria-label="Filters"
          >
            <button
              type="button"
              className="filters-panel-close"
              onClick={() => setFiltersOpen(false)}
              aria-label="Close filters"
            >
              ×
            </button>
            <FiltersBar
              since={state.since}
              notable={state.notable}
              speciesCode={state.speciesCode}
              familyCode={state.familyCode}
              families={families}
              speciesIndex={speciesIndex}
              onChange={set}
            />
          </div>
        </>
      )}
      {/* #761 (S2) — the map is the viewport-filling ROOT, no longer a windowed
          flex child of the padded `<main>`. The `{mapVisible && …}` block is
          HOISTED OUT of `<main>` into the fixed-inset `#map-layer` wrapper that
          renders as a SIBLING of `<main>` — the same `position: fixed` floating
          pattern the detail rail/sheet (#663) already use below. The chrome
          (AppHeader) floats over this layer on `--z-chrome`.

          The wrapper is MANDATORY, not optional: `ScopeControl` is a SIBLING of
          `MapSurface` (not a child of `.map-surface`), so its `position: absolute`
          offsets resolve against the nearest POSITIONED ancestor. `#map-layer`
          (`position: fixed; inset: 0`) is that ancestor — it equals the viewport,
          so ScopeControl anchors to the viewport top edge as before. Without the
          wrapper ScopeControl would lose its containing block (`.map-surface` is
          its sibling, not its ancestor).

          Always-mounted-under-scrim invariant (post-S1): `#map-layer` is gated
          ONLY by the existing `mapVisible` VIEW-tier gate (`'map' || 'detail'`,
          true on the scrim landing) — NOT by `scopeActive`. On the unscoped
          landing the map mounts idle behind S1's inert scrim; the `scopeActive`
          fetch gate (above) is the sole mechanism holding `/api/observations` at
          zero. Do NOT make `#map-layer` conditional on `scopeActive`. */}
      {mapVisible && (
        <div
          id="map-layer"
          ref={mapLayerRef}
          aria-busy={observationsLoading}
          {...(boundsKey !== undefined ? {
            'data-camera-bounds': boundsKey,
            'data-scope-fitted': String(dataScopeFitted),
          } : {})}
        >
          {/* #800 (S3): ScopeControl is now folded into the AppHeader identity
              card (spec §4.2) and rendered THERE — no longer a standalone
              floating overlay anchored top-center inside #map-layer. The header-
              height offset that the old position:absolute ScopeControl required
              is also deleted: corner cards have nothing to dodge. */}
          <MapSurface
            observations={observations}
            silhouettes={silhouettes}
            onSelectSpecies={onSelectSpecies}
            onViewportChange={onViewportChange}
            {...(scopeBounds ? { scopeBounds } : {})}
            {...(boundsKey !== undefined ? { boundsKey } : {})}
            {...(flyTo ? { flyTo } : {})}
            {...(statePolygon != null ? { maskPolygon: statePolygon } : {})}
            {...(isStateScope ? { clampPad: ARTBOARD_PAD } : {})}
            detailOpen={!!(scopeActive && state.detail)}
          />
        </div>
      )}
      {/* O7 (#786) — Data-fetch error overlay. Floats as a fixed sibling of
          #map-layer (same pattern as SpeciesDetailRail/Sheet) so the map
          stays mounted + interactive underneath. Gated on `showErrorOverlay`
          (= scopeActive && error && !dismissed) so it never paints over the
          chooser scrim (S1) — the same precedence the old early-return enforced
          by sitting after the unscoped fork.

          Z-tier: `--z-rail` (43) — above map-assist overlays (--z-overlay/40,
          --z-popover/41) and chrome (--z-chrome/42), but BELOW the detail
          rail/sheet and the S1 scrim (both on --z-modal/50). A data-fetch error
          is a focused card over a still-interactive map, not a blocking modal,
          so it sits at the rail tier (same as SpeciesDetailRail) rather than
          the modal tier. The `--z-rail` token is already stable from O5 (#783).
          If P1's named scale introduces a dedicated `--z-error-overlay`, re-point
          the CSS rule to that token in the follow-up PR. */}
      {showErrorOverlay && error && (
        <div
          className="map-error-overlay"
          role="dialog"
          aria-modal="false"
          aria-label="Bird data error"
          data-testid="error-overlay"
        >
          <StatusBlock
            state="error"
            title="Couldn't load bird data"
            body={craftedFromError(error)}
            surface="overlay"
            action={{ label: 'Retry', onClick: refetch }}
          />
          <button
            type="button"
            className="map-error-overlay__dismiss"
            aria-label="Dismiss error"
            onClick={() => setErrorDismissed(true)}
          >
            ×
          </button>
        </div>
      )}
      <main
        ref={mainRef}
        id="main-surface"
        data-render-complete={renderComplete}
        // aria-busy removed from <main> by O1 (#776) — re-homed to #map-layer
        // above so assistive tech announces "busy" against the region that is
        // actually changing (the map block), not the near-empty <main> shell.
        // Single-busy-node invariant: #map-layer is the sole aria-busy node.
        // axe `scrollable-region-focusable` (WCAG 2.1.1): #main-surface
        // has `overflow: auto` so it can scroll when its content exceeds the
        // viewport. Keyboard users need to be able to focus the scrollable
        // region itself to scroll it. tabIndex={0} adds it to the tab order;
        // the container has no other interactive role.
        //
        // #761 (S2): the map + ScopeControl no longer render here — they were
        // hoisted into the fixed `#map-layer` wrapper above. `<main>` is kept
        // (with `id`, `data-render-complete`, `mainRef`, `tabIndex={0}`) as the
        // readiness gate (#586) and scroll-bypass affordance. O1 (#776) removed
        // the `inert` toggle from <main> (retargeted to #map-layer) and removed
        // `aria-busy` (re-homed to #map-layer). It now wraps only non-map view
        // surfaces; its `--space-lg` padding stays for any future non-map surface.
        tabIndex={0}
      />
      {/* O1 (#776) — App-root result-settle live region (R9). Announces the
          sightings-count/result summary once per settle, debounced to
          SCOPE_MOVE_SETTLE_MS. Complements AppHeader's scope-change announcer
          ("Showing {region}") — no duplicate: that fires on region change, this
          fires after data loads. Both are polite; SR hears both in sequence.
          Composes .sr-only only (no extra class needed — no map-specific
          positioning override required). */}
      <div role="status" aria-live="polite" className="sr-only">
        {settledLedeText ?? ''}
      </div>
      {/* O2 (#770) — FamilyLegend as a persistent App-root sibling (post-<main>),
          `position:fixed` bottom-left. Hoisted out of MapSurface so it persists
          across map↔detail transitions WITHOUT re-entering the lazy MapCanvas
          Suspense subtree. Gated on `mapVisible && scopeActive` to preserve
          current behavior (not on view=feed or while unscoped). The `<aside>`
          carries explicit `role="complementary"` with its `aria-labelledby`
          name ("Bird families in view") — mirroring SpeciesDetailRail's pattern.

          Inert/filters interaction (O5 #783): forceCollapsed suppresses the
          legend's entries list when another overlay holds focus on phone-sized
          viewports (≤480px). The stored `expanded` preference is NOT mutated —
          this is a transient display override. The focus-trap already prevents
          keyboard users from reaching the legend while overlays are open;
          forceCollapsed is the visual complement for pointer users. */}
      {mapVisible && scopeActive && (
        <FamilyLegend
          silhouettes={silhouettes}
          observations={viewportObservations}
          familyCode={state.familyCode}
          onFamilyToggle={onFamilyToggle}
          defaultExpanded={legendDefaultExpanded}
          forceCollapsed={legendForceCollapsed}
        />
      )}
      {/* #761 (S1) — detail rail/sheet gated on `scopeActive`. The unscoped
          early-return used to make these lines unreachable while unscoped; now
          that the shell always renders, a `?detail=` riding an unscoped URL
          would otherwise mount a SECOND top-layer overlay over the chooser
          scrim. The `scopeActive` gate stops that: detail is not a scope (AC
          "detail overlay does not by itself constitute a scope"), so the
          chooser scrim is the only overlay shown on the unscoped landing. */}
      {scopeActive && state.detail && !isCompact && (
        <SpeciesDetailRail
          key={state.detail}
          speciesCode={state.detail}
          apiClient={apiClient}
          onClose={onCloseDetail}
        />
      )}
      {scopeActive && state.detail && isCompact && (
        <SpeciesDetailSheet
          key={state.detail}
          speciesCode={state.detail}
          apiClient={apiClient}
          onClose={() => {
            // Reset snap tracker when the sheet closes so forceCollapsed
            // lifts on the next detail open. (O5 #783)
            setSheetSnap('peek');
            onCloseDetail();
          }}
          mainRef={mapLayerRef}
          onSnapChange={setSheetSnap}
        />
      )}
      {/* #761 (S1) — the unscoped landing chooser, hosted as an INERT,
          FOCUS-TRAPPED modal scrim over the mounted-but-idle map. It renders as
          a floating sibling of <main> (the #663 floating-overlay pattern), NOT
          in place of the shell — the early-return that used to unmount the whole
          tree is gone. The scrim wrapper carries `tabIndex={-1}` so the
          inert/focus-trap effect above can land initial focus on it; the
          backdrop + above-the-overlays z-tier live in `.scope-chooser-scrim` in
          styles.css. `<ScopeChooser>` is unchanged — same callback props as
          before. Gated on `!scopeActive`: picking a scope (state/ZIP/whole-US)
          unmounts the scrim, clears `inert`, and the live-camera path animates
          with no shell remount. */}
      {!scopeActive && (
        <div
          ref={scrimRef}
          className="scope-chooser-scrim"
          tabIndex={-1}
        >
          <ScopeChooser
            states={states}
            statesLoading={statesLoading}
            statesError={statesError}
            onPickState={onPickState}
            onPickWholeUs={onPickWholeUs}
            onResolve={onResolveZip}
          />
        </div>
      )}
      {/*
        Phase 6: Footer removed. The Attribution trigger moved to <AppHeader>
        in Phase 3 — reachable from every view (map|detail), meeting
        the eBird ToU §3 and CC BY-SA §4(b/c) prominence requirement.

        <AttributionModal> is mounted here (outside any landmark container)
        so it remains in the DOM on all surfaces. The AppHeader "Attribution"
        button fires onOpenAttribution → clicks the modal's own trigger button
        (.attribution-trigger). Phase 6 retains the Phase 3 querySelector
        shim; a follow-up PR can replace it with a proper controlled-open prop.

        Silhouettes and photo-credit props threaded as before (issue #274,
        issue #327 task-11).
      */}
      <AttributionModal
        silhouettes={silhouettes}
        loading={silhouettesLoading}
        error={silhouettesError}
        photoAttribution={activeSpeciesMeta?.photoAttribution}
        photoLicense={activeSpeciesMeta?.photoLicense}
      />
    </div>
  );
}

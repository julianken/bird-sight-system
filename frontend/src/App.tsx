import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LngLatBounds } from 'maplibre-gl';
import { analytics } from './analytics.js';
import { ApiClient, ApiError } from './api/client.js';
import { useUrlState, DEFAULTS } from './state/url-state.js';
import type { Since, BBox, Scope } from './state/url-state.js';
import type { ScopeResolution } from './state/scope-types.js';
import { useBirdData } from './data/use-bird-data.js';
import { useSilhouettes } from './data/use-silhouettes.js';
import { useStates } from './data/use-states.js';
import { useSpeciesDetail } from './data/use-species-detail.js';
import { FiltersBar } from './components/FiltersBar.js';
import { FeedSurface } from './components/FeedSurface.js';
import { MapSurface } from './components/MapSurface.js';
import { ScopeChooser } from './components/ScopeChooser.js';
import { ScopeControl } from './components/ScopeControl.js';
import { SpeciesDetailRail } from './components/SpeciesDetailRail.js';
import { SpeciesDetailSheet } from './components/SpeciesDetailSheet.js';
import { AppHeader } from './components/AppHeader.js';
import { useIsCompact } from './lib/use-is-compact.js';
import { AttributionModal } from './components/AttributionModal.js';
import { deriveFamilies, deriveSpeciesIndex } from './derived.js';
import { filterObservationsByBounds } from './lib/viewport-filter.js';
import { regionLabelFor } from './config/region.js';
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
  // Tag the current Clarity session with the active view so dashboards can
  // filter sessions by surface (feed | map | detail). Fires on initial mount
  // and on every view change; analytics.setView no-ops safely when Clarity
  // isn't initialized (dev/test/missing project ID). PR #659 follow-up.
  useEffect(() => {
    analytics.setView(state.view);
  }, [state.view]);
  // Phase 3: filters panel state + badge count.
  const [filtersOpen, setFiltersOpen] = useState(false);
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
  // Template-1 misfire #716 set out to suppress. FeedSurface and the
  // <main aria-busy> attribute narrate observation data, so they switch
  // to `observationsLoading` too. `loading` (combined) is retained for
  // `data-render-complete`, which tracks the whole tree being ready.
  // #740 (C6) — the scope gate. The observations (+ hotspots) fetch fires ONLY
  // once a scope exists; on the unscoped/chooser landing the cold-load CONUS
  // fetch is SUPPRESSED entirely (AC 1 — net /api/observations requests = 0).
  // The early `<ScopeChooser>` return below also unmounts the data-driven map,
  // but the fetch gate is the load-bearing half: it keeps the network panel
  // empty even though the hooks above this return are always evaluated.
  const scopeActive = state.scope.kind !== 'unscoped';
  // #740 (C6) — only a `?state=US-XX` scope sends `?state=` to the API (the
  // server clips via ST_Intersects). UNSCOPED and `?scope=us` both leave
  // `stateCode` unset, so the backend stays untouched (data invariant, #735).
  const scopeStateCode = state.scope.kind === 'state' ? state.scope.stateCode : undefined;
  const { loading, observationsLoading, error, observations, freshestObservationAt } = useBirdData(
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

  // #740 (C6) — the CONUS state name + envelope table (#732/#748). Drives the
  // chooser/control `<select>` display names AND the per-state camera
  // `fitBounds`/`maxBounds` envelope. Cached for the tab lifetime (see
  // useStates). Threaded into regionLabelFor (state name) below.
  const { states, loading: statesLoading } = useStates(apiClient);

  const families = useMemo(() => deriveFamilies(observations), [observations]);
  const speciesIndex = useMemo(() => deriveSpeciesIndex(observations), [observations]);

  // Map the Since discriminant to bare-duration tokens used in lede templates.
  // These must be bare duration strings (e.g. "14 days") NOT noun phrases —
  // the lede template at FeedSurface reads "in the last {period}." which
  // would produce "in the last Last 14 days." with full noun phrases.
  // Spec: docs/design/01-spec/voice-and-content.md §Lede contract.
  const PERIOD_LABELS: Record<Since, string> = {
    '1d': '1 day',
    '7d': '7 days',
    '14d': '14 days',
  };
  const period = PERIOD_LABELS[state.since];

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

  // Resolve human-readable species name when a speciesCode filter is active.
  // Derived from speciesIndex — same source the FiltersBar autocomplete uses.
  const speciesName = useMemo(
    () => (state.speciesCode ? speciesIndex.find(s => s.code === state.speciesCode)?.comName : undefined),
    [speciesIndex, state.speciesCode],
  );

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
  // in state when the user switches to feed/detail views are therefore
  // harmless; an explicit reset effect would race the memo on re-entry
  // and is unnecessary.
  const [viewportBounds, setViewportBounds] = useState<LngLatBounds | null>(null);
  // #663: the Map stays mounted on view === 'map' OR 'detail' (rail/sheet
  // coexist over it). The viewport-bounds filter applies in both cases.
  const mapVisible = state.view === 'map' || state.view === 'detail';
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
  // suppression — the map is unmounted and no idle fires.
  const SCOPE_MOVE_SETTLE_MS = 1000;
  const scopeMoveUntilRef = useRef(0);
  useEffect(() => {
    if (boundsKey !== undefined) {
      scopeMoveUntilRef.current = Date.now() + SCOPE_MOVE_SETTLE_MS;
    }
  }, [boundsKey, flyTo?.key]);
  const onViewportChange = useCallback((bounds: LngLatBounds, zoom: number) => {
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
      setFlyTo(undefined);
      set({ scope: { kind: 'state', stateCode } as Scope });
    },
    [set],
  );

  const onPickWholeUs = useCallback(() => {
    setFlyTo(undefined);
    set({ scope: { kind: 'us' } });
  }, [set]);

  const onResolveZip = useCallback(
    (resolution: ScopeResolution) => {
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

  // #663: clicking a species in a popover opens the detail overlay
  // IN PLACE — the map stays mounted. New click flow writes only
  // `?detail=` (+ bbox); it does NOT write `?view=detail`. Old shared
  // URLs that include `?view=detail` continue to work via url-state's
  // backward-compat handling — see state/url-state.ts.
  const onSelectSpecies = useCallback(
    (speciesCode: string, bbox: BBox | null = null) =>
      set({ detail: speciesCode, bbox }),
    [set],
  );

  const onClearBbox = useCallback(() => {
    set({ bbox: null });
  }, [set]);

  // Close callback for detail rail/sheet wrappers (#663). The overlay
  // closes IN PLACE — return to whatever view was underneath (typically
  // 'map'). If the user landed via the legacy ?view=detail deep-link
  // (backward compat), reset to 'map' so they don't end up on a stale
  // detail-view shell with no detail code. Note: #662 removed Feed as a
  // user-visible surface, so we never land on 'feed' here.
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

  // #740 (C6) — chooser-first landing (locked decision 4b). When unscoped,
  // render <ScopeChooser> IN PLACE OF the map surface; picking a scope mounts
  // the map fresh (the validated chooser-gated REMOUNT model, finding (f)).
  // This return is placed BEFORE the error guard so it takes precedence:
  //   - The cold-load fetch is already suppressed (scopeActive === false), so
  //     the chooser landing makes zero /api/observations requests (AC 1).
  //   - Clearing the scope (the ScopeControl exit, AC "whole-US reset returns
  //     to the chooser") routes here even if a prior scoped session left a
  //     sticky `error` in useBirdData — the chooser is the destination, not the
  //     error screen.
  //   - A `?detail=` that somehow rides an unscoped URL does NOT constitute a
  //     scope (AC "detail overlay does not by itself constitute a scope") — the
  //     chooser still wins.
  if (state.scope.kind === 'unscoped') {
    return (
      <ScopeChooser
        states={states}
        statesLoading={statesLoading}
        onPickState={onPickState}
        onPickWholeUs={onPickWholeUs}
        onResolve={onResolveZip}
      />
    );
  }

  if (error) {
    return (
      <StatusBlock
        state="error"
        title="Couldn't load bird data"
        body={craftedFromError(error)}
      />
    );
  }

  const renderComplete = !loading ? 'true' : 'false';

  return (
    <div className="app">
      <SurfaceTitleSync
        view={state.view}
        speciesCommonName={activeSpeciesMeta?.comName ?? null}
        region={region}
      />
      <AppHeader
        activeView={state.view}
        onSelectView={view => set({ view })}
        region={region}
        filterCount={filterCount}
        onOpenFilters={() => setFiltersOpen(true)}
        onOpenAttribution={onOpenAttribution}
      />
      {filtersOpen && (
        <div className="filters-panel" role="region" aria-label="Filters">
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
      )}
      <main
        ref={mainRef}
        id="main-surface"
        data-render-complete={renderComplete}
        aria-busy={observationsLoading && state.view === 'feed'}
        // axe `scrollable-region-focusable` (WCAG 2.1.1): #main-surface
        // has `overflow: auto` so it can scroll when its content (e.g.
        // species detail with photo) exceeds the viewport. Keyboard users
        // need to be able to focus the scrollable region itself to scroll
        // it. tabIndex={0} adds it to the tab order; the container has no
        // other interactive role.
        tabIndex={0}
      >
        {state.view === 'feed' && (
          <FeedSurface
            loading={observationsLoading}
            observations={observations}
            now={now}
            filters={{ notable: state.notable, since: state.since, speciesCode: state.speciesCode, familyCode: state.familyCode }}
            onSelectSpecies={onSelectSpecies}
            speciesIndex={speciesIndex}
            observationCount={observations.length}
            regionLabel={region}
            period={period}
            freshness={freshnessState}
            freshnessLabel={freshnessLabel}
            silhouettes={silhouettes}
            {...(speciesName !== undefined ? { speciesName } : {})}
            {...(familyName !== undefined ? { familyName } : {})}
          />
        )}
        {mapVisible && (
          <>
            {/* #740 (C6) — the in-state on-map re-scope bar (#737). Rendered
                ONLY in a scoped view (guaranteed here: the unscoped early-return
                above shows the chooser instead). Floats over the canvas; emits
                one clean scope intent per action and never touches the map.
                `state.scope` is narrowed to a ScopedView since unscoped already
                returned. */}
            <ScopeControl
              scope={state.scope}
              states={states}
              onPickState={onPickState}
              onPickWholeUs={onPickWholeUs}
              onExit={onExitScope}
              onResolve={onResolveZip}
            />
            <MapSurface
              observations={observations}
              legendObservations={viewportObservations}
              silhouettes={silhouettes}
              familyCode={state.familyCode}
              onFamilyToggle={onFamilyToggle}
              onSelectSpecies={onSelectSpecies}
              onViewportChange={onViewportChange}
              onExploreMapMarkers={() => {
                const firstCell = document.querySelector(
                  '[data-testid="adaptive-grid-marker-cell-rendered"], ' +
                  '[data-testid="adaptive-grid-marker-cell-fallback"]'
                ) as HTMLElement | null;
                firstCell?.focus();
              }}
              hasMarkers={observations.length > 0}
              since={state.since}
              notable={state.notable}
              speciesCode={state.speciesCode}
              {...(speciesName !== undefined ? { speciesName } : {})}
              freshness={freshnessState}
              freshnessLabel={freshnessLabel}
              loading={observationsLoading}
              region={region}
              noFiltersActive={noFiltersActive}
              {...(scopeBounds ? { scopeBounds } : {})}
              {...(boundsKey !== undefined ? { boundsKey } : {})}
              {...(flyTo ? { flyTo } : {})}
            />
          </>
        )}
        {/*
          #663 — detail surface routing. The body component
          (SpeciesDetailSurface) renders inside one of two wrappers:
          a side rail (<aside>) on ≥1200px viewports, a bottom-sheet
          on ≤1199px. Selection drives off useIsCompact.
          The wrappers render OUTSIDE <main>: both sit as siblings of
          <main> so the Map stays mounted and interactive underneath
          (no inert backdrop, no top-layer takeover).
        */}
      </main>
      {state.detail && !isCompact && (
        <SpeciesDetailRail
          key={state.detail}
          speciesCode={state.detail}
          apiClient={apiClient}
          onClose={onCloseDetail}
          bbox={state.bbox}
          onClearBbox={onClearBbox}
        />
      )}
      {state.detail && isCompact && (
        <SpeciesDetailSheet
          key={state.detail}
          speciesCode={state.detail}
          apiClient={apiClient}
          onClose={onCloseDetail}
          mainRef={mainRef}
          bbox={state.bbox}
          onClearBbox={onClearBbox}
        />
      )}
      {/*
        Phase 6: Footer removed. The Attribution trigger moved to <AppHeader>
        in Phase 3 — reachable from every view (map|feed|detail), meeting
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

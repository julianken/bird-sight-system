import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LngLatBounds } from 'maplibre-gl';
import { analytics } from './analytics.js';
import { ApiClient, ApiError } from './api/client.js';
import { useUrlState } from './state/url-state.js';
import type { Since, BBox } from './state/url-state.js';
import { useBirdData } from './data/use-bird-data.js';
import { useSilhouettes } from './data/use-silhouettes.js';
import { useSpeciesDetail } from './data/use-species-detail.js';
import { FiltersBar } from './components/FiltersBar.js';
import { FeedSurface } from './components/FeedSurface.js';
import { MapSurface } from './components/MapSurface.js';
import { SpeciesDetailRail } from './components/SpeciesDetailRail.js';
import { SpeciesDetailSheet } from './components/SpeciesDetailSheet.js';
import { AppHeader } from './components/AppHeader.js';
import { useIsCompact } from './lib/use-is-compact.js';
import { AttributionModal } from './components/AttributionModal.js';
import { deriveFamilies, deriveSpeciesIndex } from './derived.js';
import { filterObservationsByBounds } from './lib/viewport-filter.js';
import { REGION_LABEL } from './config/region.js';
import { SurfaceTitleSync } from './components/SurfaceTitleSync.js';
import { StatusBlock } from './components/ds/StatusBlock.js';
import { deriveFreshness } from './lib/freshness.js';

const apiClient = new ApiClient({ baseUrl: import.meta.env.VITE_API_BASE_URL ?? '' });

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
  const { loading, error, observations, freshestObservationAt } = useBirdData(apiClient, {
    since: state.since,
    notable: state.notable,
    ...(state.speciesCode ? { speciesCode: state.speciesCode } : {}),
    ...(state.familyCode ? { familyCode: state.familyCode } : {}),
    bbox: debouncedBbox,
    zoom: debouncedZoom,
  });

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
  const onViewportChange = useCallback((bounds: LngLatBounds, zoom: number) => {
    setViewportBounds(bounds);
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
      />
      <AppHeader
        activeView={state.view}
        onSelectView={view => set({ view })}
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
        aria-busy={loading && state.view === 'feed'}
        // axe `scrollable-region-focusable` (WCAG 2.1.1): #main-surface
        // has `overflow: auto` so it can scroll when its content (e.g.
        // species detail with photo + phenology chart) exceeds the
        // viewport. Keyboard users need to be able to focus the
        // scrollable region itself to scroll it. tabIndex={0} adds it to
        // the tab order; the container has no other interactive role.
        tabIndex={0}
      >
        {state.view === 'feed' && (
          <FeedSurface
            loading={loading}
            observations={observations}
            now={now}
            filters={{ notable: state.notable, since: state.since, speciesCode: state.speciesCode, familyCode: state.familyCode }}
            onSelectSpecies={onSelectSpecies}
            speciesIndex={speciesIndex}
            observationCount={observations.length}
            regionLabel={REGION_LABEL}
            period={period}
            freshness={freshnessState}
            freshnessLabel={freshnessLabel}
            silhouettes={silhouettes}
            {...(speciesName !== undefined ? { speciesName } : {})}
            {...(familyName !== undefined ? { familyName } : {})}
          />
        )}
        {mapVisible && (
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
          />
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

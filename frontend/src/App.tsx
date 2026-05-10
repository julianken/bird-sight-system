import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LngLatBounds } from 'maplibre-gl';
import { ApiClient, ApiError } from './api/client.js';
import { useUrlState } from './state/url-state.js';
import { useBirdData } from './data/use-bird-data.js';
import { useSilhouettes } from './data/use-silhouettes.js';
import { useSpeciesDetail } from './data/use-species-detail.js';
import { FiltersBar } from './components/FiltersBar.js';
import { FeedSurface } from './components/FeedSurface.js';
import { MapSurface } from './components/MapSurface.js';
import { SpeciesSearchSurface } from './components/SpeciesSearchSurface.js';
import { SpeciesDetailModal } from './components/SpeciesDetailModal.js';
import { AppHeader } from './components/AppHeader.js';
// SurfaceNav import retained — component still exists; App no longer mounts
// it directly (moved to AppHeader). Defer deletion to a follow-up sweep once
// confirmed no other consumer uses it. (Phase 3)
import { SurfaceNav as _SurfaceNav } from './components/SurfaceNav.js';
import { useIsMobile } from './lib/use-is-mobile.js';
import { AttributionModal } from './components/AttributionModal.js';
import { deriveFamilies, deriveSpeciesIndex } from './derived.js';
import { filterObservationsByBounds } from './lib/viewport-filter.js';

const apiClient = new ApiClient({ baseUrl: import.meta.env.VITE_API_BASE_URL ?? '' });

export function App() {
  const { state, set } = useUrlState();
  const isMobile = useIsMobile();
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
  // hotspots intentionally fetched but unused — cheap insurance for v2
  // hotspot-marker layer (Plan 7 decision 5, docs/plans/2026-04-22-plan-7-map-v1.md).
  const { loading, error, observations } = useBirdData(apiClient, {
    since: state.since,
    notable: state.notable,
    ...(state.speciesCode ? { speciesCode: state.speciesCode } : {}),
    ...(state.familyCode ? { familyCode: state.familyCode } : {}),
  });

  const families = useMemo(() => deriveFamilies(observations), [observations]);
  const speciesIndex = useMemo(() => deriveSpeciesIndex(observations), [observations]);

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
  // in state when the user switches to feed/species/detail views are
  // therefore harmless; an explicit reset effect would race the memo on
  // re-entry and is unnecessary.
  const [viewportBounds, setViewportBounds] = useState<LngLatBounds | null>(null);
  const viewportObservations = useMemo(
    () =>
      state.view === 'map' && viewportBounds
        ? filterObservationsByBounds(observations, viewportBounds)
        : observations,
    [observations, viewportBounds, state.view],
  );
  const onViewportChange = useCallback((bounds: LngLatBounds) => {
    setViewportBounds(bounds);
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
  const activeDetailCode =
    state.view === 'detail' && state.detail ? state.detail : null;
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

  const nowRef = useRef(new Date());
  const now = nowRef.current;

  const onSelectSpecies = useCallback(
    (speciesCode: string) => set({ detail: speciesCode, view: 'detail' }),
    [set]
  );

  // Close callback for detail modal/sheet wrappers — flips back to feed view.
  const onCloseDetail = useCallback(
    () => set({ view: 'feed', detail: null }),
    [set],
  );

  /**
   * Skip-link handler (issue #247): switch to the feed view AND move
   * keyboard focus to the FeedSurface `<ol class="feed">` landmark so
   * (a) sighted-keyboard users see a clear focus jump, and (b) screen-
   * reader users get a landmark announcement. The setTimeout(_, 0)
   * defers the focus call past the next React commit, when the FeedSurface
   * `<ol>` has actually mounted. Using `requestAnimationFrame` would also
   * work; a 0ms timeout is the more portable signal across React 18 +
   * jsdom test environments.
   */
  const onSkipToFeed = useCallback(() => {
    set({ view: 'feed' });
    setTimeout(() => {
      const feedList = document.querySelector(
        'ol.feed[aria-label="Observations"]',
      );
      if (feedList instanceof HTMLElement) {
        // Lists are not focusable by default — set tabIndex first so the
        // browser actually moves focus and emits a focus event.
        if (!feedList.hasAttribute('tabindex')) {
          feedList.setAttribute('tabindex', '-1');
        }
        feedList.focus({ preventScroll: false });
      }
    }, 0);
  }, [set]);

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
      <div className="error-screen">
        <h2>Couldn't load bird data</h2>
        <p>{error.message}</p>
      </div>
    );
  }

  const renderComplete = !loading ? 'true' : 'false';

  return (
    <div className="app">
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
        id="main-surface"
        data-render-complete={renderComplete}
        aria-busy={loading && (state.view === 'feed' || state.view === 'species')}
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
            filters={{ notable: state.notable, since: state.since }}
            onSelectSpecies={onSelectSpecies}
            speciesIndex={speciesIndex}
          />
        )}
        {state.view === 'map' && (
          <MapSurface
            observations={observations}
            legendObservations={viewportObservations}
            silhouettes={silhouettes}
            familyCode={state.familyCode}
            onFamilyToggle={onFamilyToggle}
            onSkipToFeed={onSkipToFeed}
            onSelectSpecies={onSelectSpecies}
            onViewportChange={onViewportChange}
            since={state.since}
            notable={state.notable}
            freshness="fresh"
            freshnessLabel="Updated just now · Source: eBird"
          />
        )}
        {state.view === 'species' && (
          <SpeciesSearchSurface
            loading={loading}
            speciesCode={state.speciesCode}
            observations={observations}
            speciesIndex={speciesIndex}
            now={now}
            onSelectSpecies={onSelectSpecies}
          />
        )}
        {/*
          Sky Atlas Phase 4 — detail surface routing. The body component
          (SpeciesDetailSurface) renders inside one of two wrappers:
          a native <dialog> on desktop, a bottom-sheet on mobile.
          Selection drives off useIsMobile (max-width: 760px) — same
          breakpoint the rest of styles.css uses.
          The wrappers render OUTSIDE <main>: the modal portals via the
          top-layer (native <dialog>); the sheet sits as a sibling of
          <main> so `inert` can be applied to <main> without affecting
          the sheet. Both paths are mounted inside the .app shell.
        */}
      </main>
      {state.view === 'detail' && state.detail && !isMobile && (
        <SpeciesDetailModal
          key={state.detail}
          speciesCode={state.detail}
          apiClient={apiClient}
          onClose={onCloseDetail}
        />
      )}
      {/* Mobile sheet wired in task 5. */}
      {/*
        Persistent app-level footer (issue #250). Subsumes the per-surface
        SurfaceFooter from #243; the AttributionModal Credits trigger is
        reachable from every view (`view=map|feed|species|detail`) so the
        CC BY 3.0 / CC BY-SA 3.0 §4(c) prominence requirement is satisfied
        without abusing SurfaceNav's `role="tablist"` semantics.

        Position is load-bearing: must be the LAST child of `<div className=
        "app">` (after `</main>`). This gives both the right visual order
        (footer at viewport bottom via `.app` flex column + `#main-surface
        flex: 1`) and the axe-clean landmark order
        (main → contentinfo). Do NOT move it before FiltersBar / SurfaceNav.
      */}
      <footer role="contentinfo" className="app-footer">
        {/*
          Thread the silhouettes loading/error state into the modal so
          the Phylopic section surfaces an aria-live status during cache
          misses or API failures (issue #274). Without these props the
          modal would render an empty list while the fetch is in flight
          — looks like silhouettes don't exist.

          iNat photo credit (issue #327 task-11): the active SpeciesMeta
          carries optional `photoAttribution` + `photoLicense` fields
          when the detail-panel photo exists. Both must be present for
          the Photos section to render; either-absent collapses it.
          When `view !== 'detail'` or no species is selected,
          `activeSpeciesMeta` is null — both props pass `undefined`, so
          the section omits cleanly on every other view.
        */}
        <AttributionModal
          silhouettes={silhouettes}
          loading={silhouettesLoading}
          error={silhouettesError}
          photoAttribution={activeSpeciesMeta?.photoAttribution}
          photoLicense={activeSpeciesMeta?.photoLicense}
        />
      </footer>
    </div>
  );
}

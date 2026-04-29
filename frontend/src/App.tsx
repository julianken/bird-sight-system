import { useCallback, useEffect, useMemo, useRef } from 'react';
import { ApiClient, ApiError } from './api/client.js';
import { useUrlState } from './state/url-state.js';
import { useBirdData } from './data/use-bird-data.js';
import { useSilhouettes } from './data/use-silhouettes.js';
import { useSpeciesDetail } from './data/use-species-detail.js';
import { FiltersBar } from './components/FiltersBar.js';
import { FeedSurface } from './components/FeedSurface.js';
import { MapSurface } from './components/MapSurface.js';
import { SpeciesSearchSurface } from './components/SpeciesSearchSurface.js';
import { SpeciesDetailSurface } from './components/SpeciesDetailSurface.js';
import { SurfaceNav } from './components/SurfaceNav.js';
import { AttributionModal } from './components/AttributionModal.js';
import { deriveFamilies, deriveSpeciesIndex } from './derived.js';

const apiClient = new ApiClient({ baseUrl: import.meta.env.VITE_API_BASE_URL ?? '' });

export function App() {
  const { state, set } = useUrlState();
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

  const nowRef = useRef(new Date());
  const now = nowRef.current;

  const onSelectSpecies = useCallback(
    (speciesCode: string) => set({ detail: speciesCode, view: 'detail' }),
    [set]
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
      <FiltersBar
        since={state.since}
        notable={state.notable}
        speciesCode={state.speciesCode}
        familyCode={state.familyCode}
        families={families}
        speciesIndex={speciesIndex}
        onChange={set}
      />
      <SurfaceNav
        activeView={state.view}
        onSelectView={view => set({ view })}
      />
      <main
        id="main-surface"
        data-render-complete={renderComplete}
        aria-busy={loading && (state.view === 'feed' || state.view === 'species')}
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
            silhouettes={silhouettes}
            familyCode={state.familyCode}
            onFamilyToggle={onFamilyToggle}
            onSkipToFeed={onSkipToFeed}
            onSelectSpecies={onSelectSpecies}
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
        {state.view === 'detail' && state.detail && (
          <SpeciesDetailSurface
            speciesCode={state.detail}
            apiClient={apiClient}
          />
        )}
      </main>
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

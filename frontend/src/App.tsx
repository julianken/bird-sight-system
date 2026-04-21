import { useCallback, useMemo, useRef } from 'react';
import { ApiClient } from './api/client.js';
import { useUrlState, readMigrationFlag } from './state/url-state.js';
import { useBirdData } from './data/use-bird-data.js';
import { FiltersBar } from './components/FiltersBar.js';
import { FeedSurface } from './components/FeedSurface.js';
import { HotspotListSurface } from './components/HotspotListSurface.js';
import { SpeciesPanel } from './components/SpeciesPanel.js';
import { SurfaceNav } from './components/SurfaceNav.js';
import { MigrationBanner } from './components/MigrationBanner.js';
import { deriveFamilies, deriveSpeciesIndex } from './derived.js';

const apiClient = new ApiClient({ baseUrl: import.meta.env.VITE_API_BASE_URL ?? '' });

export function App() {
  const { state, set } = useUrlState();
  const { loading, error, observations, hotspots } = useBirdData(apiClient, {
    since: state.since,
    notable: state.notable,
    ...(state.speciesCode ? { speciesCode: state.speciesCode } : {}),
    ...(state.familyCode ? { familyCode: state.familyCode } : {}),
  });

  const families = useMemo(() => deriveFamilies(observations), [observations]);
  const speciesIndex = useMemo(() => deriveSpeciesIndex(observations), [observations]);

  // `now` is stable for the lifetime of the App mount. Passing a fresh
  // `new Date()` every render would defeat FeedRow/HotspotRow's memo (the
  // row's relative-time string is derived from `now`, so a new reference
  // invalidates every row). Relative labels like "15 min ago" don't tick —
  // they refresh on the next data fetch, which happens every time the user
  // touches a filter.
  const nowRef = useRef(new Date());
  const now = nowRef.current;

  // Stable reference — memoised rows bail out of re-rendering when neither
  // `observation` nor `now` nor `onSelectSpecies` changes identity. We set
  // ONLY `speciesCode` (not `view`) so the feed stays behind the panel:
  // SpeciesPanel mounts as a fixed-position overlay regardless of view.
  const onSelectSpecies = useCallback(
    (speciesCode: string) => set({ speciesCode }),
    [set]
  );

  if (error) {
    return (
      <div className="error-screen">
        <h2>Couldn't load bird data</h2>
        <p>{error.message}</p>
      </div>
    );
  }

  // `data-render-complete` is the e2e readiness gate (formerly the 9-region
  // count check). Stays `false` while loading OR before the first
  // observations fetch resolves, so specs can wait for `true` before
  // asserting. See frontend/e2e/pages/app-page.ts waitForAppReady().
  const renderComplete = !loading && observations !== null ? 'true' : 'false';

  return (
    <div className="app">
      <MigrationBanner show={readMigrationFlag()} />
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
        aria-busy={loading}
      >
        {/* Surface components: feed (#116) and hotspots (#117) land here.
            Species surface (#118) attaches alongside this block. */}
        {state.view === 'feed' && (
          <FeedSurface
            loading={loading}
            observations={observations}
            now={now}
            filters={{ notable: state.notable, since: state.since }}
            onSelectSpecies={onSelectSpecies}
          />
        )}
        {state.view === 'hotspots' && (
          <HotspotListSurface
            loading={loading}
            hotspots={hotspots}
            now={now}
          />
        )}
      </main>
      {/* Species detail panel — mounts unconditionally; the component
          returns null when speciesCode is null. Panel is URL-driven. */}
      <SpeciesPanel
        speciesCode={state.speciesCode}
        onDismiss={() => set({ speciesCode: null })}
        apiClient={apiClient}
      />
    </div>
  );
}

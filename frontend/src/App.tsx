import { useCallback, useMemo, useRef } from 'react';
import { ApiClient } from './api/client.js';
import { useUrlState, readMigrationFlag } from './state/url-state.js';
import { useBirdData } from './data/use-bird-data.js';
import { FiltersBar } from './components/FiltersBar.js';
import { FeedSurface } from './components/FeedSurface.js';
import { HotspotListSurface } from './components/HotspotListSurface.js';
import { SpeciesSearchSurface } from './components/SpeciesSearchSurface.js';
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

  const nowRef = useRef(new Date());
  const now = nowRef.current;

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
      </main>
      <SpeciesPanel
        speciesCode={state.speciesCode}
        onDismiss={() => set({ speciesCode: null })}
        apiClient={apiClient}
      />
    </div>
  );
}

import { useMemo } from 'react';
import { ApiClient } from './api/client.js';
import { useUrlState, readMigrationFlag } from './state/url-state.js';
import { useBirdData } from './data/use-bird-data.js';
import { FiltersBar } from './components/FiltersBar.js';
import { SpeciesPanel } from './components/SpeciesPanel.js';
import { SurfaceNav } from './components/SurfaceNav.js';
import { MigrationBanner } from './components/MigrationBanner.js';
import { deriveFamilies, deriveSpeciesIndex } from './derived.js';

const apiClient = new ApiClient({ baseUrl: import.meta.env.VITE_API_BASE_URL ?? '' });

export function App() {
  const { state, set } = useUrlState();
  const { loading, error, observations } = useBirdData(apiClient, {
    since: state.since,
    notable: state.notable,
    ...(state.speciesCode ? { speciesCode: state.speciesCode } : {}),
    ...(state.familyCode ? { familyCode: state.familyCode } : {}),
  });

  const families = useMemo(() => deriveFamilies(observations), [observations]);
  const speciesIndex = useMemo(() => deriveSpeciesIndex(observations), [observations]);

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
        {/* Surface components land in #116 (feed), #117 (hotspots),
            #118 (species). Until then the <main> is intentionally empty —
            SpeciesPanel still mounts outside and the migration banner
            still renders above for users on legacy ?region= URLs. */}
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

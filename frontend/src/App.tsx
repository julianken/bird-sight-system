import { useMemo } from 'react';
import { ApiClient } from './api/client.js';
import { useUrlState } from './state/url-state.js';
import { useBirdData } from './data/use-bird-data.js';
import { Map } from './components/Map.js';
import { FiltersBar } from './components/FiltersBar.js';
import { SpeciesPanel } from './components/SpeciesPanel.js';
import { SurfaceNav } from './components/SurfaceNav.js';
import { deriveFamilies, deriveSpeciesIndex } from './derived.js';
import { colorForFamily } from '@bird-watch/family-mapping';

const apiClient = new ApiClient({ baseUrl: import.meta.env.VITE_API_BASE_URL ?? '' });

// Generic bird silhouette SVG path used for every badge (MVP).
// Each family is distinguished by color. A future enhancement can fetch
// per-family silhouette paths from the /api/silhouettes endpoint.
//
// `size` is the path bbox's max(width, height) in its own path-local
// units; `Badge.silhouetteSize` uses this to scale the path into the
// circle. True bbox is 12×10 (x:5→17, y:6→16); pinned in Badge.test.tsx.
// The Badge default remains 24 to preserve today's render — flipping the
// caller to pass `GENERIC_SILHOUETTE.size` is a visible change and
// intentionally out of scope for ticket #92.
export const GENERIC_SILHOUETTE = {
  path: 'M5 14 C5 9 9 7 13 8 L17 6 L17 9 L15 10 L15 14 L13 16 L8 16 L5 14 Z',
  size: 12,
} as const;

function silhouetteFor(_silhouetteId: string | null): string {
  return GENERIC_SILHOUETTE.path;
}

// COUPLING NOTE (Plan 3 scope, not 4c):
// colorFor receives silhouetteId (observations.silhouette_id) and passes it to
// colorForFamily(), which expects a familyCode. This works only while
// family_silhouettes.id == family_code (true for the current seed data).
// Once Observation carries a first-class `familyCode` field (requires adding
// sm.family_code to the getObservations SELECT in db-client/observations.ts and
// to the Observation type in shared-types/src/index.ts), replace with:
//   colorForFamily(observation.familyCode ?? '')
// See deriveFamilies() in derived.ts for the same coupling.
function colorFor(silhouetteId: string | null): string {
  return colorForFamily(silhouetteId ?? '');
}

export function App() {
  const { state, set } = useUrlState();
  const { loading, error, regions, observations, hotspots } = useBirdData(apiClient, {
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
        <h2>Couldn't load map data</h2>
        <p>{error.message}</p>
      </div>
    );
  }

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
      {/* NOTE(#111): `<main id="main-surface">` + surface rendering land in
          #113 (map delete) / #116-#118 (feed / species / hotspots). Until
          then every view keeps rendering the existing map so SurfaceNav only
          mutates URL state. `aria-controls="main-surface"` on each tab stays
          unresolved in the DOM for this PR — browsers tolerate it. */}
      <div className="map-wrap" aria-busy={loading}>
        <Map
          regions={regions}
          observations={observations}
          hotspots={hotspots}
          expandedRegionId={state.regionId}
          selectedSpeciesCode={state.speciesCode}
          onSelectRegion={id => set({ regionId: id, speciesCode: null })}
          onSelectSpecies={code => set({ speciesCode: code })}
          silhouetteFor={silhouetteFor}
          colorFor={colorFor}
        />
      </div>
      {/* Species detail panel — mounts unconditionally; the component
          returns null when speciesCode is null. Panel is URL-driven: when
          `onSelectRegion` clears speciesCode (see above), the panel
          dismisses automatically. See issue #56 Design notes (gotcha #5). */}
      <SpeciesPanel
        speciesCode={state.speciesCode}
        onDismiss={() => set({ speciesCode: null })}
        apiClient={apiClient}
      />
    </div>
  );
}

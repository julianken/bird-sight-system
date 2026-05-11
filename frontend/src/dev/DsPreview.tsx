/**
 * DsPreview — dev-only design-system primitive preview shim.
 *
 * Activated by ?ds-preview=<key> in the URL. Returns the requested
 * primitive fullscreen so the Playwright snapshot suite can render it
 * in isolation without mounting the full app.
 *
 * Gate: this file is only imported when import.meta.env.DEV is true
 * (main.tsx conditionally renders DsPreview before App). Zero bytes
 * ship to production.
 *
 * Supported keys:
 *   status-loading       → <StatusBlock state="loading">
 *   status-empty         → <StatusBlock state="empty">
 *   status-error         → <StatusBlock state="error">
 *   silhouette-<family>  → <FamilySilhouette family="<family>">
 *   silhouette-null      → <FamilySilhouette family={null}>
 *   photo-null-woodpecker → <Photo src={null} family="woodpecker">
 *   photo-null-nullfamily → <Photo src={null} family={null}>
 *   photo-loaded          → <Photo> in loaded state (uses a stable data-URI placeholder)
 *   cluster-sky           → <ClusterPill count={50}>
 *   cluster-sand          → <ClusterPill count={200}>
 *   cluster-ember         → <ClusterPill count={900}>
 *   filter-notable        → <FilterSentence> with notable=true
 *   filter-notable-family → <FilterSentence> with notable=true + familyCode
 *   feed-card             → <FeedCard> elevated card with canned notable observation
 */
import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { StatusBlock } from '../components/ds/StatusBlock.js';
import { FamilySilhouette } from '../components/ds/FamilySilhouette.js';
import { Photo } from '../components/ds/Photo.js';
import { ClusterPill } from '../components/ds/ClusterPill.js';
import { FilterSentence } from '../components/ds/FilterSentence.js';
import { FeedCard } from '../components/FeedCard.js';
import { FeedRow } from '../components/FeedRow.js';
import type { NotableObservation, Observation } from '@bird-watch/shared-types';
import type { FamilyCode } from '../config/family-palette.js';
import type { UrlState } from '../state/url-state.js';

// Canned notable observation used by the feed-card DsPreview key.
const CANNED_NOTABLE: NotableObservation = {
  subId: 'S001',
  speciesCode: 'vermfly',
  comName: 'Vermilion Flycatcher',
  lat: 33.45,
  lng: -112.07,
  obsDt: new Date(Date.now() - 15 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19),
  locId: 'L001',
  locName: 'Papago Park',
  howMany: 3,
  isNotable: true,
  regionId: 'AZ',
  silhouetteId: null,
  familyCode: 'tyrannidae',
  taxonOrder: 4400,
};

// Canned flat observations shown below the FeedCard in the feed-card preview.
const CANNED_FLAT: Observation[] = [
  {
    subId: 'S002', speciesCode: 'gilwoo', comName: 'Gila Woodpecker',
    lat: 33.46, lng: -112.08,
    obsDt: new Date(Date.now() - 45 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19),
    locId: 'L002', locName: 'South Mountain', howMany: 1, isNotable: false,
    regionId: 'AZ', silhouetteId: null, familyCode: 'picidae', taxonOrder: 5200,
  },
  {
    subId: 'S003', speciesCode: 'incdov', comName: 'Inca Dove',
    lat: 33.44, lng: -112.06,
    obsDt: new Date(Date.now() - 90 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19),
    locId: 'L003', locName: 'Desert Botanical Garden', howMany: null, isNotable: false,
    regionId: 'AZ', silhouetteId: null, familyCode: 'columbidae', taxonOrder: 3100,
  },
  {
    subId: 'S004', speciesCode: 'annhum', comName: "Anna's Hummingbird",
    lat: 33.47, lng: -112.05,
    obsDt: new Date(Date.now() - 120 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19),
    locId: 'L004', locName: 'Phoenix Zoo', howMany: 2, isNotable: false,
    regionId: 'AZ', silhouetteId: null, familyCode: 'trochilidae', taxonOrder: 1600,
  },
];

// Minimal placeholder 1×1 transparent PNG data URI used as a stable
// "loaded" photo source in the preview context only.
const PLACEHOLDER_SRC =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const PREVIEW_STYLES: React.CSSProperties = {
  padding: '24px',
  fontFamily: 'system-ui, sans-serif',
  minHeight: '100vh',
};

function makeFilters(overrides: Partial<UrlState> = {}): UrlState {
  return {
    speciesCode: null,
    familyCode: null,
    since: '14d',
    notable: false,
    view: 'map',
    detail: null,
    ...overrides,
  };
}

function PreviewPhoto({ src, family }: { src: string | null; family: FamilyCode | null }) {
  const [s, setS] = useState<string | null>(src);

  useEffect(() => {
    if (src !== null) {
      // Simulate load after short delay so the loaded state is stable
      const t = setTimeout(() => setS(src), 50);
      return () => clearTimeout(t);
    }
  }, [src]);

  return <Photo src={s} alt="Preview bird" family={family} priority />;
}

export function DsPreview(): ReactNode {
  const params = new URLSearchParams(window.location.search);
  const key = params.get('ds-preview');
  if (!key) return null;

  // StatusBlock previews
  if (key === 'status-loading') {
    return (
      <div style={PREVIEW_STYLES}>
        <StatusBlock state="loading" title="Loading observations…" surface="page" />
      </div>
    );
  }
  if (key === 'status-empty') {
    return (
      <div style={PREVIEW_STYLES}>
        <StatusBlock
          state="empty"
          title="No sightings match your filters."
          body="Try widening the time window or turning off Notable only."
          action={{ label: 'Clear filters', onClick: () => {} }}
          surface="page"
        />
      </div>
    );
  }
  if (key === 'status-error') {
    return (
      <div style={PREVIEW_STYLES}>
        <StatusBlock
          state="error"
          title="Couldn't load bird data"
          body="The data service is temporarily unavailable. Try again in a moment."
          surface="page"
        />
      </div>
    );
  }

  // FamilySilhouette previews
  if (key === 'silhouette-null') {
    return (
      <div style={PREVIEW_STYLES}>
        <FamilySilhouette family={null} layout="masthead" ariaLabel="No-family silhouette" />
      </div>
    );
  }
  const silhouetteMatch = key.match(/^silhouette-(.+)$/);
  if (silhouetteMatch) {
    const family = silhouetteMatch[1] as FamilyCode;
    return (
      <div style={PREVIEW_STYLES}>
        <FamilySilhouette family={family} layout="masthead" ariaLabel={`${family} silhouette`} />
      </div>
    );
  }

  // Photo previews
  if (key === 'photo-null-woodpecker') {
    return (
      <div style={PREVIEW_STYLES}>
        <Photo src={null} alt="Gila Woodpecker" family="woodpecker" layout="inline" />
      </div>
    );
  }
  if (key === 'photo-null-nullfamily') {
    return (
      <div style={PREVIEW_STYLES}>
        <Photo src={null} alt="Unknown bird" family={null} layout="inline" />
      </div>
    );
  }
  if (key === 'photo-loaded') {
    return (
      <div style={PREVIEW_STYLES}>
        <PreviewPhoto src={PLACEHOLDER_SRC} family="songbird" />
      </div>
    );
  }

  // ClusterPill previews
  if (key === 'cluster-sky') {
    return (
      <div style={PREVIEW_STYLES}>
        <ClusterPill count={50} onClick={() => {}} />
      </div>
    );
  }
  if (key === 'cluster-sand') {
    return (
      <div style={PREVIEW_STYLES}>
        <ClusterPill count={200} onClick={() => {}} />
      </div>
    );
  }
  if (key === 'cluster-ember') {
    return (
      <div style={PREVIEW_STYLES}>
        <ClusterPill count={900} onClick={() => {}} />
      </div>
    );
  }

  // FilterSentence previews
  if (key === 'filter-notable') {
    return (
      <div style={PREVIEW_STYLES}>
        <FilterSentence filters={makeFilters({ notable: true })} />
      </div>
    );
  }
  if (key === 'filter-notable-family') {
    return (
      <div style={PREVIEW_STYLES}>
        <FilterSentence filters={makeFilters({ notable: true, familyCode: 'woodpeckers' })} />
      </div>
    );
  }

  // FeedCard preview — elevated notable card + 3 flat rows below (issue #440)
  if (key === 'feed-card') {
    const now = new Date();
    return (
      <div style={{ ...PREVIEW_STYLES, maxWidth: '800px' }}>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          <FeedCard
            observation={CANNED_NOTABLE}
            now={now}
            onSelectSpecies={() => {}}
          />
          {CANNED_FLAT.map(obs => (
            <FeedRow
              key={obs.subId}
              observation={obs}
              now={now}
              onSelectSpecies={() => {}}
            />
          ))}
        </ul>
      </div>
    );
  }

  // Unknown key: show a helpful error
  return (
    <div style={{ ...PREVIEW_STYLES, color: 'red' }}>
      <p>Unknown ds-preview key: <code>{key}</code></p>
    </div>
  );
}

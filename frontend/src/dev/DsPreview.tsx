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
 */
import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { StatusBlock } from '../components/ds/StatusBlock.js';
import { FamilySilhouette } from '../components/ds/FamilySilhouette.js';
import { Photo } from '../components/ds/Photo.js';
import { ClusterPill } from '../components/ds/ClusterPill.js';
import { FilterSentence } from '../components/ds/FilterSentence.js';
import type { FamilyCode } from '../config/family-palette.js';
import type { UrlState } from '../state/url-state.js';

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

  // Unknown key: show a helpful error
  return (
    <div style={{ ...PREVIEW_STYLES, color: 'red' }}>
      <p>Unknown ds-preview key: <code>{key}</code></p>
    </div>
  );
}

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
 *   scope-control         → <ScopeControl> in a state view (US-AZ), floated over a map-ish backdrop
 *   scope-control-us      → <ScopeControl> in the whole-US view (no "Whole US" self-link)
 */
import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { StatusBlock } from '../components/ds/StatusBlock.js';
import { FamilySilhouette } from '../components/ds/FamilySilhouette.js';
import { Photo } from '../components/ds/Photo.js';
import { ClusterPill } from '../components/ds/ClusterPill.js';
import { FilterSentence } from '../components/ds/FilterSentence.js';
import { ZipInput } from '../components/ZipInput.js';
import { ScopeChooser } from '../components/ScopeChooser.js';
import { ScopeControl } from '../components/ScopeControl.js';
import type { StateSummary } from '@bird-watch/shared-types';
import type { FamilyCode } from '../config/family-palette.js';
import type { UrlState } from '../state/url-state.js';

// Canned state list for the ScopeChooser preview (#742). A small name-sorted
// slice — the real list comes from GET /api/states (#732) at runtime.
const CANNED_STATES: StateSummary[] = [
  { stateCode: 'US-AZ', name: 'Arizona', bbox: [-114.8, 31.3, -109.0, 37.0] },
  { stateCode: 'US-CA', name: 'California', bbox: [-124.4, 32.5, -114.1, 42.0] },
  { stateCode: 'US-CO', name: 'Colorado', bbox: [-109.1, 37.0, -102.0, 41.0] },
  { stateCode: 'US-NM', name: 'New Mexico', bbox: [-109.1, 31.3, -103.0, 37.0] },
  { stateCode: 'US-NY', name: 'New York', bbox: [-79.8, 40.5, -71.8, 45.0] },
  { stateCode: 'US-TX', name: 'Texas', bbox: [-106.7, 25.8, -93.5, 36.5] },
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
    scope: { kind: 'unscoped' }, // #735 — UrlState now carries a scope; default unscoped.
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

  // ZipInput previews (#739). The component warms the real ~1 MB index on
  // focus from the dev server's public/zip-index.json; the error key forces a
  // fetch failure so the role=alert fallback renders deterministically.
  if (key.startsWith('zip-input')) {
    return <ZipInputPreview variant={key} />;
  }

  // ScopeChooser previews (#742). The landing chooser in isolation across its
  // states: `scope-chooser` = populated selector; `scope-chooser-loading` =
  // statesLoading (selector disabled, ZIP path still usable).
  if (key.startsWith('scope-chooser')) {
    return (
      <ScopeChooser
        states={CANNED_STATES}
        statesLoading={key === 'scope-chooser-loading'}
        onPickState={() => {}}
        onPickWholeUs={() => {}}
        onResolve={() => {}}
      />
    );
  }

  // ScopeControl previews (#737). The in-state on-map re-scope bar, floated
  // over a representative map-tinted backdrop so the overlay treatment reads
  // correctly: `scope-control` = a state view (US-AZ selected, "Whole US" +
  // "Change scope" exits visible); `scope-control-us` = the whole-US view
  // (neutral placeholder, no "Whole US" self-link).
  if (key.startsWith('scope-control')) {
    return (
      <ScopeControlPreview variant={key} />
    );
  }

  // Unknown key: show a helpful error
  return (
    <div style={{ ...PREVIEW_STYLES, color: 'red' }}>
      <p>Unknown ds-preview key: <code>{key}</code></p>
    </div>
  );
}

/**
 * ScopeControl dev harness (#737). The control FLOATS over the map canvas via
 * `position:absolute` + `--z-panel`, so isolating it requires a
 * `position:relative` backdrop that stands in for `.map-surface`. A muted
 * map-ish fill makes the overlay chrome (surface, border, shadow) legible at
 * screenshot time without mounting the real MapLibre canvas. Dev-only — never
 * ships (DsPreview is gated behind import.meta.env.DEV in main.tsx).
 */
function ScopeControlPreview({ variant }: { variant: string }): ReactNode {
  const isUs = variant === 'scope-control-us';
  return (
    <div
      style={{
        position: 'relative',
        minHeight: '100vh',
        // A neutral map-ish backdrop (token-derived tint) so the floating
        // overlay's surface/border/shadow are visible in both themes.
        background:
          'repeating-linear-gradient(45deg, var(--color-bg-tint) 0 16px, var(--color-bg-page) 16px 32px)',
      }}
    >
      <ScopeControl
        scope={isUs ? { kind: 'us' } : { kind: 'state', stateCode: 'US-AZ' }}
        states={CANNED_STATES}
        onPickState={() => {}}
        onPickWholeUs={() => {}}
        onExit={() => {}}
        onResolve={() => {}}
      />
    </div>
  );
}

/**
 * ZipInput dev harness. Renders the component in isolation for screenshot
 * capture across the four submit outcomes. `zip-input` shows the idle field;
 * the `-error` variant monkeypatches `fetch` to reject so the role=alert
 * state is reproducible without a flaky network condition. Dev-only — never
 * ships (DsPreview is gated behind import.meta.env.DEV in main.tsx).
 */
function ZipInputPreview({ variant }: { variant: string }): ReactNode {
  const [resolved, setResolved] = useState<string | null>(null);

  useEffect(() => {
    if (variant !== 'zip-input-error') return;
    const original = window.fetch;
    window.fetch = (() =>
      Promise.reject(new Error('forced zip-index failure'))) as typeof window.fetch;
    return () => {
      window.fetch = original;
    };
  }, [variant]);

  return (
    <div style={{ ...PREVIEW_STYLES, maxWidth: '360px' }}>
      <ZipInput onResolve={(scope) => setResolved(JSON.stringify(scope))} />
      {resolved && (
        <p style={{ marginTop: '12px', fontSize: '14px', color: 'var(--color-text-muted)' }}>
          Resolved scope: <code>{resolved}</code>
        </p>
      )}
    </div>
  );
}

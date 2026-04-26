import React from 'react';
import type { FamilySilhouette, Observation } from '@bird-watch/shared-types';
import { ErrorBoundary } from './ErrorBoundary.js';
import { FamilyLegend } from './FamilyLegend.js';

/**
 * Lazy-loaded MapCanvas. The React.lazy() boundary lives HERE — not inside
 * MapCanvas — so the 217 KB maplibre-gl chunk is only fetched when the map
 * surface is first rendered. Feed and Species tabs never pay for it.
 */
const MapCanvas = React.lazy(() =>
  import('./map/MapCanvas.js').then((m) => ({ default: m.MapCanvas })),
);

/**
 * Default-expanded breakpoint for FamilyLegend (issue #249). Mirrors the
 * `@media (max-width: 760px)` query in styles.css so the JS-side initial
 * state matches the CSS responsive default. Both knobs move together.
 */
const LEGEND_EXPAND_MIN_WIDTH = 760;

function readLegendDefaultExpanded(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    // SSR / jsdom-without-matchMedia — default to expanded so server-rendered
    // HTML matches the desktop fallback. The component re-evaluates from
    // localStorage on mount regardless.
    return true;
  }
  return window.matchMedia(`(min-width: ${LEGEND_EXPAND_MIN_WIDTH}px)`).matches;
}

export interface MapSurfaceProps {
  observations: Observation[];
  /** Provided by App.tsx via useSilhouettes — single mount per #246. */
  silhouettes: FamilySilhouette[];
  /** Currently active family filter (mirrors UrlState.familyCode). */
  familyCode: string | null;
  /**
   * Toggle handler — App.tsx wires this to:
   *   set({ familyCode: prev === code ? null : code })
   * Threaded down to FamilyLegend.
   */
  onFamilyToggle: (familyCode: string) => void;
}

/**
 * View-level wrapper for the geographic map surface. Provides:
 *   1. Code-splitting boundary (React.lazy / Suspense) — keeps MapLibre
 *      out of the main bundle.
 *   2. Error boundary — isolates WebGL / tile / style failures.
 *   3. Loading skeleton while the chunk downloads.
 *
 * S4 wires this into App.tsx behind the `?view=map` tab. Until then it
 * is unreachable in production (tree-shaken since nothing imports it).
 */
export function MapSurface({
  observations,
  silhouettes,
  familyCode,
  onFamilyToggle,
}: MapSurfaceProps) {
  // Compute the expand-by-default once at mount. The component itself
  // (FamilyLegend) handles localStorage precedence + manual toggle.
  const defaultExpanded = React.useMemo(readLegendDefaultExpanded, []);
  return (
    <ErrorBoundary
      fallback={
        <div className="error-screen" role="alert">
          <h2>Map failed to load</h2>
          <p>The map could not be displayed. Try refreshing the page.</p>
        </div>
      }
    >
      <div className="map-surface">
        <React.Suspense
          fallback={
            <div
              className="map-loading-skeleton"
              role="status"
              aria-live="polite"
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#f4f1ea',
              }}
            >
              Loading map…
            </div>
          }
        >
          <MapCanvas observations={observations} />
        </React.Suspense>
        <FamilyLegend
          silhouettes={silhouettes}
          observations={observations}
          familyCode={familyCode}
          onFamilyToggle={onFamilyToggle}
          defaultExpanded={defaultExpanded}
        />
      </div>
    </ErrorBoundary>
  );
}

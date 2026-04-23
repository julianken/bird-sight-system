import React from 'react';
import type { Observation } from '@bird-watch/shared-types';
import { ErrorBoundary } from './ErrorBoundary.js';

/**
 * Lazy-loaded MapCanvas. The React.lazy() boundary lives HERE — not inside
 * MapCanvas — so the 217 KB maplibre-gl chunk is only fetched when the map
 * surface is first rendered. Feed and Species tabs never pay for it.
 */
const MapCanvas = React.lazy(() =>
  import('./map/MapCanvas.js').then((m) => ({ default: m.MapCanvas })),
);

export interface MapSurfaceProps {
  observations: Observation[];
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
export function MapSurface({ observations }: MapSurfaceProps) {
  return (
    <ErrorBoundary
      fallback={
        <div className="error-screen" role="alert">
          <h2>Map failed to load</h2>
          <p>The map could not be displayed. Try refreshing the page.</p>
        </div>
      }
    >
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
    </ErrorBoundary>
  );
}

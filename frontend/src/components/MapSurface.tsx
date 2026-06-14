import React, { useState } from 'react';
import type { LngLatBounds } from 'maplibre-gl';
// GeoJSON `MultiPolygon` comes from `geojson` (@types/geojson), NOT maplibre-gl
// (5.x does not re-export it). `import type`, erased at build — see mask.ts.
import type { MultiPolygon } from 'geojson';
import type { AggregatedBucket, FamilySilhouette, Observation } from '@bird-watch/shared-types';
import type { SpeciesDictionary } from '../data/use-species-dictionary.js';
import { ErrorBoundary } from './ErrorBoundary.js';

/**
 * Lazy-loaded MapCanvas. The React.lazy() boundary lives HERE — not inside
 * MapCanvas — so the ~1,028 kB raw / ~273 kB gzip maplibre-gl chunk (see
 * docs/notes/dist-chunk-baseline.md) is fetched only when MapCanvas FIRST
 * RENDERS, not merely when this module is imported. The unscoped chooser
 * landing therefore never pays the chunk cost.
 */
const MapCanvas = React.lazy(() =>
  import('./map/MapCanvas.js').then((m) => ({ default: m.MapCanvas })),
);

export interface MapSurfaceProps {
  observations: Observation[];
  /** #859: aggregated low-zoom buckets; forwarded VERBATIM to MapCanvas. */
  buckets?: AggregatedBucket[];
  /** #859: render path ('aggregated' z<6 / 'observations' z>=6). */
  mode?: 'observations' | 'aggregated';
  /** #859: code→{comName} dictionary for resolving bucket species names. */
  dictionary?: SpeciesDictionary;
  /** Provided by App.tsx via useSilhouettes — single mount per #246.
   *  Forwarded verbatim to MapCanvas for the SDF sprite/symbol layer. */
  silhouettes: FamilySilhouette[];
  // Issue #662: the legacy skip-to-list prop + skip-link were intentionally
  // REMOVED here. There is no list surface to skip to. The
  // Explore-map-markers skip-link is now an App-root sibling (O2 #770).
  /**
   * Issue #246: ObservationPopover detail link. App.tsx wires this to
   * `set({ view: 'detail', detail: speciesCode })` via `useUrlState`
   * (already exposed for map marker clicks). Optional — when
   * absent, the popover hides the "See species details" link.
   */
  onSelectSpecies?: (speciesCode: string) => void;
  /**
   * Issue #351: passthrough for MapCanvas's onViewportChange callback.
   * App.tsx threads this so it can update its `viewportBounds` state on
   * each map `idle` (camera-change settle). Optional — when absent,
   * MapCanvas registers no viewport-change listener.
   */
  onViewportChange?: (bounds: LngLatBounds, zoom: number) => void;
  /**
   * #740/C6 — scope camera props, forwarded VERBATIM to <MapCanvas> (#736 owns
   * the `fitBounds`/`maxBounds`/`flyTo` mechanics). App.tsx derives these from
   * `state.scope` + the `/api/states` envelope table:
   *   - `scopeBounds` — the `[[w,s],[e,n]]` envelope the camera frames + clamps
   *     to (the state envelope for a `?state=` scope; CONUS for `?scope=us`).
   *   - `boundsKey`   — changes once per scope change (the state code, or 'us');
   *     the single `fitBounds` re-trigger key.
   *   - `flyTo`       — a transient ZIP `flyTo` at `ZIP_FLYTO_ZOOM`; preferred
   *     over `fitBounds` when both are pending on the same mount (finding (f)).
   * All optional — legacy/test callers that omit them keep the legacy CONUS
   * uncontrolled framing (MapSurface is a thin pass-through here).
   */
  scopeBounds?: [[number, number], [number, number]];
  boundsKey?: string;
  flyTo?: { center: [number, number]; zoom: number; key: string } | undefined;
  /**
   * #760/#762 — state-artboard mask, forwarded VERBATIM to <MapCanvas>. App.tsx
   * derives these from `state.scope`:
   *   - `maskPolygon` — the active state's render-only MultiPolygon (from
   *     `useStatePolygon`); `null` for `?scope=us` / chooser / asset loading.
   *   - `clampPad`    — the artboard `maxBounds` padding factor (`ARTBOARD_PAD`);
   *     present only for a state scope so the camera can zoom out onto gray.
   * Both optional — legacy/test callers that omit them get no mask + the raw
   * clamp (MapSurface is a thin pass-through here).
   */
  maskPolygon?: MultiPolygon | null;
  clampPad?: number;
  /**
   * #761 O6 (#782) → reversed by #976: true when a detail overlay
   * (SpeciesDetailRail / Sheet) is open under an active scope. App.tsx derives
   * this from `scopeActive && state.detail` — the same gate that mounts the
   * rail/sheet. Forwarded VERBATIM to <MapCanvas> (thin pass-through). #782
   * originally SUPPRESSED the passive cell-hover preview in this state; #976
   * reverses that — the preview is no longer suppressed. The flag is now
   * forwarded down (eventually as `belowDetail` on the hover preview) so the
   * tooltip is DEMOTED beneath the detail overlay (z `--z-under-detail` = 5)
   * rather than suppressed, keeping hover-to-compare working with a detail
   * open. Optional; defaults to `false` for legacy/test callers.
   */
  detailOpen?: boolean;
}

/**
 * View-level wrapper for the geographic map surface. Provides:
 *   1. Code-splitting boundary (React.lazy / Suspense) — keeps MapLibre
 *      out of the main bundle.
 *   2. Error boundary — isolates WebGL / tile / style failures.
 *   3. Loading skeleton while the chunk downloads.
 *
 * O2 (#770): The "Explore map markers" skip-link and FamilyLegend are NO
 * LONGER rendered here — they were hoisted to persistent App-root siblings
 * (position:fixed) so they persist across map↔detail transitions without
 * re-entering this Suspense subtree. The skip-link renders BEFORE <main>
 * (WCAG 2.4.1 tab order); the legend renders after </main> alongside the
 * rail/sheet. The original "Skip to species list" skip-link was removed in
 * #662.
 */
export function MapSurface({
  observations,
  buckets,
  mode,
  dictionary,
  silhouettes,
  onSelectSpecies,
  onViewportChange,
  scopeBounds,
  boundsKey,
  flyTo,
  maskPolygon,
  clampPad,
  detailOpen = false,
}: MapSurfaceProps) {
  /**
   * O7 (#786): GL-recovery counter. Bumping this key clears the ErrorBoundary's
   * hasError state (via resetKeys) and re-mounts the Suspense/MapCanvas subtree,
   * re-acquiring the WebGL context in-place — no full page reload required.
   */
  const [glRetryKey, setGlRetryKey] = useState(0);

  return (
    <ErrorBoundary
      resetKeys={[glRetryKey]}
      fallback={
        <div className="error-screen" role="alert">
          <h2>Map failed to load</h2>
          <p>
            The map could not be displayed. This is usually a temporary WebGL issue.
          </p>
          <button
            type="button"
            className="error-screen__retry"
            onClick={() => setGlRetryKey(k => k + 1)}
          >
            Try again
          </button>
        </div>
      }
    >
      {/* #800 / #779: The context strip (lede + filter sentence + freshness)
          was rendered here as an in-flow band that the `absolute; inset:0`
          map canvas painted over — the app's primary orientation sentence was
          invisible. It is now in the AppHeader identity card (top-left floating
          card). This MapSurface no longer renders the strip. */}
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
                background: 'var(--color-bg-tint, #f4f1ea)',
              }}
            >
              Loading map…
            </div>
          }
        >
          <MapCanvas
            observations={observations}
            {...(buckets ? { buckets } : {})}
            {...(mode ? { mode } : {})}
            {...(dictionary ? { dictionary } : {})}
            silhouettes={silhouettes}
            {...(onSelectSpecies ? { onSelectSpecies } : {})}
            {...(onViewportChange ? { onViewportChange } : {})}
            {...(scopeBounds ? { bounds: scopeBounds } : {})}
            {...(boundsKey !== undefined ? { boundsKey } : {})}
            {...(flyTo ? { flyTo } : {})}
            {...(maskPolygon != null ? { maskPolygon } : {})}
            {...(clampPad !== undefined ? { clampPad } : {})}
            detailOpen={detailOpen}
          />
        </React.Suspense>
      </div>
    </ErrorBoundary>
  );
}

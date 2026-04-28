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
  /**
   * Skip-link handler (issue #247). App.tsx wires this to
   * `set({ view: 'feed' })` so the URL-state setter routes the keyboard
   * user from the map to the FeedSurface landmark (which is fully
   * list-navigable). Filter state preservation is automatic via
   * `useUrlState`'s partial-merge.
   *
   * Optional so existing callers (e.g. tests, future surface composers)
   * that don't pass it still type-check; the skip-link button is then
   * hidden (no a11y bypass without a destination).
   */
  onSkipToFeed?: () => void;
  /**
   * Issue #246: ObservationPopover detail link. App.tsx wires this to
   * `set({ view: 'detail', detail: speciesCode })` via `useUrlState`
   * (already exposed for the FeedSurface row clicks). Optional — when
   * absent, the popover hides the "See species details" link.
   */
  onSelectSpecies?: (speciesCode: string) => void;
}

/**
 * View-level wrapper for the geographic map surface. Provides:
 *   1. Code-splitting boundary (React.lazy / Suspense) — keeps MapLibre
 *      out of the main bundle.
 *   2. Error boundary — isolates WebGL / tile / style failures.
 *   3. Loading skeleton while the chunk downloads.
 *   4. "Skip to species list" button (issue #247) — first interactive
 *      element in tab order on the map view, visually hidden until
 *      focused. WCAG 2.4.1 (Bypass Blocks) compliance: keyboard users
 *      can skip past the 344-marker map canvas (which is intentionally
 *      NOT in the global tab order — see MapMarkerHitLayer rationale)
 *      to the FeedSurface list landmark.
 *
 *      MUST be a <button>, NOT an <a href="#feed-surface">: App.tsx
 *      mounts the surfaces mutually-exclusive (FeedSurface only renders
 *      when `view === 'feed'`), so there is no `#feed-surface` anchor
 *      target while `view === 'map'`. Anchor-based navigation also
 *      doesn't switch view state. A button with onClick={() =>
 *      set({ view: 'feed' })} is the only correct form.
 */
export function MapSurface({
  observations,
  silhouettes,
  familyCode,
  onFamilyToggle,
  onSkipToFeed,
  onSelectSpecies,
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
      {/* Skip-link: first interactive element on the map view. Visually
          hidden until focus reveals it; lives outside the .map-surface
          wrapper so its absolute positioning anchors to the page rather
          than to the map's relative-positioned container. */}
      {onSkipToFeed && (
        <button
          type="button"
          className="skip-link"
          onClick={onSkipToFeed}
        >
          Skip to species list
        </button>
      )}
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
          <MapCanvas
            observations={observations}
            silhouettes={silhouettes}
            {...(onSelectSpecies ? { onSelectSpecies } : {})}
          />
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

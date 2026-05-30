import React from 'react';
import type { LngLatBounds } from 'maplibre-gl';
// GeoJSON `MultiPolygon` comes from `geojson` (@types/geojson), NOT maplibre-gl
// (5.x does not re-export it). `import type`, erased at build — see mask.ts.
import type { MultiPolygon } from 'geojson';
import type { FamilySilhouette, Observation } from '@bird-watch/shared-types';
import { ErrorBoundary } from './ErrorBoundary.js';
import { FamilyLegend } from './FamilyLegend.js';
import { MapLede, type Freshness } from './MapLede.js';
import { FilterSentence } from './ds/FilterSentence.js';
import type { Since, BBox } from '../state/url-state.js';
import { prettyFamily } from '../derived.js';

/**
 * Lazy-loaded MapCanvas. The React.lazy() boundary lives HERE — not inside
 * MapCanvas — so the ~1,028 kB raw / ~273 kB gzip maplibre-gl chunk (see
 * docs/perf/dist-chunk-baseline.md) is fetched only when MapCanvas FIRST
 * RENDERS, not merely when this module is imported. The unscoped chooser
 * landing therefore never pays the chunk cost.
 */
const MapCanvas = React.lazy(() =>
  import('./map/MapCanvas.js').then((m) => ({ default: m.MapCanvas })),
);

/**
 * Default-expanded breakpoint for FamilyLegend (issue #249).
 *
 * Originally mirrored the global `(max-width: 760px)` mobile breakpoint, but
 * the CONUS default viewport (PR #612) puts the AZ-only data cluster in the
 * lower-left of the map — directly under the bottom-left FamilyLegend
 * overlay. At 768×1024 (iPad portrait) the expanded legend covers the only
 * visible marker on first paint, intercepting taps and breaking the
 * primary discovery flow on tablet-portrait.
 *
 * Lift the JS threshold to 1024 so tablet-portrait (and narrower) start
 * collapsed; tablet-landscape and desktop still default expanded. This is
 * intentionally decoupled from the global 760px mobile breakpoint — the
 * legend's overlay footprint is the constraint here, not the
 * mobile-layout heuristics elsewhere. localStorage `family-legend-
 * expanded.v2` still overrides the default once the user toggles.
 */
const LEGEND_EXPAND_MIN_WIDTH = 1024;

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
  /**
   * Issue #351: optional viewport-filtered observations array routed to
   * FamilyLegend ONLY. When absent, FamilyLegend uses `observations`
   * (preserves prior behavior for callers that don't pass distinct sets,
   * keeps existing tests' `baseProps` working without churn). When
   * present, MapCanvas still receives the full `observations` array —
   * clustering math + auto-spider depend on a stable observations
   * identity, so filtering MapCanvas's feed would break both. The split
   * exists so the legend can narrate viewport state while the map
   * continues to render the full set.
   */
  legendObservations?: Observation[];
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
  // Issue #662: the legacy skip-to-list prop + skip-link were intentionally
  // REMOVED here. There is no list surface to skip to. The
  // Explore-map-markers skip-link below remains as the keyboard-bypass
  // entry point.
  /**
   * Issue #246: ObservationPopover detail link. App.tsx wires this to
   * `set({ view: 'detail', detail: speciesCode })` via `useUrlState`
   * (already exposed for map marker clicks). Optional — when
   * absent, the popover hides the "See species details" link.
   */
  onSelectSpecies?: (speciesCode: string, bbox: BBox | null) => void;
  /**
   * Phase 1 (#558): skip-link handler for the new "Explore map markers"
   * skip-link. When activated, MapCanvas places focus on the first
   * <TileCell> of the first marker group. Optional — when absent, the
   * skip-link is not rendered regardless of the feature flag.
   */
  onExploreMapMarkers?: () => void;
  /**
   * Phase 1 (#558): whether the map currently has at least one
   * AdaptiveGrid marker visible. When false, the "Explore map markers"
   * skip-link is aria-hidden + tabIndex=-1 (cannot focus into a no-op
   * state per spec §4.7 empty-viewport policy). Defaults to true.
   */
  hasMarkers?: boolean;
  /**
   * Issue #351: passthrough for MapCanvas's onViewportChange callback.
   * App.tsx threads this so it can update its `viewportBounds` state on
   * each map `idle` (camera-change settle). Optional — when absent,
   * MapCanvas registers no viewport-change listener and the FamilyLegend
   * keeps showing full-set counts.
   */
  onViewportChange?: (bounds: LngLatBounds, zoom: number) => void;
  // --- Phase 3: context strip ---
  /** Time-window filter (mirrors UrlState.since). */
  since: Since;
  /** Notable-only filter (mirrors UrlState.notable). */
  notable: boolean;
  /** Currently active species filter code (mirrors UrlState.speciesCode). */
  speciesCode: string | null;
  /**
   * Human-readable common name for the active species filter (e.g.
   * "Vermilion Flycatcher"). Forwarded to <FilterSentence> so the visible
   * sentence renders the common name instead of the raw eBird code.
   * Optional — when absent FilterSentence falls back to the raw code.
   */
  speciesName?: string;
  /** Freshness state from <App>'s freshness derivation. */
  freshness: Freshness;
  /** Pre-formatted freshness meta string (e.g. "Updated 11 min ago · Source: eBird"). */
  freshnessLabel: string;
  /**
   * Issue #716/#720: cold-load gate forwarded to <MapLede>. While the
   * initial /api/observations fetch is in flight, useBirdData's seeded
   * empty `observations: []` would otherwise drive MapLede into Template 1
   * ("No sightings match your current filters."), which is misleading
   * before the user has applied any filters. App.tsx threads
   * `observationsLoading` (NOT the combined `loading`) into this prop
   * so the suppression survives the common case where `/api/hotspots`
   * resolves before `/api/observations`.
   */
  loading: boolean;
  /**
   * #738/C5: runtime region label for the active scope (from `regionLabelFor`).
   * Forwarded to <MapLede>. `null` ⟺ the unscoped/chooser landing, where
   * MapLede renders nothing. App.tsx (#740) derives this from `state.scope`.
   */
  region: string | null;
  /**
   * #738/C7: whether any filter is active (App.tsx owns the
   * `since === DEFAULTS.since` comparison). Forwarded to <MapLede> so the
   * zero-count branch reads as data-availability (sparse region) vs
   * filter-narrowing.
   */
  noFiltersActive: boolean;
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
}

/**
 * View-level wrapper for the geographic map surface. Provides:
 *   1. Code-splitting boundary (React.lazy / Suspense) — keeps MapLibre
 *      out of the main bundle.
 *   2. Error boundary — isolates WebGL / tile / style failures.
 *   3. Loading skeleton while the chunk downloads.
 *   4. "Explore map markers" skip-link (Phase 1, #558) — first interactive
 *      element in tab order on the map view, visually hidden until focused.
 *      WCAG 2.4.1 (Bypass Blocks) compliance for keyboard users to bypass
 *      the map canvas and land on the first marker cell. The original
 *      "Skip to species list" skip-link was removed in #662.
 */
export function MapSurface({
  observations,
  legendObservations,
  silhouettes,
  familyCode,
  onFamilyToggle,
  onSelectSpecies,
  onViewportChange,
  onExploreMapMarkers,
  hasMarkers = true,
  since,
  notable,
  speciesCode,
  speciesName,
  freshness,
  freshnessLabel,
  loading,
  region,
  noFiltersActive,
  scopeBounds,
  boundsKey,
  flyTo,
  maskPolygon,
  clampPad,
}: MapSurfaceProps) {
  // Compute the expand-by-default once at mount. The component itself
  // (FamilyLegend) handles localStorage precedence + manual toggle.
  const defaultExpanded = React.useMemo(readLegendDefaultExpanded, []);
  // Issue #351: FamilyLegend's observations source. When the parent
  // hands us a distinct legendObservations array (App.tsx in view=map),
  // narrate viewport state. When absent, fall back to the same array
  // MapCanvas sees so baseline callers and tests stay unchanged.
  const legendObs = legendObservations ?? observations;

  // Phase 3: derive lede inputs from the observations array.
  const speciesCount = new Set(observations.map(o => o.speciesCode).filter(Boolean)).size;
  const observationCount = observations.length;
  // For Template 2 (single species filter), prefer the comName of the first
  // observation if there's exactly one species in scope.
  const speciesCommonName =
    speciesCount === 1 ? (observations[0]?.comName ?? null) : null;
  const familyName = familyCode ? prettyFamily(familyCode) : null;
  const period = since === '1d' ? '24 hours' : since.replace('d', ' days');

  return (
    <ErrorBoundary
      fallback={
        <div className="error-screen" role="alert">
          <h2>Map failed to load</h2>
          <p>The map could not be displayed. Try refreshing the page.</p>
        </div>
      }
    >
      {/* Issue #662: the legacy "Skip to species list" skip-link was deleted.
          The Explore-map-markers skip-link below is now the first interactive
          element on the map view. */}
      {onExploreMapMarkers && (
        <button
          type="button"
          className="skip-link"
          data-testid="explore-map-markers-skip-link"
          aria-hidden={!hasMarkers || undefined}
          tabIndex={hasMarkers ? 0 : -1}
          onClick={() => {
            if (hasMarkers) onExploreMapMarkers();
          }}
        >
          Explore map markers
        </button>
      )}
      {/* Phase 3: context strip — lede + filter sentence + freshness meta */}
      <section className="map-context-strip" aria-label="Map context">
        <MapLede
          region={region}
          noFiltersActive={noFiltersActive}
          speciesCount={speciesCount}
          observationCount={observationCount}
          speciesCommonName={speciesCommonName}
          familyName={familyName}
          period={period}
          freshness={freshness}
          loading={loading}
        />
        <FilterSentence
          filters={{ since, notable, speciesCode, familyCode }}
          {...(familyName !== null ? { familyName } : {})}
          {...(speciesName !== undefined ? { speciesName } : {})}
        />
        {freshnessLabel && <p className="map-freshness">{freshnessLabel}</p>}
      </section>
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
            silhouettes={silhouettes}
            {...(onSelectSpecies ? { onSelectSpecies } : {})}
            {...(onViewportChange ? { onViewportChange } : {})}
            {...(scopeBounds ? { bounds: scopeBounds } : {})}
            {...(boundsKey !== undefined ? { boundsKey } : {})}
            {...(flyTo ? { flyTo } : {})}
            {...(maskPolygon != null ? { maskPolygon } : {})}
            {...(clampPad !== undefined ? { clampPad } : {})}
          />
        </React.Suspense>
        <FamilyLegend
          silhouettes={silhouettes}
          observations={legendObs}
          familyCode={familyCode}
          onFamilyToggle={onFamilyToggle}
          defaultExpanded={defaultExpanded}
        />
      </div>
    </ErrorBoundary>
  );
}

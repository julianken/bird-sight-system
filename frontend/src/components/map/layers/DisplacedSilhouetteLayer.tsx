import type { Observation } from '@bird-watch/shared-types';
import { PresentationMarker } from './PresentationMarker.js';
import { SILHOUETTE_PX } from '@/components/map/geometry/deconflict.js';
import type { SilhouetteOffsets } from '@/components/map/geometry/obs-derive.js';
import {
  MapMarkerHitLayer,
  type HitLayerMap,
  type HitTargetMarker,
} from './MapMarkerHitLayer.js';

/**
 * DisplacedSilhouetteLayer — presentational render of the displaced-silhouette
 * `<button>` twins (issue #554 scope expansion) plus the co-located
 * `<MapMarkerHitLayer>` mount (issue #247/#277). Extracted verbatim from
 * `MapCanvas.tsx` (epic #884 · U11 / #896).
 *
 * Both surfaces are overlay siblings of the maplibre canvas: the twins keep a
 * silhouette VISIBLE when deconflict has pushed it aside (its canvas-painted
 * original is hidden via feature-state), and the hit layer hosts the wider
 * clickable hit targets for individual observations at high zoom.
 *
 * Presentational only: holds NO map ref of its own and inspects no shape to
 * pick a domain action. The parent (`MapCanvas`) owns all handlers (`onOpen` =
 * `openPopoverAt`, `onSelect` = `handleHitSelect`) and all derived state
 * (`silhouetteOffsets`, `obsLookup`, `silhouetteRenderById`, `hitMarkers`). The
 * `map` instance is *received* as a prop solely to forward it to the
 * `<MapMarkerHitLayer>` mount — this component does not create, mutate, or
 * subscribe to it. Exemplar idiom: `AdaptiveGridMarker.tsx`.
 */
interface DisplacedSilhouetteLayerProps {
  /** Per-subId displaced lng/lat from MapCanvas's reconcile pass. */
  silhouetteOffsets: SilhouetteOffsets;
  /** subId → Observation lookup (obs-derive `buildObsLookup`). */
  obsLookup: Record<string, Observation>;
  /** subId → rendered silhouette path + color (obs-derive `buildSilhouetteRenderById`). */
  silhouetteRenderById: Map<string, { svgData: string | null; color: string }>;
  /**
   * `MapCanvas.openPopoverAt` — opens the popover at an explicit lngLat. The
   * twin projects from the DISPLACED point (`entry.longitude/entry.latitude`),
   * never the hidden survey point (#718).
   */
  onOpen: (obs: Observation, lngLat: [number, number]) => void;
  /**
   * The maplibre map instance, forwarded to `<MapMarkerHitLayer>`. Null until
   * `mapReady`; the `map && (...)` guard suppresses the mount until then.
   */
  map: HitLayerMap | null;
  /** Hit-target markers (obs-derive `buildHitMarkers`) for the hit-layer mount. */
  hitMarkers: HitTargetMarker[];
  /** `MapCanvas.handleHitSelect` — resolves the obs by subId and opens the popover. */
  onSelect: (subId: string) => void;
  /** Drives 48×48 (coarse) vs 40×40 (fine) hit-target sizing in the hit layer. */
  isCoarsePointer: boolean;
}

export function DisplacedSilhouetteLayer({
  silhouetteOffsets,
  obsLookup,
  silhouetteRenderById,
  onOpen,
  map,
  hitMarkers,
  onSelect,
  isCoarsePointer,
}: DisplacedSilhouetteLayerProps) {
  return (
    <>
      {Array.from(silhouetteOffsets.entries()).map(([subId, entry]) => {
        const obs = obsLookup[subId];
        if (!obs) return null;
        const sil = silhouetteRenderById.get(subId);
        const color = sil?.color ?? '#555';
        const svgData = sil?.svgData ?? null;
        // Displaced silhouettes are rendered as accessible <button>
        // wrappers so a click opens the obs popover even though the
        // canvas-painted twin is hidden. The PresentationMarker outer
        // div has role="presentation" (see PresentationMarker effect),
        // so the inner <button> remains the canonical interactive
        // element with full keyboard + AT support.
        return (
          <PresentationMarker
            key={`displaced-${subId}`}
            longitude={entry.longitude}
            latitude={entry.latitude}
            anchor="center"
          >
            <button
              type="button"
              data-testid="displaced-silhouette"
              data-subid={subId}
              aria-label={`${obs.comName} observation`}
              // Issue #718: project the popover from `entry.longitude/
              // entry.latitude` — the DISPLACED visual position — not
              // from `obs.lng/obs.lat`. The obs survey point is hidden
              // beneath the canvas-painted twin; projecting from it
              // would land the popover next to the invisible original
              // instead of the silhouette the user actually clicked,
              // defeating the fix at this site.
              onClick={() => onOpen(obs, [entry.longitude, entry.latitude])}
              style={{
                display: 'inline-block',
                width: SILHOUETTE_PX,
                height: SILHOUETTE_PX,
                padding: 0,
                margin: 0,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
              }}
            >
              {svgData ? (
                <svg
                  viewBox="0 0 24 24"
                  width={SILHOUETTE_PX}
                  height={SILHOUETTE_PX}
                  aria-hidden="true"
                >
                  {/* Halo (white stroke) painted first so the colored
                      body sits on top, mirroring the SDF symbol layer's
                      icon-halo-color #ffffff / icon-halo-width 1.5. */}
                  <path
                    d={svgData}
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />
                  <path d={svgData} fill={color} />
                </svg>
              ) : (
                // Fallback circle when the family has no Phylopic
                // silhouette — matches the _FALLBACK opacity tinting.
                <svg
                  viewBox="0 0 24 24"
                  width={SILHOUETTE_PX}
                  height={SILHOUETTE_PX}
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="8" fill={color} opacity="0.5" />
                </svg>
              )}
            </button>
          </PresentationMarker>
        );
      })}
      {/* Issue #247 (original hit-layer) / #277 (Spider v2 narrowed to auto-spider stacks +
          unclustered): HTML overlay for stacked and unclustered markers, mounted as a sibling
          of the maplibre canvas inside the relatively-positioned wrapper. */}
      {map && (
        <MapMarkerHitLayer
          map={map}
          markers={hitMarkers}
          onSelect={onSelect}
          isCoarsePointer={isCoarsePointer}
        />
      )}
    </>
  );
}

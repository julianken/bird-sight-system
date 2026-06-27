import type { Observation } from '@bird-watch/shared-types';
import type { SilhouettesById } from './adaptive-grid.js';
import type { HitTargetMarker } from '@/components/map/layers/MapMarkerHitLayer.js';
import { CLUSTER_MAX_ZOOM } from './observation-layers.js';
import { resolveFamilyName } from '@/derived.js';

/**
 * Pure observation derives extracted from MapCanvas.tsx (epic #884 · U8).
 *
 * Three behavior-preserving data transforms — no map API, no React, no refs.
 * The caller (MapCanvas) wraps each in a `useMemo` and holds the fresh-closure
 * `obsLookupRef` latch itself (the latch is the indirection, not the memo, so
 * it stays in the component). Rendered output is byte-identical to the inline
 * versions these replaced.
 */

/**
 * The displaced-silhouette offset map MapCanvas threads from its reconcile
 * pass: per-subId visible (shifted) lng/lat used to re-anchor hit targets so a
 * click lands where the user actually sees the silhouette, not the canvas-
 * hidden original survey point (#247/#277). Only `longitude`/`latitude` are
 * read here; `dx`/`dy` are carried for the renderer.
 */
export type SilhouetteOffsets = ReadonlyMap<
  string,
  { dx: number; dy: number; longitude: number; latitude: number }
>;

/**
 * Observation lookup by subId for the click handler. Prototype-free
 * (`Object.create(null)`) so a `subId` colliding with an `Object.prototype`
 * key (e.g. `toString`, `__proto__`) can never resolve to an inherited method.
 */
export function buildObsLookup(
  observations: readonly Observation[],
): Record<string, Observation> {
  const lookup: Record<string, Observation> = Object.create(null);
  for (const o of observations) lookup[o.subId] = o;
  return lookup;
}

/**
 * Per-subId silhouette-render lookup (issue #554 scope expansion 2026-05-15).
 * Maps each observation's subId → its rendered silhouette path + color, so
 * the displaced-silhouette render block can paint an inline SVG that
 * visually matches the symbol-layer rendering it replaces.
 * `svgData === null` means the family has no usable Phylopic silhouette —
 * the displaced marker falls through to the _FALLBACK shape.
 */
export function buildSilhouetteRenderById(
  observations: readonly Observation[],
  silhouettesById: SilhouettesById,
): Map<string, { svgData: string | null; color: string }> {
  const lookup = new Map<string, { svgData: string | null; color: string }>();
  for (const o of observations) {
    const key = o.familyCode?.toLowerCase();
    const sil = key ? silhouettesById.get(key) : undefined;
    lookup.set(o.subId, {
      svgData: sil?.svgData ?? null,
      color: sil?.color ?? '#555',
    });
  }
  return lookup;
}

/**
 * Hit-target layer markers: render hit targets at zoom >= CLUSTER_MAX_ZOOM
 * (now 16 = MAX_INTERACTIVE_ZOOM - 1, the supercluster de-cluster threshold)
 * for individual observations. The adaptive-grid
 * reconciler renders 1×1 grid markers for singletons at this zoom; the
 * hit layer is the wider clickable surface that survives small marker
 * sizes. Below CLUSTER_MAX_ZOOM, observations are clustered, so the
 * overlay is suppressed (returns `[]`) and cluster-marker clicks
 * (AdaptiveGridMarker / ClusterPill) drive the interaction.
 */
export function buildHitMarkers(
  observations: readonly Observation[],
  mapZoom: number,
  silhouetteOffsets: SilhouetteOffsets,
  silhouettesById: SilhouettesById,
): HitTargetMarker[] {
  if (mapZoom < CLUSTER_MAX_ZOOM) {
    return [];
  }
  return observations.map((o) => {
    // If this subId is currently displaced (silhouette deconflict),
    // anchor the hit target at the displaced lng/lat so clicks land on
    // where the user actually sees the silhouette, not the canvas-
    // hidden original position.
    const displaced = silhouetteOffsets.get(o.subId);
    const lngLat: [number, number] = displaced
      ? [displaced.longitude, displaced.latitude]
      : [o.lng, o.lat];
    // #921: resolve the colloquial family name UPSTREAM, where the silhouette
    // catalogue (`silhouettesById`) is in scope. The leaf `MapMarkerHitLayer`
    // gets no catalogue, so without this it fell back to the RAW lowercase
    // `familyCode` in the screen-reader aria-label (`…, tyrannidae, …`). The
    // resolver chain stays `name ?? commonName ?? prettyFamily`; `name`
    // (AggregatedFamily.name) has no per-observation analogue, so only the
    // silhouette `commonName` participates here.
    const familyName = o.familyCode
      ? resolveFamilyName(o.familyCode, {
          commonName: silhouettesById.get(o.familyCode.toLowerCase())?.commonName,
        })
      : undefined;
    return {
      subId: o.subId,
      comName: o.comName,
      familyCode: o.familyCode,
      familyName,
      locName: o.locName,
      obsDt: o.obsDt,
      isNotable: o.isNotable,
      lngLat,
    };
  });
}

import type { StateCode } from '@bird-watch/shared-types';

/**
 * Pure scope-resolution contracts + the single shared `ZIP_FLYTO_ZOOM`
 * constant.
 *
 * NO React in this module — it is a pure data handoff (plan seam table: owner
 * D, consumer C). This file is the frozen contract seam between the
 * ZIP-resolution stream (Stream D, #735/#730) and the camera + URL-state
 * stream (Stream C, #736). Stream C consumes `ZIP_FLYTO_ZOOM` to drive
 * `MapCanvas`'s ZIP `flyTo`; Stream D's D5 task (#739) EXTENDS this same file
 * with the `ScopeResolution`/`ZipResolution` shapes and the
 * `zipResolutionToScope` mapper (plan literal #6: "ZIP_FLYTO_ZOOM = 10 as a
 * single shared constant" — never re-literaled at a call site).
 *
 * `StateCode` is imported from `@bird-watch/shared-types` — the single source
 * of the 49-code CONUS allowlist (locked decision #6). Re-deriving or
 * re-listing the codes here would let the clip and the scope contract drift.
 */

/**
 * A fully-resolved map scope: which state to clip data to (`?state=US-XX`),
 * and where the camera should sit. `center` is `[lng, lat]` — MapLibre's
 * coordinate order, NOT the `[lat, lng]` order the columnar ZIP index stores.
 */
export interface ScopeResolution {
  stateCode: StateCode;
  center: [number, number];
  zoom: number;
}

/**
 * The result of resolving a 5-digit ZIP against the precomputed index: the
 * ZIP's centroid (`[lng, lat]`) and the CONUS state it falls inside (resolved
 * offline by point-in-polygon against the canonical state polygons). A
 * `ZipResolution` carries no zoom — the camera framing is the consumer's
 * concern, supplied by `zipResolutionToScope`.
 */
export interface ZipResolution {
  zip: string;
  center: [number, number];
  stateCode: StateCode;
}

/**
 * Zoom level the camera flies to when a ZIP centroid is the scope target.
 *
 * 10 = metro framing — close enough to read a city, still inside the
 * whole-state `CONUS_BOUNDS` clamp, and >= 6 (the per-obs API threshold so a
 * ZIP landing never trips the low-zoom aggregation path). Single source of
 * truth: `MapCanvas`'s ZIP `flyTo` imports this; do NOT re-literal `10` at any
 * call site (plan literal #6).
 */
export const ZIP_FLYTO_ZOOM = 10;

/**
 * Lift a `ZipResolution` into a `ScopeResolution` by attaching the standard
 * metro fly-to zoom. `center` and `stateCode` pass through unchanged — in
 * particular `center` stays in `[lng, lat]` order (no tuple swap).
 */
export function zipResolutionToScope(zip: ZipResolution): ScopeResolution {
  return {
    stateCode: zip.stateCode,
    center: zip.center,
    zoom: ZIP_FLYTO_ZOOM,
  };
}

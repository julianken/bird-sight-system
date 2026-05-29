/**
 * The single shared `ZIP_FLYTO_ZOOM` constant.
 *
 * NO React in this module — it is a pure data handoff (plan seam table: owner
 * D, consumer C). This file is the frozen contract seam between the
 * ZIP-resolution stream (Stream D, #735/#730) and the camera stream
 * (Stream C, #736). Stream C (this task) consumes `ZIP_FLYTO_ZOOM` to drive
 * `MapCanvas`'s ZIP `flyTo`. Stream D's D5 task EXTENDS this file with the
 * `ScopeResolution`/`ZipResolution` shapes and the `zipResolutionToScope`
 * mapper (those have no consumer until D lands, so they live with D to keep
 * knip clean — adding them here now would trip the unused-export gate).
 *
 * Created by #736 (the first consumer that needs `ZIP_FLYTO_ZOOM`) so the
 * camera task is self-contained against `main`; when Stream D's D5 task lands
 * it merges into this same file rather than re-literaling the constant
 * (plan literal #6: "ZIP_FLYTO_ZOOM = 10 as a single shared constant").
 */

/**
 * Zoom level the camera flies to when a ZIP centroid is the scope target.
 *
 * 10 = metro framing — close enough to read a city, still inside the
 * whole-state `CONUS_BOUNDS` clamp, and ≥6 (the per-obs API threshold so a ZIP
 * landing never trips the low-zoom aggregation path). Single source of truth:
 * `MapCanvas`'s ZIP `flyTo` imports this; do NOT re-literal `10` at any call
 * site (plan literal #6).
 */
export const ZIP_FLYTO_ZOOM = 10;

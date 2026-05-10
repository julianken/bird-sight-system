/**
 * Basemap URLs for the map surface.
 *
 * Light: OpenFreeMap positron — free, MapLibre-compatible.
 * Dark:  OpenFreeMap dark — gated on G7/G8 contrast gate; see
 *        docs/design/01-spec/open-questions.md. If the gate fails,
 *        MapCanvas falls back to the light basemap for both modes.
 *
 * `basemapStyle` is kept as a light alias so existing callers compile
 * without changes until Phase 3 wires the theme-aware prop.
 *
 * Prototype finding 2 (docs/plans/2026-04-22-map-v1-prototype/learnings.md):
 * positron emits MapLibre warnings at zoom >7 — cosmetic, not crashes.
 */
export const basemapStyleLight = 'https://tiles.openfreemap.org/styles/positron';
export const basemapStyleDark  = 'https://tiles.openfreemap.org/styles/dark';

/** Backward-compatible alias — Phase 3 will replace callsites with the
 *  theme-aware selection. */
export const basemapStyle = basemapStyleLight;

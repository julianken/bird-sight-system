/**
 * Basemap URLs for the map surface.
 *
 * Light: OpenFreeMap positron — free, MapLibre-compatible.
 * Dark:  G7/G8 gate (family-palette × dark-tile contrast) is open. Until
 *        the gate closes, the dark URL deliberately aliases the light
 *        positron URL: the MutationObserver in MapCanvas still fires
 *        map.setStyle on theme flip, but setStyle to the same URL is a
 *        cheap no-op (and avoids OpenFreeMap dark-style sprite-load
 *        warnings — circle-11 etc. — that fire when sprites referenced
 *        by the dark style are not present in the positron sprite sheet
 *        the map originally loaded).
 *
 *        When G8 closes, switch basemapStyleDark to point at
 *        'https://tiles.openfreemap.org/styles/dark' (or a self-hosted
 *        equivalent) and the swap mechanism light up automatically.
 *
 * Prototype finding 2 (docs/plans/2026-04-22-map-v1-prototype/learnings.md):
 * positron emits MapLibre warnings at zoom >7 — cosmetic, not crashes.
 *
 * Spec: docs/design/01-spec/tokens.md §Light/dark mechanic
 * Spec: docs/design/01-spec/open-questions.md (G7/G8)
 */
export const basemapStyleLight = 'https://tiles.openfreemap.org/styles/positron';

/** Aliased to the light URL until G8 closes — see the module comment. */
export const basemapStyleDark  = basemapStyleLight;

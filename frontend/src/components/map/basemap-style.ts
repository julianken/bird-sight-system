/**
 * Basemap styles for the map surface.
 *
 * Two named exports — BASEMAP_LIGHT and BASEMAP_DARK — drive the basemap
 * swap when `[data-theme]` changes on <html>. The MutationObserver wired
 * up in Phase 1 of the Sky Atlas redesign (MapCanvas.tsx) reads the
 * current attribute on every mutation and calls map.setStyle() with the
 * matching URL.
 *
 * BASEMAP_DARK is a LITERAL alias of BASEMAP_LIGHT until the G7 (family
 * palette × basemap contrast) and G8 (dark basemap palette ratification)
 * prototype gates close. The dark mode mechanic ships in Phase 1; the
 * dark-tile URL only switches in once the gates close. Two named exports
 * exist so consumer code (MapCanvas) is forward-compatible — flipping
 * the alias to a real dark tile URL is a one-line change here.
 *
 * `basemapStyle`, `basemapStyleLight`, `basemapStyleDark` are preserved
 * as back-compat aliases so existing callers continue to type-check
 * during the rename sweep. Delete in a follow-up once grep confirms zero
 * callers outside this module.
 *
 * Spec: docs/design/01-spec/architecture.md §"Light / dark mode"
 * Gate: docs/design/01-spec/open-questions.md G7, G8
 */
export const BASEMAP_LIGHT: string = 'https://tiles.openfreemap.org/styles/positron';

/** Aliased to the light URL until G8 closes — see the module comment. */
export const BASEMAP_DARK: string = BASEMAP_LIGHT;

/** @deprecated Use BASEMAP_LIGHT — alias preserved for back-compat. */
export const basemapStyle = BASEMAP_LIGHT;

/** @deprecated Use BASEMAP_LIGHT — alias preserved for back-compat. */
export const basemapStyleLight = BASEMAP_LIGHT;

/** @deprecated Use BASEMAP_DARK — alias preserved for back-compat. */
export const basemapStyleDark = BASEMAP_DARK;

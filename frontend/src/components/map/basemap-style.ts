/**
 * Basemap styles for the map surface.
 *
 * Two named exports — BASEMAP_LIGHT and BASEMAP_DARK — drive the basemap
 * swap when `[data-theme]` changes on <html>. The MutationObserver wired
 * up in Phase 1 of the adaptive-grid contrast epic (#575, MapCanvas.tsx)
 * reads the current attribute on every mutation and calls map.setStyle()
 * with the matching URL.
 *
 * Gate closure:
 * - G7 (family palette × basemap contrast): closed by Phase 1 PR #577.
 *   Palette audit harness in scripts/check-family-palette-contrast.ts;
 *   19 failing colors re-picked to score ≥ 3:1 against both basemaps.
 * - G8 (dark basemap palette ratification): closed by Phase 4 PR #582.
 *   BASEMAP_DARK now points at the real OpenFreeMap dark tile URL.
 *   MutationObserver in MapCanvas.tsx drives the live swap on theme toggle.
 *
 * `basemapStyle`, `basemapStyleLight`, `basemapStyleDark` are preserved
 * as back-compat aliases so existing callers continue to type-check
 * during the rename sweep. Delete in a follow-up once grep confirms zero
 * callers outside this module.
 *
 * Spec: docs/design/01-spec/architecture.md §"Light / dark mode"
 * Gates: docs/design/01-spec/open-questions.md G7 (closed), G8 (closed)
 */
export const BASEMAP_LIGHT: string = 'https://tiles.openfreemap.org/styles/positron';

/** Real dark tile URL — G8 closed 2026-05-16 (Phase 4, PR #582, issue #573). */
export const BASEMAP_DARK: string = 'https://tiles.openfreemap.org/styles/dark';

/** @deprecated Use BASEMAP_LIGHT — alias preserved for back-compat. */
export const basemapStyle = BASEMAP_LIGHT;

/** @deprecated Use BASEMAP_LIGHT — alias preserved for back-compat. */
export const basemapStyleLight = BASEMAP_LIGHT;

/** @deprecated Use BASEMAP_DARK — alias preserved for back-compat. */
export const basemapStyleDark = BASEMAP_DARK;

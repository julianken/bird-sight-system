/**
 * Basemap descriptors for the map surface.
 *
 * A `BasemapDescriptor` carries every fact a rendering subsystem needs about a
 * single OpenFreeMap style: its URL, its canvas polarity (`kind`, which drives
 * `[data-theme]`), its dominant land hex, and the float/marker/label colors the
 * helpers tune against that land. `THEME_REGISTRY` maps each theme id to its
 * descriptor; `resolveDescriptor(id)` looks one up. This replaces the old model
 * where subsystems hardcoded facts about two specific styles.
 *
 * `LAND_COLORS` is the single source of truth for the land hex + kind of ALL
 * five OpenFreeMap styles (positron, bright, liberty, dark, fiord). It is
 * declared in full here — ahead of the descriptors for bright/liberty/fiord,
 * which land in a later child — so the contrast audit and the descriptor table
 * read one authority instead of duplicating literals. `THEME_REGISTRY`
 * descriptors derive their `landColor` from this table.
 *
 * Only `positron` and `dark` are registered as descriptors right now, seeded
 * with the exact values already live so the rendered output is byte-identical:
 * no visible change. The other three descriptors are added in a follow-up.
 *
 * Two named exports — BASEMAP_LIGHT and BASEMAP_DARK — remain as thin aliases
 * of the registered urls. They drive the basemap swap when `[data-theme]`
 * changes on <html>. The MutationObserver wired up in Phase 1 of the
 * adaptive-grid contrast epic (#575, MapCanvas.tsx) reads the current attribute
 * on every mutation and calls map.setStyle() with the matching URL.
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

/** Registered basemap theme ids. Widened to all 5 styles in a follow-up. */
export type ThemeId = 'positron' | 'dark';

/** Canvas polarity of a basemap — drives the `[data-theme]` attribute. */
export type BasemapKind = 'light' | 'dark';

export interface BasemapDescriptor {
  /** Stable id for labels/tests. NEVER branched on in rendering code. */
  id: ThemeId;
  /** OpenFreeMap style URL. */
  url: string;
  /** Canvas polarity — DRIVES [data-theme]. */
  kind: BasemapKind;
  /** Dominant land hex — palette + float-contrast reference. */
  landColor: string;
  /** Silhouette icon-halo-color. */
  markerHaloColor: string;
  /** Float-surface outline + halo colors tuned against this land. */
  floatColors: { outline: string; halo: string };
  /** Per-label-class text colors. Required for `kind: 'dark'` basemaps. */
  darkLabelTextColors?: { road: string; place: string; water: string };
}

/**
 * Canonical land hex + kind per theme. The single audit/descriptor source of
 * truth for ALL five OpenFreeMap styles — the contrast audit and the
 * descriptor table both read this, rather than duplicating literals.
 */
export const LAND_COLORS = {
  positron: { land: '#f4f1ea', kind: 'light' }, // db-client LIGHT_BASE / tokens --color-bg-page
  bright: { land: '#f8f4f0', kind: 'light' },
  liberty: { land: '#f8f4f0', kind: 'light' },
  dark: { land: '#0E1116', kind: 'dark' }, // db-client DARK_BASE
  fiord: { land: '#45516E', kind: 'dark' },
} as const;

/**
 * Theme id → descriptor. Seeded with `positron`/`dark` only, using the exact
 * values already live so output is byte-identical. The other three descriptors
 * arrive in a follow-up (their LAND colors already live in `LAND_COLORS`).
 */
export const THEME_REGISTRY: Record<ThemeId, BasemapDescriptor> = {
  positron: {
    id: 'positron',
    url: 'https://tiles.openfreemap.org/styles/positron',
    kind: 'light',
    landColor: LAND_COLORS.positron.land, // '#f4f1ea'
    markerHaloColor: '#ffffff', // observation-layers.ts icon-halo-color
    floatColors: { outline: '#1a1d24', halo: '#3a3f4a' }, // OUTLINE_LIGHT / HALO_LIGHT
  },
  dark: {
    id: 'dark',
    url: 'https://tiles.openfreemap.org/styles/dark',
    kind: 'dark',
    landColor: LAND_COLORS.dark.land, // '#0E1116'
    markerHaloColor: '#ffffff',
    floatColors: { outline: '#e8edf4', halo: '#7fd0ff' }, // OUTLINE_DARK / HALO_DARK
    darkLabelTextColors: { road: '#d8d8d8', place: '#c4c4c4', water: '#b8cae6' }, // ROAD/PLACE/WATER_TEXT (water re-picked #1217: 4.76:1 vs fiord)
  },
};

/** Look up the descriptor for a registered theme id. */
export function resolveDescriptor(id: ThemeId): BasemapDescriptor {
  return THEME_REGISTRY[id];
}

/**
 * Runtime label-layer detector. Replaces drift-prone id heuristics: a label is
 * a `symbol` layer that paints a `text-field` and is not one of our own
 * observation layers. Accepts the minimal structural shape the helpers use.
 */
export function isLabelLayer(layer: {
  type?: string;
  source?: string;
  layout?: Record<string, unknown>;
}): boolean {
  return (
    layer.type === 'symbol' &&
    layer.layout?.['text-field'] != null &&
    layer.source !== 'observations'
  );
}

export const BASEMAP_LIGHT: string = THEME_REGISTRY.positron.url;

/** Real dark tile URL — G8 closed 2026-05-16 (Phase 4, PR #582, issue #573). */
export const BASEMAP_DARK: string = THEME_REGISTRY.dark.url;

/** @deprecated Use BASEMAP_LIGHT — alias preserved for back-compat. */
export const basemapStyle = BASEMAP_LIGHT;

/** @deprecated Use BASEMAP_LIGHT — alias preserved for back-compat. */
export const basemapStyleLight = BASEMAP_LIGHT;

/** @deprecated Use BASEMAP_DARK — alias preserved for back-compat. */
export const basemapStyleDark = BASEMAP_DARK;

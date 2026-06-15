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
 * five OpenFreeMap styles (positron, bright, liberty, dark, fiord). The
 * contrast audit and the descriptor table both read this authority instead of
 * duplicating literals; `THEME_REGISTRY` descriptors derive their `landColor`
 * from this table.
 *
 * All FIVE descriptors are now registered (C6). The three added beyond the
 * original positron/dark seed — bright, liberty, fiord — are DORMANT: no
 * selector exposes them yet (C8) and boot-theme still resolves only
 * `light → positron` / `dark → dark`, so the rendered output is unchanged.
 * Their colors were validated against each style's own land by the family-
 * palette, silhouette, and dark-label a11y audits (C5's ≥4.5:1 / ≥3:1 gates).
 *
 * Two named exports — BASEMAP_LIGHT and BASEMAP_DARK — remain as thin aliases
 * of the registered urls. They drive the basemap swap when `[data-theme]`
 * changes on <html>. The MutationObserver wired up in Phase 1 of the
 * adaptive-grid contrast epic (#575, MapCanvas.tsx) reads the current attribute
 * on every mutation and calls map.setStyle() with the matching URL. These are
 * retired in C7 once the last `[data-theme]`-only callers are removed.
 *
 * Gate closure:
 * - G7 (family palette × basemap contrast): closed by Phase 1 PR #577.
 *   Palette audit harness in scripts/check-family-palette-contrast.ts;
 *   19 failing colors re-picked to score ≥ 3:1 against both basemaps.
 * - G8 (dark basemap palette ratification): closed by Phase 4 PR #582.
 *   BASEMAP_DARK now points at the real OpenFreeMap dark tile URL.
 *   MutationObserver in MapCanvas.tsx drives the live swap on theme toggle.
 *
 * Spec: docs/design/01-spec/architecture.md §"Light / dark mode"
 * Gates: docs/design/01-spec/open-questions.md G7 (closed), G8 (closed)
 */

/** Registered basemap theme ids — all 5 OpenFreeMap styles. */
export type ThemeId = 'positron' | 'bright' | 'liberty' | 'dark' | 'fiord';

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
 * Theme id → descriptor for all FIVE OpenFreeMap styles. `positron`/`dark`
 * carry the exact values already live; `bright`/`liberty`/`fiord` are added by
 * C6 and remain DORMANT until a selector (C8) makes them reachable. Each
 * descriptor's `landColor` derives from `LAND_COLORS`. Color choices are
 * audit-gated: light floats clear ≥3:1 vs the light land, fiord's dark labels
 * clear ≥4.5:1 AA and its float outline ≥3:1 vs the navy land #45516E.
 *
 * Pre-flight (curl, 2026-06-14): all three style.json load and are well-formed —
 *   bright   119 layers, background ✓, 23 symbol+text-field, 0 fill-extrusion
 *   liberty  111 layers, background ✓, 23 symbol+text-field, 1 fill-extrusion
 *            (single building-extrusion layer; not matched by isLabelLayer
 *            (`type === 'symbol'`), so it does not break the mask/float pipeline)
 *   fiord     48 layers, background ✓, 14 symbol+text-field, 0 fill-extrusion
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
  bright: {
    id: 'bright',
    url: 'https://tiles.openfreemap.org/styles/bright',
    kind: 'light',
    landColor: LAND_COLORS.bright.land, // '#f8f4f0'
    markerHaloColor: '#ffffff', // white rings the family-colored silhouette (separation, not a land ratio)
    floatColors: { outline: '#1a1d24', halo: '#3a3f4a' }, // outline 15.41:1 vs #f8f4f0 (≥3:1) — same as positron's light floats
  },
  liberty: {
    id: 'liberty',
    url: 'https://tiles.openfreemap.org/styles/liberty',
    kind: 'light',
    landColor: LAND_COLORS.liberty.land, // '#f8f4f0'
    markerHaloColor: '#ffffff',
    floatColors: { outline: '#1a1d24', halo: '#3a3f4a' }, // outline 15.41:1 vs #f8f4f0 (≥3:1); style ships 1 fill-extrusion layer (pre-flight), inert to isLabelLayer
  },
  dark: {
    id: 'dark',
    url: 'https://tiles.openfreemap.org/styles/dark',
    kind: 'dark',
    landColor: LAND_COLORS.dark.land, // '#0E1116'
    markerHaloColor: '#ffffff',
    floatColors: { outline: '#e8edf4', halo: '#7fd0ff' }, // OUTLINE_DARK / HALO_DARK
    darkLabelTextColors: { road: '#d8d8d8', place: '#c4c4c4', water: '#9db4d8' }, // ROAD/PLACE/WATER_TEXT
  },
  fiord: {
    id: 'fiord',
    url: 'https://tiles.openfreemap.org/styles/fiord',
    kind: 'dark',
    landColor: LAND_COLORS.fiord.land, // '#45516E' (navy mid-luminance dark land)
    markerHaloColor: '#ffffff', // white rings the family-colored silhouette against the navy land (silhouette separation)
    floatColors: { outline: '#e8edf4', halo: '#7fd0ff' }, // outline 6.72:1 vs #45516E (≥3:1) ✓
    // C5-supplied AA-passing palette vs #45516E — water is LIGHTER than the shared
    // dark #9db4d8 (3.75:1 = FAIL); all three tiers clear ≥4.5:1 AA:
    //   road  #f2f2f2 = 7.06:1 | place #e6e6e6 = 6.34:1 | water #b8cae6 = 4.76:1
    darkLabelTextColors: { road: '#f2f2f2', place: '#e6e6e6', water: '#b8cae6' },
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

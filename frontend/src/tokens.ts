/**
 * Design tokens — single source of truth for icon size, z-index, opacity,
 * spacing, duration, and region palette values consumed by React/SVG
 * attributes (numbers) and by CSS via the mirrored :root custom properties
 * in styles.css.
 *
 * Rule of thumb:
 *   - JSX attribute (SVG `r`, `strokeWidth`, inline style number) → import
 *     from this file.
 *   - CSS rule (transition, z-index, opacity, box-shadow) → reference the
 *     matching `--token-name` custom property in styles.css.
 *
 * Scales are monotonic (asserted in tokens.test.ts). When adding a token,
 * extend the scale at the correct rank — don't insert a new name in the
 * middle without updating the tests.
 */

export const iconSize = {
  /**
   * Min radius for the hotspot-dot proportional-symbol scale (reserved for
   * future hotspot-marker layer). PR #101 tuned from 3 → 2 so the sqrt
   * scale doesn't compress the low-species tail.
   */
  hotspotDotMinR: 2,
  /**
   * Max radius for the hotspot-dot scale (reserved). Tuned to be exactly
   * half the default badge radius so hotspot dots read as secondary markers.
   * See #101 for the sqrt-based area-proportional rationale.
   */
  hotspotDotMaxR: 7,
  /**
   * Anchor species count for the sqrt hotspot-radius scale (reserved). `t =
   * clamp01(species / hotspotDotRefSpecies)` drives `r = MIN + sqrt(t) *
   * (MAX - MIN)`, so REF sets where the scale saturates at MAX. 450 is
   * near the upper tail of the actual AZ hotspot distribution (most
   * cluster 100-400 species).
   */
  hotspotDotRefSpecies: 450,
  /** Badge min diameter in SVG units. */
  badgeDiameterMin: 14,
  /** Badge max diameter in SVG units. */
  badgeDiameterMax: 30,
  /**
   * Default badge OUTER RADIUS in SVG units (14). Stored as a radius so
   * callers cannot silently halve it by confusing the unit — see regression
   * test in `Badge.test.tsx` ("default circle radius is 14"). Numerically
   * equal to `badgeDiameterMin` today; kept as a named token so the two can
   * diverge independently.
   */
  badgeRadiusDefault: 14,
  /**
   * Silhouette path coordinate-space bbox. `Badge.tsx` assumes silhouette
   * paths live in a 24x24 user-unit box and scales to the circle via
   * `scale((radius*2)/24)`. Exposing it as a token forces the assumption
   * to be visible to anyone authoring a new silhouette path.
   */
  silhouetteBbox: { w: 24, h: 24 },
} as const;

/**
 * Named floating-overlay z-index tier scale (#761 P1, issue #778).
 *
 * Renumbered into one strictly-increasing named sequence that preserves the
 * pre-refactor VISIBLE stack order EXACTLY — note the rail (`rail`) sits BELOW
 * the cell/cluster popovers (`cellPopover`/`clusterPopover`), matching today's
 * rail(45) < cell(46) < cluster(47). Doc/test-only: no runtime code reads any
 * member (verified — refs live only here and in tokens.test.ts), so the
 * renumber has zero behavioral blast radius. Mirrors the `--z-*` custom
 * properties in styles.css :root (keep both sides numerically in sync).
 */
export const zIndex = {
  /** Persistent map canvas base layer. */
  map: 0,
  /**
   * #976: passive cell-hover preview demoted while a species detail is open.
   * Sits ABOVE the map canvas/markers (5 > map's 0) but BELOW every detail
   * surface — sheet peek (10) / half (15) / full (modal 50) AND the rail (43)
   * — so hover-to-compare works with a detail open without the tooltip
   * occluding it.
   */
  underDetail: 5,
  /** Map-assist overlays: family legend, scope-control. */
  overlay: 40,
  /** On-canvas popovers above map-assist overlays (observation popover). */
  popover: 41,
  /** Floating app-header chrome band — above overlays, BELOW the rail. */
  chrome: 42,
  /** Species detail rail — one rank above the header chrome, BELOW the cell/cluster popovers. */
  rail: 43,
  /** Per-cell popover — above the rail (preserves the pre-refactor rail<cell order). */
  cellPopover: 44,
  /** Cluster-list popover — above the cell popover (preserves cell<cluster order). */
  clusterPopover: 45,
  /** Full-screen sheet / scrim / modal surfaces. */
  modal: 50,
  /** Skip-link — always reachable, above all. */
  skip: 60,
  /**
   * DEPRECATED alias of `overlay`, retained for one PR so existing
   * CSS `calc(var(--z-panel)+N)` refs (mirrored conceptually here) resolve
   * unchanged. NOT part of the strict-monotonic tier chain — it ties with
   * `overlay` by design. Migrate refs and remove in a #761 follow-up.
   */
  panel: 40,
} as const;

export const opacity = {
  /**
   * Low-emphasis shadows (panel box-shadow). Was `0.08` inline in
   * styles.css.
   */
  subtle: 0.08,
  /**
   * Dim non-selected regions on expand. Was `0.2` inline in Map.tsx.
   * Stays on the `<g>` wrapper so badges/labels dim together with the
   * region fill.
   */
  dimmed: 0.2,
  /**
   * Hover / elevated-shadow strength (region drop-shadow). Was `0.3`
   * inline in styles.css.
   */
  hover: 0.3,
  /** Fully opaque. Default for all fills + strokes. */
  full: 1,
} as const;

export const spacing = {
  /** Tight gap — badge cell padding, badge-chip offset. */
  xs: 4,
  /** Small gap — panel-close button offset. */
  sm: 8,
  /** Medium gap — panel internal spacing (species name → sci name). */
  md: 12,
  /** Large gap — filters-bar gap, surface padding. */
  lg: 16,
  /** X-large gap — panel top padding. */
  xl: 24,
} as const;

export const duration = {
  /** Badge + panel transitions. 200ms. */
  fast: 200,
  /** Default transitions. 250ms. */
  base: 250,
  /** Slow panel/drawer transitions. 350ms. */
  slow: 350,
} as const;

export const color = {
  palette: {
    /**
     * Ecoregion palette — DB-sync-only. These hex values mirror the
     * `regions.display_color` column in the DB (no rendering layer reads
     * them today; the MapLibre map does not draw region polygons).
     * Keep in sync with migration seeds if display_color ever changes.
     */
    /** Rust-orange. colorado-plateau. */
    coloradoPlateau: '#C77A2E',
    /** Dark umber. grand-canyon. */
    grandCanyon: '#9B5E20',
    /** Olive. mogollon-rim. */
    mogollonRim: '#5A6B2A',
    /** Desert-tan. sonoran-phoenix. */
    sonoranPhoenix: '#D4923A',
    /** Sand-bronze. lower-colorado. */
    lowerColorado: '#B07020',
    /** Warm-gold. sonoran-tucson. */
    sonoranTucson: '#E0A040',
    /**
     * Desaturated brick red. All three sky-islands rows. REPLACES the seeded
     * `#FF0808` — see migration `1700000013000_fix_sky_islands_color.sql`.
     * Chosen to read as "distinct" without leaving the earth-tone palette.
     */
    skyIslands: '#B84C3A',
    /** Hotspot-dot fill (reserved for future hotspot-marker layer). */
    hotspot: '#00A6F3',
    /**
     * Overflow-pip fill. `#888888` is the 7-char canonical form of `#888`.
     * Tokens canonicalise on the 6-hex form so the `/^#[0-9A-Fa-f]{6}$/`
     * invariant in `tokens.test.ts` holds.
     */
    overflow: '#888888',
  },
} as const;

export type IconSizeToken = keyof typeof iconSize;
export type ZIndexToken = keyof typeof zIndex;
export type OpacityToken = keyof typeof opacity;
export type SpacingToken = keyof typeof spacing;
export type DurationToken = keyof typeof duration;

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
   * HotspotDot min radius in SVG units (was `HotspotDot.MIN_R`). PR #101
   * retuned this from 3 → 2 so the sqrt proportional-symbol scale doesn't
   * compress the low-species tail.
   */
  hotspotDotMinR: 2,
  /**
   * HotspotDot max radius in SVG units (was `HotspotDot.MAX_R`). Tuned to
   * be exactly half the default Badge radius of 14 so hotspot dots read as
   * secondary markers and don't compete with Badge primaries on the same
   * map. See #101 for the sqrt-based area-proportional rationale.
   */
  hotspotDotMaxR: 7,
  /**
   * Anchor species count for the sqrt hotspot-radius scale. `t =
   * clamp01(species / hotspotDotRefSpecies)` drives `r = MIN + sqrt(t) *
   * (MAX - MIN)`, so REF sets where the scale saturates at MAX. 450 is
   * near the upper tail of the actual AZ hotspot distribution (most
   * cluster 100-400 species). Subject to retune against real
   * `/api/hotspots` output.
   */
  hotspotDotRefSpecies: 450,
  /** Badge min diameter in SVG units (was `BadgeStack.MIN_BADGE_DIAMETER`). */
  badgeDiameterMin: 14,
  /** Badge max diameter in SVG units (was `BadgeStack.MAX_BADGE_DIAMETER`). */
  badgeDiameterMax: 30,
  /**
   * Default badge OUTER RADIUS in SVG units. Was `Badge.DEFAULT_RADIUS = 14`
   * inline pre-PR. Stored as a radius (not diameter/2) so callers cannot
   * silently halve it by confusing the unit — see regression test in
   * `Badge.test.tsx` ("default circle radius is 14"). Numerically equal to
   * `badgeDiameterMin` today; kept as a named token so the two can diverge
   * later (e.g. if min-diameter shrinks for dense regions without changing
   * the solo-region default).
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

export const zIndex = {
  /** Default stacking (reserved — no rule uses this today). */
  base: 0,
  /**
   * Region polygon layer. Reserved for future CSS-stacked layers; note that
   * SVG interiors paint in document order, NOT CSS z-index. The region
   * polygons today are SVG children, so this value never applies to them.
   */
  shapes: 10,
  /** Badge layer (reserved). */
  badges: 20,
  /** Hotspot-dot layer (reserved). */
  hotspots: 25,
  /** Scrims / full-screen backdrops (reserved). */
  overlay: 30,
  /** Panel z-index (reserved for future overlays). Was `10` before tokens landed. */
  panel: 40,
  /** Future modal dialogs (reserved). */
  modal: 50,
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
  /** Small gap — region BadgeStack inset, panel-close button offset. */
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
    /** Rust-orange. Mirrors `regions.display_color` for colorado-plateau. */
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
     * Desaturated brick red. Applies to all three sky-islands rows. This
     * REPLACES the seeded `#FF0808` — see migration
     * `1700000013000_fix_sky_islands_color.sql` (landed in this PR).
     * Chosen to read as "distinct" without leaving the earth-tone palette.
     */
    skyIslands: '#B84C3A',
    /** HotspotDot fill. Was `#00A6F3` inline in HotspotDot.tsx. */
    hotspot: '#00A6F3',
    /**
     * Overflow-pip fill. `#888888` is the 7-char form of the `#888`
     * shorthand used inline at `BadgeStack.tsx:212,286` — identical RGB
     * (136,136,136). Tokens canonicalise on the 6-hex form so the
     * `/^#[0-9A-Fa-f]{6}$/` invariant in `tokens.test.ts` holds. BadgeStack
     * itself is NOT migrated in this PR (scope); when it is, the inline
     * `#888` becomes `color.palette.overflow` with no pixel change.
     */
    overflow: '#888888',
  },
} as const;

export type IconSizeToken = keyof typeof iconSize;
export type ZIndexToken = keyof typeof zIndex;
export type OpacityToken = keyof typeof opacity;
export type SpacingToken = keyof typeof spacing;
export type DurationToken = keyof typeof duration;

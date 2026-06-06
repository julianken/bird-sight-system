/**
 * Family-dot ring — the perceivable boundary for the family-color dot.
 *
 * The species-detail-sheet identity row paints a small dot
 * (`.sheet-fg-family-dot`) filled with the family accent color. The accent
 * fill alone CANNOT guarantee a perceivable boundary on both theme surfaces:
 * the family hues are mid-tones, so several of them fall below 3:1 against the
 * dark navy card surface (e.g. corvid #2e3a4e → 1.29:1, woodpecker #6b3a2a →
 * 1.60:1). WCAG 2.2 SC 1.4.11 (non-text contrast) requires the dot's visual
 * boundary to clear 3:1 against the adjacent surface regardless of the fill.
 *
 * So the BOUNDARY is the ring, not the fill. This module is the single source
 * of truth for the two per-theme ring colors and the two surface colors they
 * sit on; the CSS tokens (`--sheet-dot-ring`, set per `[data-theme]` in
 * tokens.css) carry the SAME values, and `family-dot-ring-contrast.test.ts`
 * iterates these to make the ≥3:1 audit FALSIFIABLE (per the #908 review
 * refinement — replacing the manual spot-check the bot flagged).
 *
 * If a ring or surface value moves here, move it in tokens.css too — the test
 * asserts the ratios, not the cross-file sync, so they are kept in step by
 * this comment and the shared literal values.
 */

/** The two theme surfaces the family dot is painted on (= `--color-bg-surface`). */
export const SHEET_SURFACE = {
  /** Light theme card surface — tokens.css :root[data-theme="light"]. */
  light: '#ffffff',
  /** Dark theme card surface (navy) — tokens.css :root[data-theme="dark"]. */
  dark: '#1b2742',
} as const;

/**
 * Per-theme dot-ring color. Solid (not alpha) so the rendered boundary color
 * is exactly this value — an alpha ring composites differently on each surface
 * and the original `rgba(128,128,128,.55)` ring resolved to only ~1.96:1 on
 * white and ~2.08:1 on navy (BOTH failing). Solid per-theme colors clear 3:1
 * with comfortable margin on their own surface:
 *   light #767676 vs #ffffff → 4.54:1
 *   dark  #aeb6c2 vs #1b2742 → 7.26:1
 */
export const SHEET_DOT_RING = {
  /** Mirrors `--sheet-dot-ring` in tokens.css :root[data-theme="light"]. */
  light: '#767676',
  /** Mirrors `--sheet-dot-ring` in tokens.css :root[data-theme="dark"]. */
  dark: '#aeb6c2',
} as const;

export type ThemeKey = keyof typeof SHEET_SURFACE;

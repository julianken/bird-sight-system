import { describe, it, expect } from 'vitest';
import { contrastRatio } from '../utils/wcag-contrast.js';
import { FAMILY_PALETTE, getFamilyChannel, type FamilyCode } from './family-palette.js';
import { SHEET_DOT_RING, SHEET_SURFACE, type ThemeKey } from './family-dot-ring.js';

/**
 * Falsifiable family-dot-ring contrast audit (#908 review refinement).
 *
 * The species-detail-sheet family dot (`.sheet-fg-family-dot`) is filled with
 * the family accent color and bounded by a 1px ring (`--sheet-dot-ring`). The
 * bot flagged the ≥3:1 audit as a manual spot-check; this suite makes it a
 * palette-iterating assertion so a future palette OR ring edit that breaks the
 * non-text-contrast floor (WCAG 2.2 SC 1.4.11) fails CI instead of shipping.
 *
 * Boundary model: the dot is perceivable when its BOUNDARY clears 3:1 against
 * the adjacent surface. The fill cannot guarantee this on both themes (proved
 * below), so the ring is the boundary — and the ring is hue-independent, so a
 * single passing ring per theme covers EVERY family. We still iterate the full
 * palette so the assertion names each family if the invariant ever regresses.
 */

const ALL_FAMILY_CODES: FamilyCode[] = [
  'raptor',
  'waterfowl',
  'woodpecker',
  'songbird',
  'shorebird',
  'hummingbird',
  'corvid',
];

const THEMES: ThemeKey[] = ['light', 'dark'];

const MIN_NON_TEXT_CONTRAST = 3.0;

describe('family-dot-ring contrast audit (WCAG 2.2 SC 1.4.11, ≥3:1)', () => {
  it('the per-theme ring color clears 3:1 against its surface on BOTH themes', () => {
    for (const theme of THEMES) {
      const ratio = contrastRatio(SHEET_DOT_RING[theme], SHEET_SURFACE[theme]);
      expect(
        ratio,
        `${theme} ring ${SHEET_DOT_RING[theme]} on surface ${SHEET_SURFACE[theme]} = ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(MIN_NON_TEXT_CONTRAST);
    }
  });

  it('every family dot is perceivable on BOTH themes (ring boundary ≥3:1 for each hue)', () => {
    // The ring is hue-independent, so this proves the dot boundary clears 3:1
    // for every family on both surfaces — the audit the bot asked to be made
    // falsifiable. Iterating per family means a regression names the family.
    for (const code of ALL_FAMILY_CODES) {
      // Touch the fill so the audit is anchored to the real palette entry — a
      // family removed from the palette fails here rather than silently passing.
      expect(getFamilyChannel(code).fill).toMatch(/^#[0-9a-fA-F]{6}$/);
      for (const theme of THEMES) {
        const ratio = contrastRatio(SHEET_DOT_RING[theme], SHEET_SURFACE[theme]);
        expect(
          ratio,
          `${code} dot ring on ${theme} surface = ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(MIN_NON_TEXT_CONTRAST);
      }
    }
  });

  it('the null-family neutral dot is perceivable on BOTH themes', () => {
    expect(getFamilyChannel(null).fill).toMatch(/^#[0-9a-fA-F]{6}$/);
    for (const theme of THEMES) {
      const ratio = contrastRatio(SHEET_DOT_RING[theme], SHEET_SURFACE[theme]);
      expect(ratio).toBeGreaterThanOrEqual(MIN_NON_TEXT_CONTRAST);
    }
  });

  it('documents WHY the ring is load-bearing: the fill alone fails 3:1 on the dark surface', () => {
    // Regression guard for the design rationale. If the palette is ever
    // re-tuned so every fill clears 3:1 on navy unaided, this test is the
    // signal to revisit whether the ring is still required (it would not be
    // wrong, just no longer the sole boundary). At least one family fill must
    // currently fail on the dark navy surface — that is precisely why the ring
    // exists and why the audit asserts the ring, not the fill.
    const fillsFailingOnDark = ALL_FAMILY_CODES.filter(
      (code) => contrastRatio(FAMILY_PALETTE[code].fill, SHEET_SURFACE.dark) < MIN_NON_TEXT_CONTRAST,
    );
    expect(fillsFailingOnDark.length).toBeGreaterThan(0);
  });
});

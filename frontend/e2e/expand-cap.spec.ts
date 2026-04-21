import { test, expect } from '@playwright/test';
import { AppPage } from './pages/app-page.js';

/**
 * Issue #88 — cap region expand-transform so no badge exceeds
 * MAX_BADGE_CSS_PX at any viewport, for any of the 9 seeded regions.
 *
 * Why 380 (not 120): the phase-1 defect measured a Santa Ritas fallback
 * badge at 1305×685 CSS px (bigger than the viewport). The
 * Region.tsx:EXPAND_MAX_BBOX_FRAC=0.60 cap, combined with the inscribed
 * 2·inradius fallback badge at ~26 SVG units and the viewport mapping of
 * ~2.146 px/unit at 1440×900, bounds the worst-case (Huachucas) badge at
 * ~26 × 6.23 × 2.146 ≈ 348 CSS px. 380 gives a small safety margin.
 * Tightening this to 120 is gated on the ticket-05 badge-sizing follow-up,
 * not this PR.
 *
 * Viewports: both 1440×900 (landscape, y-dominant letterbox → scale =
 * 815.5/380 ≈ 2.146 px/unit) and 768×1024 (portrait, x-dominant →
 * scale = 768/360 ≈ 2.133 px/unit) exercise different constraining axes,
 * which matters because preserveAspectRatio="xMidYMid meet" inverts the
 * bound direction between the two.
 */

const MAX_BADGE_CSS_PX = 380;
const REGION_IDS = [
  'colorado-plateau',
  'mogollon-rim',
  'sonoran-phoenix',
  'lower-colorado',
  'sonoran-tucson',
  'sky-islands-santa-ritas',
  'sky-islands-huachucas',
  'sky-islands-chiricahuas',
  'grand-canyon',
];

test.describe('expand-scale cap (#88)', () => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }]) {
    test(`no badge exceeds ${MAX_BADGE_CSS_PX} CSS px at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const app = new AppPage(page);
      for (const regionId of REGION_IDS) {
        await app.goto(`region=${regionId}`);
        await app.waitForMapLoad();
        await expect(page.locator(`[data-region-id="${regionId}"]`))
          .toHaveClass(/region-expanded/);
        // Sample every badge-circle inside the expanded region; failure
        // names the specific badge dimension and the region it was in.
        const worst = await page.locator(`[data-region-id="${regionId}"] .badge-circle`)
          .evaluateAll(circles => circles
            .map(c => c.getBoundingClientRect())
            .reduce((acc, r) => ({
              w: Math.max(acc.w, r.width),
              h: Math.max(acc.h, r.height),
            }), { w: 0, h: 0 }));
        expect(
          worst.w,
          `region ${regionId} has a badge wider than ${MAX_BADGE_CSS_PX} CSS px — likely scale-cap regression`,
        ).toBeLessThanOrEqual(MAX_BADGE_CSS_PX);
        expect(
          worst.h,
          `region ${regionId} has a badge taller than ${MAX_BADGE_CSS_PX} CSS px — likely scale-cap regression`,
        ).toBeLessThanOrEqual(MAX_BADGE_CSS_PX);
      }
    });
  }
});

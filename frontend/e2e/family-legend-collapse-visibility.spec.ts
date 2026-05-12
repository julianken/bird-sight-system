import { test, expect } from './fixtures.js';
import { AppPage } from './pages/app-page.js';

/**
 * Regression: collapsed family legend chip clipped by #main-surface overflow.
 *
 * PR #471 (W2) added `.map-context-strip { padding: var(--space-md)
 * var(--space-lg) }` (24 px vertical) + a 1px border-bottom. The combined
 * 69.5px chrome pushed `.map-surface { height: 100% }` below the visible
 * area, causing `#main-surface`'s overflow:auto scroll container to clip the
 * `position:absolute; bottom:12px` collapsed chip entirely.
 *
 * Fix (this PR): `#main-surface` becomes a flex column; `.map-surface` uses
 * `flex:1; min-height:0` instead of `height:100%`. The chip now sits inside
 * the flex-sized `.map-surface`, never below the clip boundary.
 *
 * This test is the regression guard #471 should have had.
 *
 * NOTE: This test drives Playwright MCP which requires a running dev server.
 * In CI the `webServer` stanza in playwright.config.ts starts `vite dev`
 * automatically. In local runs start it manually:
 *   npm run dev --workspace @bird-watch/frontend
 */

/**
 * Assert that the collapsed chip's bounding rect is fully inside
 * main#main-surface's bounding rect. Both edges (bottom and left) are
 * checked to within a 1px tolerance (fractional sub-pixel rounding).
 */
async function assertChipInsideMain(
  page: import('@playwright/test').Page,
): Promise<{ chipBottom: number; mainBottom: number; chipLeft: number; mainLeft: number }> {
  const rects = await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>('#main-surface');
    // The collapsed chip is the toggle button with aria-expanded="false" inside .map-surface
    const chip = document.querySelector<HTMLElement>(
      '.map-surface button[aria-expanded="false"]',
    );
    if (!main || !chip) return null;
    const mainRect = main.getBoundingClientRect();
    const chipRect = chip.getBoundingClientRect();
    return {
      chipBottom: chipRect.bottom,
      mainBottom: mainRect.bottom,
      chipLeft: chipRect.left,
      mainLeft: mainRect.left,
    };
  });

  expect(rects, 'main#main-surface and/or collapsed chip button not found in DOM').not.toBeNull();
  const { chipBottom, mainBottom, chipLeft, mainLeft } = rects!;

  // Chip bottom edge must be at or above main bottom edge (allow 1px for sub-pixel rounding)
  expect(
    chipBottom,
    `Collapsed chip bottom (${chipBottom.toFixed(1)}) is BELOW main bottom (${mainBottom.toFixed(1)}) — chip is clipped`,
  ).toBeLessThanOrEqual(mainBottom + 1);

  // Chip left edge must be at or right of main left edge
  expect(
    chipLeft,
    `Collapsed chip left (${chipLeft.toFixed(1)}) is LEFT OF main left (${mainLeft.toFixed(1)}) — chip is clipped`,
  ).toBeGreaterThanOrEqual(mainLeft - 1);

  return { chipBottom, mainBottom, chipLeft, mainLeft };
}

test.describe('Collapsed legend chip visibility — P0 regression from #471', () => {
  test.describe('desktop (1440×900)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('collapsed chip is fully inside main#main-surface bounds', async ({ page }) => {
      const app = new AppPage(page);
      // Clear localStorage so we get the default expanded state, then collapse
      await page.addInitScript(() => {
        try {
          window.localStorage.removeItem('family-legend-expanded');
          window.localStorage.removeItem('family-legend-expanded.v2');
        } catch { /* noop */ }
      });
      await app.goto('view=map');
      await app.waitForAppReady();
      await expect(page.locator('[data-testid=map-canvas]')).toBeVisible({ timeout: 15_000 });

      // Collapse the legend via the toggle button
      const toggle = page.getByRole('button', { name: /bird families/i });
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');

      // Assert chip is inside main bounds
      const { chipBottom, mainBottom } = await assertChipInsideMain(page);
      // Provide readable context in the test output
      expect(
        chipBottom <= mainBottom + 1,
        `Desktop: chip bottom ${chipBottom.toFixed(1)} <= main bottom ${mainBottom.toFixed(1)}`,
      ).toBe(true);
    });
  });

  test.describe('mobile (390×844)', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('collapsed chip is fully inside main#main-surface bounds', async ({ page }) => {
      const app = new AppPage(page);
      // Mobile defaults to collapsed — clear localStorage and let the
      // viewport-driven default apply.
      await page.addInitScript(() => {
        try {
          window.localStorage.removeItem('family-legend-expanded');
          window.localStorage.removeItem('family-legend-expanded.v2');
        } catch { /* noop */ }
      });
      await app.goto('view=map');
      await app.waitForAppReady();
      await expect(page.locator('[data-testid=map-canvas]')).toBeVisible({ timeout: 15_000 });

      // On mobile the legend starts collapsed — no click needed
      const toggle = page.getByRole('button', { name: /bird families/i });
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');

      // Assert chip is inside main bounds
      const { chipBottom, mainBottom } = await assertChipInsideMain(page);
      expect(
        chipBottom <= mainBottom + 1,
        `Mobile: chip bottom ${chipBottom.toFixed(1)} <= main bottom ${mainBottom.toFixed(1)}`,
      ).toBe(true);
    });
  });
});

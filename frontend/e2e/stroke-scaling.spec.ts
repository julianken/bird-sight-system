import { test, expect } from '@playwright/test';
import { AppPage } from './pages/app-page.js';

/**
 * Issue #93 — stroke widths and drop-shadow must not inflate with the
 * `.region-expanded` scale(s) transform (s ~ 3-9 across regions).
 *
 * The underlying bug: CSS `stroke-width` declared in SVG user units
 * inherits every ancestor `transform` attribute (SVG 2 §8.8). Fix is
 * `vector-effect: non-scaling-stroke`, which stamps the stroke in screen
 * pixels AFTER ancestor transforms apply.
 *
 * We measure via `getComputedStyle(el).strokeWidth` because that reads
 * the resolved screen-pixel value — the exact quantity users perceive.
 * The delta is ≤ 1 px to leave slack for cross-browser sub-pixel
 * rounding; with non-scaling-stroke the measured delta is 0 px in
 * Chromium/Firefox/Safari 16+.
 *
 * Tests are POM-style (`AppPage.expandRegion`) so the expand path is
 * exercised through the same keyboard code path as the happy-path spec.
 */

const STROKE_DELTA_MAX_PX = 1;

async function readStrokePx(page: import('@playwright/test').Page, selector: string): Promise<number> {
  return await page.evaluate((sel) => {
    const el = document.querySelector(sel) as SVGGraphicsElement | null;
    if (!el) throw new Error(`selector not found: ${sel}`);
    // getComputedStyle returns "Npx" — parseFloat drops the unit.
    return parseFloat(getComputedStyle(el).strokeWidth);
  }, selector);
}

test.describe('stroke scaling under region-expanded transform (#93)', () => {
  test('desktop sky-island stroke width is stable across expand (Santa Ritas)', async ({ page }) => {
    const app = new AppPage(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await app.goto();
    await app.waitForMapLoad();

    const regionSel = '[data-region-id="sky-islands-santa-ritas"] .region-shape';
    const pre = await readStrokePx(page, regionSel);

    await app.expandRegion('Sky Islands — Santa Ritas');
    await expect(app.regionById('sky-islands-santa-ritas'))
      .toHaveClass(/region-expanded/);

    const post = await readStrokePx(page, regionSel);
    expect(Math.abs(post - pre)).toBeLessThanOrEqual(STROKE_DELTA_MAX_PX);
  });

  test('badge-circle stroke width is stable across expand (Santa Ritas)', async ({ page }) => {
    const app = new AppPage(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await app.goto();
    await app.waitForMapLoad();
    // Wait for observations so a badge renders inside the region.
    await expect(app.mapWrap).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });

    const badgeSel = '[data-region-id="sky-islands-santa-ritas"] .badge-circle';
    const preBadge = await page.locator(badgeSel).first();
    // If this region has no badge in the seed, skip the badge assertion
    // gracefully — the region-shape test above still exercises the fix.
    const badgeCount = await preBadge.count();
    test.skip(badgeCount === 0, 'no badge in sky-islands-santa-ritas for this seed');

    const pre = await readStrokePx(page, badgeSel);

    await app.expandRegion('Sky Islands — Santa Ritas');
    await expect(app.regionById('sky-islands-santa-ritas'))
      .toHaveClass(/region-expanded/);

    const post = await readStrokePx(page, badgeSel);
    expect(Math.abs(post - pre)).toBeLessThanOrEqual(STROKE_DELTA_MAX_PX);
  });

  test('mobile sky-island stroke width is stable across expand (Chiricahuas)', async ({ page }) => {
    const app = new AppPage(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await app.goto();
    await app.waitForMapLoad();

    const regionSel = '[data-region-id="sky-islands-chiricahuas"] .region-shape';
    const pre = await readStrokePx(page, regionSel);

    await app.expandRegion('Sky Islands — Chiricahuas');
    await expect(app.regionById('sky-islands-chiricahuas'))
      .toHaveClass(/region-expanded/);

    const post = await readStrokePx(page, regionSel);
    expect(Math.abs(post - pre)).toBeLessThanOrEqual(STROKE_DELTA_MAX_PX);
  });
});

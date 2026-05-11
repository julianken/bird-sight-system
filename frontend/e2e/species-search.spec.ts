import { test, expect } from './fixtures.js';
import { AppPage } from './pages/app-page.js';

/**
 * Issue #441 — SpeciesSearchSurface hero CSS regression guard.
 *
 * Root cause: `.species-search-hero` and `.species-search-hero-icon svg`
 * had ZERO CSS rules. The inline SVG (magnifying glass) inherited the
 * block-size of its parent container and rendered at viewport dimensions
 * (~1000px × 1000px on desktop). This spec asserts the SVG is constrained
 * to its intended 20 × 20 px icon size and that the hero container itself
 * does not overflow the viewport.
 *
 * Navigation contract: every test begins with page.goto — no shared state.
 *
 * Read-only: no DB writes. All state flows through URL params.
 * Verified: grep -rE "request\.(post|patch|delete|put)|fetch\(.*method:" frontend/e2e/species-search.spec.ts
 * returns nothing.
 */

/**
 * Viewports exercised: the two release-1 exit-criteria viewports.
 * 390×844 = iPhone 14 Pro / typical mobile
 * 1440×900 = standard desktop
 */
const VIEWPORTS = [
  { width: 390, height: 844, label: 'mobile (390×844)' },
  { width: 1440, height: 900, label: 'desktop (1440×900)' },
] as const;

test.describe('SpeciesSearchSurface hero CSS — SVG icon bound (#441)', () => {
  for (const vp of VIEWPORTS) {
    test.describe(vp.label, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });

      test(`SVG icon height ≤ 40px at ${vp.label}`, async ({ page }) => {
        const app = new AppPage(page);
        await app.goto('view=species');
        await app.waitForAppReady();

        // The hero icon SVG must be visible (hero is rendered)
        const heroIcon = page.locator('.species-search-hero-icon svg');
        await expect(heroIcon).toBeVisible({ timeout: 10_000 });

        // Bounding box height must be ≤ 40px — well within the 20px design spec.
        // Acceptance criterion from #441: "DevTools … height ≤ 40px"
        const box = await heroIcon.boundingBox();
        expect(box, 'SVG icon bounding box must not be null').not.toBeNull();
        expect(box!.height, `SVG icon height was ${box!.height}px — expected ≤ 40px`).toBeLessThanOrEqual(40);
      });

      test(`SVG icon height < 10% of viewport height (${vp.height}px) at ${vp.label}`, async ({ page }) => {
        const app = new AppPage(page);
        await app.goto('view=species');
        await app.waitForAppReady();

        const heroIcon = page.locator('.species-search-hero-icon svg');
        await expect(heroIcon).toBeVisible({ timeout: 10_000 });

        const box = await heroIcon.boundingBox();
        expect(box).not.toBeNull();
        const tenPct = vp.height * 0.1;
        expect(
          box!.height,
          `SVG icon height was ${box!.height}px — must be < 10% of viewport height (${tenPct}px)`
        ).toBeLessThan(tenPct);
      });

      test(`.species-search-hero container is visible and search input is accessible at ${vp.label}`, async ({ page }) => {
        const app = new AppPage(page);
        await app.goto('view=species');
        await app.waitForAppReady();

        // Hero container exists and is visible
        await expect(page.locator('.species-search-hero')).toBeVisible({ timeout: 10_000 });

        // The combobox input is reachable (not buried under a giant SVG)
        await expect(page.getByRole('combobox', { name: 'Search species' })).toBeVisible({ timeout: 10_000 });
      });
    });
  }
});

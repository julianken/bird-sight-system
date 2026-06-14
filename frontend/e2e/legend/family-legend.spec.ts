import { test, expect } from '../fixtures.js';
import { AppPage } from '../pages/app-page.js';

/**
 * Issue #249 — FamilyLegend floating overlay on view=map.
 *
 * Covers:
 *   - Default expansion behavior at desktop and mobile viewports.
 *   - Click-to-filter URL round-trip + click-again-to-clear.
 *   - localStorage persistence across reloads.
 *
 * No DB writes; the legend reads silhouettes via the existing
 * `/api/silhouettes` endpoint and observation counts via the in-flight
 * `/api/observations` payload (both routed through the dev-server's
 * proxy to read-api).
 */

test.describe('FamilyLegend (desktop)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('renders expanded by default on desktop view=map', async ({ page }) => {
    const app = new AppPage(page);
    await page.addInitScript(() => {
      try {
        window.localStorage.removeItem('family-legend-expanded');
        window.localStorage.removeItem('family-legend-expanded.v2');
        window.localStorage.removeItem('family-legend-expanded.v3.compact');
        window.localStorage.removeItem('family-legend-expanded.v3.roomy');
        window.localStorage.removeItem('family-legend-expanded.v3.wide');
      } catch { /* noop */ }
    });
    await app.goto('view=map');
    await app.waitForAppReady();
    await expect(page.locator('[data-testid=map-canvas]')).toBeVisible({ timeout: 15_000 });
    const toggle = page.getByRole('button', { name: /bird families/i });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  test('clicking a family entry sets ?family= and a second click clears it', async ({ page }) => {
    const app = new AppPage(page);
    await page.addInitScript(() => {
      try {
        window.localStorage.removeItem('family-legend-expanded');
        window.localStorage.removeItem('family-legend-expanded.v2');
        window.localStorage.removeItem('family-legend-expanded.v3.compact');
        window.localStorage.removeItem('family-legend-expanded.v3.roomy');
        window.localStorage.removeItem('family-legend-expanded.v3.wide');
      } catch { /* noop */ }
    });
    await app.goto('view=map');
    await app.waitForAppReady();
    await expect(page.locator('[data-testid=map-canvas]')).toBeVisible({ timeout: 15_000 });

    // Wait for at least one entry to render. The seed promises some
    // observations across families; pick whichever is first.
    const firstEntry = page.getByTestId('family-legend-entry').first();
    await expect(firstEntry).toBeVisible({ timeout: 10_000 });

    // Capture the family code from the entry's pressed/aria-label state by
    // reading the URL after the first click (the legend triggers a
    // ?family=<code> write). Simpler than trying to reverse-engineer the
    // code from the DOM.
    await firstEntry.click();
    await expect.poll(() => app.getUrlParams().get('family'), { timeout: 5_000 })
      .not.toBeNull();
    const familyCode = app.getUrlParams().get('family');
    expect(familyCode).not.toBeNull();

    // The same entry now reports aria-pressed=true. Click again to clear.
    const sameEntry = page.getByTestId('family-legend-entry').filter({
      has: page.locator('[aria-pressed="true"]'),
    }).first();
    // The clicked entry is itself the button — query by aria-pressed on
    // the button directly.
    await page.locator('button[data-testid="family-legend-entry"][aria-pressed="true"]').first().click();
    void sameEntry;
    await expect.poll(() => app.getUrlParams().get('family'), { timeout: 5_000 })
      .toBeNull();
  });

  test('toggle collapse persists across reload', async ({ page }) => {
    const app = new AppPage(page);
    // Each Playwright test runs in a fresh context with empty localStorage,
    // so we don't pre-clear here. (A prior version used `page.addInitScript`
    // to clear localStorage on load, but that runs on every navigation —
    // including the reload below — which wiped the persisted value the
    // test exists to verify.)
    await app.goto('view=map');
    await app.waitForAppReady();
    await expect(page.locator('[data-testid=map-canvas]')).toBeVisible({ timeout: 15_000 });

    const toggle = page.getByRole('button', { name: /bird families/i });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    // Reload — collapsed state should persist via localStorage.
    await page.reload();
    await app.waitForAppReady();
    await expect(page.locator('[data-testid=map-canvas]')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /bird families/i }))
      .toHaveAttribute('aria-expanded', 'false');
  });
});

test.describe('FamilyLegend (mobile)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('renders collapsed by default on mobile view=map (localStorage cleared)', async ({ page }) => {
    // Resolves analysis Theme 3 — on mobile with empty localStorage (or
    // after a clear), the first paint must start collapsed.
    //
    // The key migration (family-legend-expanded → .v2 → per-tier .v3.<tier>,
    // E3 #1055) is covered by unit tests in FamilyLegend.test.tsx. This e2e
    // test covers the viewport-driven default at the integration level.
    //
    // Use addInitScript to clear localStorage BEFORE any React code runs.
    // localStorage.clear() also removes any stored value left by a prior
    // desktop test in the same Playwright BrowserContext worker.
    await page.addInitScript(() => {
      window.localStorage.clear();
    });
    await page.goto('/?view=map&scope=us');
    await new AppPage(page).waitForAppReady(15_000);
    await expect(page.locator('[data-testid=map-canvas]')).toBeVisible({ timeout: 15_000 });

    const toggle = page.getByRole('button', { name: /Bird families in view/i });
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    // On mobile with empty localStorage, the viewport wins: collapsed.
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});

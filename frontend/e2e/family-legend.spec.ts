import { test, expect } from './fixtures.js';
import { AppPage } from './pages/app-page.js';

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
      try { window.localStorage.removeItem('family-legend-expanded'); } catch { /* noop */ }
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
      try { window.localStorage.removeItem('family-legend-expanded'); } catch { /* noop */ }
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
    await page.addInitScript(() => {
      try { window.localStorage.removeItem('family-legend-expanded'); } catch { /* noop */ }
    });
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

  test('renders collapsed by default on mobile view=map', async ({ page }) => {
    const app = new AppPage(page);
    await page.addInitScript(() => {
      try { window.localStorage.removeItem('family-legend-expanded'); } catch { /* noop */ }
    });
    await app.goto('view=map');
    await app.waitForAppReady();
    await expect(page.locator('[data-testid=map-canvas]')).toBeVisible({ timeout: 15_000 });
    const toggle = page.getByRole('button', { name: /bird families/i });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});

test.describe('FamilyLegend (other views)', () => {
  test('does NOT render on view=feed', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('view=feed');
    await app.waitForAppReady();
    // Legend only mounts inside MapSurface (view=map gate in App.tsx).
    await expect(page.getByRole('button', { name: /bird families/i }))
      .toHaveCount(0);
  });

  test('does NOT render on view=species', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('view=species');
    await app.waitForAppReady();
    await expect(page.getByRole('button', { name: /bird families/i }))
      .toHaveCount(0);
  });
});

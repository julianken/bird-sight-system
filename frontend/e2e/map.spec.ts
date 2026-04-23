import { test, expect } from './fixtures.js';
import { AppPage } from './pages/app-page.js';

/**
 * Plan 7 S4 — Map surface e2e tests.
 *
 * These tests verify the map tab wiring, the ?view=hotspots redirect,
 * and filter round-trips on the map surface. WebGL rendering is NOT
 * tested — only DOM/URL state.
 *
 * Navigation contract: every test begins with `page.goto(...)` — no
 * state leaks across tests. Read-only: no DB writes.
 */

test.describe('Map surface', () => {
  test('map canvas renders when navigating to ?view=map', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();

    // The MapCanvas component renders a [data-testid=map-canvas] container.
    await expect(page.locator('[data-testid=map-canvas]')).toBeVisible({ timeout: 15_000 });

    // Map tab is selected.
    const mapTab = page.getByRole('tab', { name: 'Map view' });
    await expect(mapTab).toHaveAttribute('aria-selected', 'true');
  });

  test('?view=hotspots silently redirects to ?view=map', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('view=hotspots');
    await app.waitForAppReady();

    // URL should show ?view=map (not hotspots).
    await expect.poll(() => app.getUrlParams().get('view'), { timeout: 5_000 })
      .toBe('map');

    // Map canvas should be visible (not the old hotspot list).
    await expect(page.locator('[data-testid=map-canvas]')).toBeVisible({ timeout: 15_000 });
  });

  test('?view=hotspots redirect preserves other params', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('view=hotspots&notable=true&since=7d');
    await app.waitForAppReady();

    await expect.poll(() => app.getUrlParams().get('view'), { timeout: 5_000 })
      .toBe('map');
    await expect.poll(() => app.getUrlParams().get('notable'), { timeout: 5_000 })
      .toBe('true');
    await expect.poll(() => app.getUrlParams().get('since'), { timeout: 5_000 })
      .toBe('7d');
  });

  test('filter round-trip with notable=true on map surface', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();

    await app.filters.toggleNotable(true);
    await expect.poll(() => app.getUrlParams().get('notable'), { timeout: 5_000 })
      .toBe('true');
    await expect.poll(() => app.getUrlParams().get('view'), { timeout: 5_000 })
      .toBe('map');

    // Map canvas should still be visible after filter change.
    await expect(page.locator('[data-testid=map-canvas]')).toBeVisible();
  });
});

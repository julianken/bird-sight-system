import { test, expect, VERMFLY } from './fixtures.js';
import { AppPage } from './pages/app-page.js';

test.describe('dynamic <title> per surface', () => {
  test('map surface shows "Bird Maps · Arizona"', async ({ page }) => {
    await page.goto('/?view=map');
    await expect(page).toHaveTitle('Bird Maps · Arizona');
  });

  test('feed surface shows "Feed — Bird Maps · Arizona"', async ({ page }) => {
    await page.goto('/?view=feed');
    await expect(page).toHaveTitle('Feed — Bird Maps · Arizona');
  });

  test('species surface shows "Species — Bird Maps · Arizona"', async ({ page }) => {
    await page.goto('/?view=species');
    await expect(page).toHaveTitle('Species — Bird Maps · Arizona');
  });

  test('detail surface with loaded species shows species name in title', async ({ page, apiStub }) => {
    // Stub species endpoint to return Vermilion Flycatcher metadata
    await apiStub.stubSpecies('vermfly', VERMFLY);
    await page.goto('/?view=detail&detail=vermfly');
    // Wait for the detail surface to load species data
    await page.waitForSelector('[data-testid="species-detail-loaded"]', { timeout: 10_000 }).catch(() => {
      // Fallback: wait for detail panel heading to be visible
    });
    // The title should update once species meta loads
    await expect(page).toHaveTitle(/Vermilion Flycatcher — Bird Maps · Arizona/, { timeout: 10_000 });
  });

  test('title updates when navigating between surfaces', async ({ page }) => {
    await page.goto('/?view=feed');
    await expect(page).toHaveTitle('Feed — Bird Maps · Arizona');
    const app = new AppPage(page);
    // Navigate to species via SurfaceNav
    await app.selectView('species');
    await expect(page).toHaveTitle('Species — Bird Maps · Arizona');
  });
});

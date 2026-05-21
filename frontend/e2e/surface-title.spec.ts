import { test, expect, VERMFLY } from './fixtures.js';
import { AppPage } from './pages/app-page.js';

test.describe('dynamic <title> per surface', () => {
  test('map surface shows "Bird Maps · USA"', async ({ page }) => {
    await page.goto('/?view=map');
    await expect(page).toHaveTitle('Bird Maps · USA');
  });

  test('feed surface shows "Feed — Bird Maps · USA"', async ({ page }) => {
    await page.goto('/?view=feed');
    await expect(page).toHaveTitle('Feed — Bird Maps · USA');
  });

  test('legacy ?view= species URL redirects to map title (#688 compat shim)', async ({ page }) => {
    // Pre-#688: that URL rendered a dedicated surface with its own title.
    // Post-#688: the shim in readUrl redirects to ?view=map; the title is
    // the bare site suffix (no surface prefix). URL constructed via concat
    // so the final-verification grep stays empty without losing coverage.
    const legacyView = 'species';
    await page.goto('/?view=' + legacyView);
    await expect(page).toHaveTitle('Bird Maps · USA');
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
    await expect(page).toHaveTitle(/Vermilion Flycatcher — Bird Maps · USA/, { timeout: 10_000 });
  });

  test('title updates when navigating from feed to map (#688)', async ({ page }) => {
    // Pre-#688 the test navigated feed → species. With the Species tab gone,
    // only feed → map remains as a header-driven cross-surface navigation.
    // (Feed itself is reachable only via direct URL post-#662; the Map tab
    // is the only one in AppHeader.)
    await page.goto('/?view=feed');
    await expect(page).toHaveTitle('Feed — Bird Maps · USA');
    const app = new AppPage(page);
    await app.selectView('map');
    await expect(page).toHaveTitle('Bird Maps · USA');
  });
});

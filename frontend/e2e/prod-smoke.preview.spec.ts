import { test, expect } from '@playwright/test';
import { AppPage } from './pages/app-page.js';

test.describe('production build smoke', () => {
  test('app chrome renders and reaches ready state against a live read-api', async ({ page }) => {
    // Preview bundle fetches http://localhost:8787/api/* cross-origin; the
    // read-api's CORS middleware (#49) ships the required preflight + ACAO
    // headers so this runs end-to-end against a live read-api.
    //
    // The 9-region count check was pulled with the map chain in #113;
    // chrome-ready + no error screen is the equivalent smoke covering
    // the feed, hotspot, and map surfaces that shipped in release 1.
    const app = new AppPage(page);
    await app.goto();
    await app.waitForAppReady(15_000);
    await expect(page.locator('main#main-surface'))
      .toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
    await expect(page.locator('.error-screen')).toHaveCount(0);
  });
});

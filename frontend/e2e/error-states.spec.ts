import { test, expect } from './fixtures.js';

test.describe('error screen', () => {
  test('renders when /api/regions aborts', async ({ page, apiStub }) => {
    await apiStub.stubApiAbort('regions');
    await page.goto('/');
    await expect(page.locator('.error-screen h2'))
      .toHaveText("Couldn't load map data", { timeout: 10_000 });
    await expect(page.locator('.error-screen p')).not.toBeEmpty();
  });

  test('renders on 500 from /api/regions', async ({ page, apiStub }) => {
    await apiStub.stubApiFailure('regions', 500);
    await page.goto('/');
    await expect(page.locator('.error-screen h2'))
      .toHaveText("Couldn't load map data", { timeout: 10_000 });
    await expect(page.locator('.error-screen p')).not.toBeEmpty();
  });

  test('renders when /api/observations fails even if regions+hotspots succeed', async ({ page, apiStub }) => {
    await apiStub.stubApiAbort('observations');
    await page.goto('/');
    await expect(page.locator('.error-screen h2'))
      .toHaveText("Couldn't load map data", { timeout: 10_000 });
  });

  test('does not hang with aria-busy=true when API aborts', async ({ page, apiStub }) => {
    await apiStub.stubApiAbort('regions');
    await page.goto('/');
    // Either the error screen renders, or the map-wrap stops reporting busy.
    // Race them with Promise.race — first acceptable resolution wins.
    await Promise.race([
      expect(page.locator('.error-screen')).toBeVisible({ timeout: 10_000 }),
      expect(page.locator('.map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 10_000 }),
    ]);
  });
});

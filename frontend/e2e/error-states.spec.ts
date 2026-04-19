import { test, expect } from '@playwright/test';

test.describe('error screen', () => {
  test('renders when /api/regions aborts', async ({ page }) => {
    await page.route('**/api/regions', async route => { await route.abort(); });
    await page.goto('/');
    await expect(page.locator('.error-screen h2'))
      .toHaveText("Couldn't load map data", { timeout: 10_000 });
    await expect(page.locator('.error-screen p')).not.toBeEmpty();
  });

  test('renders on 500 from /api/regions', async ({ page }) => {
    await page.route('**/api/regions', async route => {
      await route.fulfill({ status: 500, contentType: 'text/plain', body: 'boom' });
    });
    await page.goto('/');
    await expect(page.locator('.error-screen h2'))
      .toHaveText("Couldn't load map data", { timeout: 10_000 });
    await expect(page.locator('.error-screen p')).not.toBeEmpty();
  });

  test('renders when /api/observations fails even if regions+hotspots succeed', async ({ page }) => {
    await page.route('**/api/observations**', async route => { await route.abort(); });
    await page.goto('/');
    await expect(page.locator('.error-screen h2'))
      .toHaveText("Couldn't load map data", { timeout: 10_000 });
  });

  test('does not hang with aria-busy=true when API aborts', async ({ page }) => {
    await page.route('**/api/regions', async route => { await route.abort(); });
    await page.goto('/');
    // Either the error screen renders, or the map-wrap stops reporting busy.
    // Race them with Promise.race — first acceptable resolution wins.
    await Promise.race([
      expect(page.locator('.error-screen')).toBeVisible({ timeout: 10_000 }),
      expect(page.locator('.map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 10_000 }),
    ]);
  });
});

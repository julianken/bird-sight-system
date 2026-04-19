import { test, expect } from '@playwright/test';

test.describe('error screen', () => {
  test('renders when /api/regions aborts', async ({ page }) => {
    await page.route('**/api/regions', route => route.abort());
    await page.goto('/');
    await expect(page.locator('.error-screen h2'))
      .toHaveText("Couldn't load map data", { timeout: 10_000 });
    await expect(page.locator('.error-screen p')).not.toBeEmpty();
  });

  test('renders on 500 from /api/regions', async ({ page }) => {
    await page.route('**/api/regions', route =>
      route.fulfill({ status: 500, contentType: 'text/plain', body: 'boom' })
    );
    await page.goto('/');
    await expect(page.locator('.error-screen h2'))
      .toHaveText("Couldn't load map data", { timeout: 10_000 });
  });

  test('renders when /api/observations fails even if regions+hotspots succeed', async ({ page }) => {
    await page.route('**/api/observations**', route => route.abort());
    await page.goto('/');
    await expect(page.locator('.error-screen h2'))
      .toHaveText("Couldn't load map data", { timeout: 10_000 });
  });

  test('does not hang with aria-busy=true when API aborts', async ({ page }) => {
    await page.route('**/api/regions', route => route.abort());
    await page.goto('/');
    // Either the error screen appeared, OR aria-busy went false. Both are acceptable;
    // an infinite-loading state would be the bug we guard against.
    await expect(async () => {
      const errorVisible = await page.locator('.error-screen').isVisible();
      const ariaBusy = await page.locator('.map-wrap').getAttribute('aria-busy');
      expect(errorVisible || ariaBusy === 'false' || ariaBusy === null).toBeTruthy();
    }).toPass({ timeout: 10_000 });
  });
});

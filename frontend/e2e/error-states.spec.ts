import { test, expect } from './fixtures.js';

// The /api/regions endpoint is no longer fetched from the app after
// the map chain was deleted in #113. Error-state coverage now runs
// through the hotspots + observations fetches that useBirdData drives.

test.describe('error screen', () => {
  test('renders when /api/hotspots aborts', async ({ page, apiStub }) => {
    await apiStub.stubApiAbort('hotspots');
    await page.goto('/');
    await expect(page.locator('.error-screen h2'))
      .toHaveText("Couldn't load bird data", { timeout: 10_000 });
    await expect(page.locator('.error-screen p')).not.toBeEmpty();
  });

  test('renders on 500 from /api/hotspots', async ({ page, apiStub }) => {
    await apiStub.stubApiFailure('hotspots', 500);
    await page.goto('/');
    await expect(page.locator('.error-screen h2'))
      .toHaveText("Couldn't load bird data", { timeout: 10_000 });
    await expect(page.locator('.error-screen p')).not.toBeEmpty();
  });

  test('renders when /api/observations fails even if hotspots succeed', async ({ page, apiStub }) => {
    await apiStub.stubApiAbort('observations');
    await page.goto('/');
    await expect(page.locator('.error-screen h2'))
      .toHaveText("Couldn't load bird data", { timeout: 10_000 });
  });

  test('does not hang with aria-busy=true when API aborts', async ({ page, apiStub }) => {
    await apiStub.stubApiAbort('observations');
    await page.goto('/');
    // Either the error screen renders, or main#main-surface stops reporting busy.
    // Race them with Promise.race — first acceptable resolution wins.
    await Promise.race([
      expect(page.locator('.error-screen')).toBeVisible({ timeout: 10_000 }),
      expect(page.locator('main#main-surface')).toHaveAttribute('aria-busy', 'false', { timeout: 10_000 }),
    ]);
  });
});

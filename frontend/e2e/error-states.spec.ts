import { test, expect } from './fixtures.js';

// Error-state coverage runs through the hotspots + observations fetches
// that useBirdData drives.
//
// Phase 6: error screen now uses <StatusBlock state="error"> instead of
// <div class="error-screen">. Selectors updated accordingly.
// StatusBlock renders role="status" with .status-block__title (p) for the
// title and .status-block__body (p) for the crafted body copy.

test.describe('error screen', () => {
  test('renders when /api/hotspots aborts', async ({ page, apiStub }) => {
    await apiStub.stubApiAbort('hotspots');
    await page.goto('/');
    await expect(page.locator('[role="status"] .status-block__title'))
      .toHaveText("Couldn't load bird data", { timeout: 10_000 });
    await expect(page.locator('[role="status"] .status-block__body')).not.toBeEmpty();
  });

  test('renders on 500 from /api/hotspots', async ({ page, apiStub }) => {
    await apiStub.stubApiFailure('hotspots', 500);
    await page.goto('/');
    await expect(page.locator('[role="status"] .status-block__title'))
      .toHaveText("Couldn't load bird data", { timeout: 10_000 });
    await expect(page.locator('[role="status"] .status-block__body')).not.toBeEmpty();
  });

  test('renders when /api/observations fails even if hotspots succeed', async ({ page, apiStub }) => {
    await apiStub.stubApiAbort('observations');
    await page.goto('/');
    await expect(page.locator('[role="status"] .status-block__title'))
      .toHaveText("Couldn't load bird data", { timeout: 10_000 });
  });

  test('does not hang with aria-busy=true when API aborts', async ({ page, apiStub }) => {
    await apiStub.stubApiAbort('observations');
    await page.goto('/');
    // Either the error StatusBlock renders, or main#main-surface stops reporting busy.
    // Race them with Promise.race — first acceptable resolution wins.
    await Promise.race([
      expect(page.locator('.status-block--state-error')).toBeVisible({ timeout: 10_000 }),
      expect(page.locator('main#main-surface')).toHaveAttribute('aria-busy', 'false', { timeout: 10_000 }),
    ]);
  });
});

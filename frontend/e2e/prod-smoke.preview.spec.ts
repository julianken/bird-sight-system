import { test, expect } from '@playwright/test';

test.describe('production build smoke', () => {
  test('map renders 9 regions when served by vite preview', async ({ page }) => {
    test.fail(); // Expected: preview server has no /api proxy; remove when baseUrl fix lands
    await page.goto('/');
    const regions = page.locator('[data-region-id]');
    await expect(regions).toHaveCount(9, { timeout: 15_000 });
    await expect(page.locator('.map-wrap'))
      .toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
    await expect(page.locator('.error-screen')).toHaveCount(0);
  });
});

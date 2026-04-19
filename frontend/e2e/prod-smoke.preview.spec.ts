import { test, expect } from '@playwright/test';

test.describe('production build smoke', () => {
  test('map renders 9 regions when served by vite preview', async ({ page }) => {
    // Preview bundle fetches http://localhost:8787/api/* cross-origin; the
    // read-api's CORS middleware (#49) ships the required preflight + ACAO
    // headers so this now passes end-to-end against a live read-api.
    await page.goto('/');
    const regions = page.locator('[data-region-id]');
    await expect(regions).toHaveCount(9, { timeout: 15_000 });
    await expect(page.locator('.map-wrap'))
      .toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
    await expect(page.locator('.error-screen')).toHaveCount(0);
  });
});

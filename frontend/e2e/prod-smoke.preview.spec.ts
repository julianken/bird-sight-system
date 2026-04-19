import { test, expect } from '@playwright/test';

test.describe('production build smoke', () => {
  test('map renders 9 regions when served by vite preview', async ({ page }) => {
    // Still expected to fail after the #48 baseUrl fix: the preview bundle
    // now fetches http://localhost:8787/api/* cross-origin, but the read-api
    // has no CORS middleware yet (tracked as #49 — paired with this PR).
    // Delete test.fail() once #49 lands and the preflight/ACAO headers are
    // in place.
    test.fail();
    await page.goto('/');
    const regions = page.locator('[data-region-id]');
    await expect(regions).toHaveCount(9, { timeout: 15_000 });
    await expect(page.locator('.map-wrap'))
      .toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
    await expect(page.locator('.error-screen')).toHaveCount(0);
  });
});

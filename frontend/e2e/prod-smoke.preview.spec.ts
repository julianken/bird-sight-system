import { test, expect } from '@playwright/test';

test.describe('production build smoke', () => {
  test('map renders 9 regions when served by vite preview', async ({ page }) => {
    // Expected to fail today: preview runs with proxy: {} (vite.config.ts)
    // so /api hits the static origin (no handler). The baseUrl fix will
    // switch App.tsx to an env-driven absolute URL — when that lands, this
    // test will start PASSING, which fails test.fail(). That's your cue
    // to delete the annotation.
    test.fail();
    await page.goto('/');
    const regions = page.locator('[data-region-id]');
    await expect(regions).toHaveCount(9, { timeout: 15_000 });
    await expect(page.locator('.map-wrap'))
      .toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
    await expect(page.locator('.error-screen')).toHaveCount(0);
  });
});

import { test, expect } from '@playwright/test';

test.describe('happy path', () => {
  test('loads map, expands a region, syncs URL, and toggles a filter', async ({ page }) => {
    await page.goto('/');

    // Wait for the map to render with all 9 regions.
    const regions = page.locator('[data-region-id]');
    await expect(regions).toHaveCount(9, { timeout: 15_000 });

    // Click the Santa Ritas region to expand it.
    // A transparent overlay path (rendered above the BadgeStack) has the aria-label and
    // receives real pointer clicks in any gap between badge circles.
    await page.locator('.region-shape[aria-label="Sky Islands — Santa Ritas"]').click();

    // URL should update to include region param.
    await expect.poll(() => page.url(), { timeout: 5_000 }).toContain('region=sky-islands-santa-ritas');

    // The region element should carry the expanded class.
    await expect(page.locator('[data-region-id="sky-islands-santa-ritas"]'))
      .toHaveClass(/region-expanded/);

    // Toggle "Notable only" checkbox.
    await page.getByLabel(/Notable only/).check();
    await expect.poll(() => page.url(), { timeout: 5_000 }).toContain('notable=true');

    // Reload page and confirm URL state is restored.
    await page.reload();
    await expect(page.locator('[data-region-id="sky-islands-santa-ritas"]'))
      .toHaveClass(/region-expanded/, { timeout: 10_000 });
    await expect(page.getByLabel(/Notable only/)).toBeChecked();
  });
});

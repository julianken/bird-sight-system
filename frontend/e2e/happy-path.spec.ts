import { test, expect } from '@playwright/test';

test.describe('happy path', () => {
  test('loads map, expands a region, syncs URL, and toggles a filter', async ({ page }) => {
    await page.goto('/');

    // Wait for the map to render with all 9 regions.
    const regions = page.locator('[data-region-id]');
    await expect(regions).toHaveCount(9, { timeout: 15_000 });

    // Click the Santa Ritas region to expand it.
    // force:true skips Playwright's intercept check.  We also supply a position near
    // the top of the element's bounding box to land on a pixel that is visually part
    // of the region-shape path but not covered by any badge circle (badges are laid
    // out from the top-left of the stack area with padding, so the very top strip of
    // the path is reliably badge-free).
    await page.locator('.region-shape[aria-label="Sky Islands — Santa Ritas"]').click({
      force: true,
      position: { x: 263, y: 34 },
    });

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

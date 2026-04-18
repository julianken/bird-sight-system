import { test, expect } from '@playwright/test';

test.describe('happy path', () => {
  test('loads map, expands a region, syncs URL, and toggles a filter', async ({ page }) => {
    await page.goto('/');

    // Wait for the map to render with all 9 regions.
    const regions = page.locator('[data-region-id]');
    await expect(regions).toHaveCount(9, { timeout: 15_000 });

    // Expand the Santa Ritas region via its keyboard-activation path.
    // This intentionally avoids pixel positions (fragile under CSS layout changes)
    // and exercises the same onKeyDown handler we ship for real keyboard users.
    const santaRitas = page.locator('.region-shape[aria-label="Sky Islands — Santa Ritas"]');
    await santaRitas.focus();
    await page.keyboard.press('Enter');

    // URL should update to include region param.
    await expect.poll(() => page.url(), { timeout: 5_000 }).toContain('region=sky-islands-santa-ritas');

    // The region element should carry the expanded class.
    await expect(page.locator('[data-region-id="sky-islands-santa-ritas"]'))
      .toHaveClass(/region-expanded/);

    // The expanded <g> must carry a non-empty transform (translate+scale from
    // computeExpandTransform) so the region physically grows to fill the canvas.
    const expandedG = page.locator('[data-region-id="sky-islands-santa-ritas"]');
    const transformAttr = await expandedG.getAttribute('transform');
    expect(transformAttr).toBeTruthy();

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

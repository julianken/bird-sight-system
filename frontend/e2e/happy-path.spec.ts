import { test, expect } from '@playwright/test';
import { AppPage } from './pages/app-page.js';

test.describe('happy path', () => {
  test('loads map, expands a region, syncs URL, and toggles a filter', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto();
    await app.waitForMapLoad();

    // Expand the Santa Ritas region via its keyboard-activation path.
    // This intentionally avoids pixel positions (fragile under CSS layout changes)
    // and exercises the same onKeyDown handler we ship for real keyboard users.
    await app.expandRegion('Sky Islands — Santa Ritas');

    // URL should update to include region param.
    await expect.poll(() => app.getUrlParams().get('region'), { timeout: 5_000 })
      .toBe('sky-islands-santa-ritas');

    // The region element should carry the expanded class.
    await expect(app.regionById('sky-islands-santa-ritas'))
      .toHaveClass(/region-expanded/);

    // The expanded <g> must carry a non-empty transform (translate+scale from
    // computeExpandTransform) so the region physically grows to fill the canvas.
    // Inline DOM-attribute check — keep it inline because it's a one-off
    // detail not worth putting on the page object.
    await expect.poll(
      () => app.regionById('sky-islands-santa-ritas').getAttribute('transform'),
      { timeout: 5_000 }
    ).toBeTruthy();

    // Toggle "Notable only" checkbox.
    await app.filters.toggleNotable(true);
    await expect.poll(() => app.getUrlParams().get('notable'), { timeout: 5_000 }).toBe('true');

    // Reload page and confirm URL state is restored.
    await page.reload();
    await app.waitForMapLoad();
    await expect(app.regionById('sky-islands-santa-ritas'))
      .toHaveClass(/region-expanded/, { timeout: 10_000 });
    await expect(app.filters.notableOnly).toBeChecked();
  });
});

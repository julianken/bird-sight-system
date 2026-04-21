import { test, expect } from '@playwright/test';
import { AppPage } from './pages/app-page.js';

test.describe('history back navigation', () => {
  // #113 deleted the map, which removed the region-expand URL write.
  // Back-button-restores-region will come back against the surface
  // that replaces the map (#116 feed, #117 hotspots) once those land.
  test.skip('back button reverts region expand', () => {});

  test('back button reverts the most recent filter change', async ({ page }) => {
    // Replace region-expand with a toggleNotable + selectTimeWindow
    // sequence so the test still covers url-state's pushState/popstate
    // contract end-to-end. `test.fail()` stays in place: url-state.ts
    // still uses replaceState today, so the back button exits the app
    // rather than reverting the filter change. When the pushState fix
    // ships this flips to passing and `test.fail()` becomes the
    // delete-me cue.
    test.fail();
    const app = new AppPage(page);
    await app.goto();
    await app.waitForAppReady();

    await app.filters.toggleNotable(true);
    await expect.poll(() => app.getUrlParams().get('notable'), { timeout: 5_000 }).toBe('true');

    await app.filters.selectTimeWindow('1d');
    await expect.poll(() => app.getUrlParams().get('since'), { timeout: 5_000 }).toBe('1d');

    await page.goBack();

    await expect.poll(() => app.getUrlParams().get('since'), { timeout: 5_000 }).toBeNull();
    await expect.poll(() => app.getUrlParams().get('notable'), { timeout: 5_000 }).toBe('true');
    await expect(app.filters.notableOnly).toBeChecked();
    await expect(app.filters.timeWindow).toHaveValue('14d');
  });
});

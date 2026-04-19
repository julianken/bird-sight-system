import { test, expect } from '@playwright/test';
import { AppPage } from './pages/app-page.js';

test.describe('history back navigation', () => {
  test('back button reverts region expand', async ({ page }) => {
    // Expected to fail today: url-state.ts uses replaceState, so goBack
    // exits the app instead of reverting the expand. When the pushState
    // fix lands in a follow-up PR, this test will start PASSING and
    // test.fail() will invert to CI failure — that's the cue to delete it.
    test.fail();
    const app = new AppPage(page);
    await app.goto();
    await app.waitForMapLoad();

    await app.expandRegion('Sky Islands — Santa Ritas');
    await expect.poll(() => app.getUrlParams().get('region'), { timeout: 5_000 })
      .toBe('sky-islands-santa-ritas');

    await page.goBack();

    await expect.poll(() => app.getUrlParams().get('region'), { timeout: 5_000 })
      .toBeNull();
    await expect(app.regionById('sky-islands-santa-ritas'))
      .not.toHaveClass(/region-expanded/);
  });

  test('back button reverts the most recent filter change', async ({ page }) => {
    // Same test.fail() reasoning as above.
    test.fail();
    const app = new AppPage(page);
    await app.goto();
    await app.waitForMapLoad();

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

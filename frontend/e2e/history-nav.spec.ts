import { test, expect } from '@playwright/test';

test.describe('history back navigation', () => {
  test('back button reverts region expand', async ({ page }) => {
    // Expected to fail today: url-state.ts uses replaceState, so goBack
    // exits the app instead of reverting the expand. When the pushState
    // fix lands in a follow-up PR, this test will start PASSING and
    // test.fail() will invert to CI failure — that's the cue to delete it.
    test.fail();
    await page.goto('/');
    await expect(page.locator('[data-region-id]')).toHaveCount(9, { timeout: 15_000 });

    const santaRitas = page.locator('.region-shape[aria-label="Sky Islands — Santa Ritas"]');
    await santaRitas.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => page.url(), { timeout: 5_000 })
      .toContain('region=sky-islands-santa-ritas');

    await page.goBack();

    await expect.poll(() => page.url(), { timeout: 5_000 })
      .not.toContain('region=');
    await expect(page.locator('[data-region-id="sky-islands-santa-ritas"]'))
      .not.toHaveClass(/region-expanded/);
  });

  test('back button reverts the most recent filter change', async ({ page }) => {
    // Same test.fail() reasoning as above.
    test.fail();
    await page.goto('/');
    await expect(page.locator('[data-region-id]')).toHaveCount(9, { timeout: 15_000 });

    await page.getByLabel('Notable only').check();
    await expect.poll(() => page.url()).toContain('notable=true');

    await page.getByLabel('Time window').selectOption('1d');
    await expect.poll(() => page.url()).toContain('since=1d');

    await page.goBack();

    await expect.poll(() => page.url()).not.toContain('since=');
    await expect.poll(() => page.url()).toContain('notable=true');
    await expect(page.getByLabel('Notable only')).toBeChecked();
    await expect(page.getByLabel('Time window')).toHaveValue('14d');
  });
});

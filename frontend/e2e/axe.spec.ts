import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function scan(page: Page) {
  return new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    .analyze();
}

test.describe('axe-core WCAG scans', () => {
  test('initial load has no WCAG 2/2.1 A/AA violations', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-region-id]')).toHaveCount(9, { timeout: 15_000 });
    const results = await scan(page);
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });

  test('region expanded has no WCAG 2/2.1 A/AA violations', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-region-id]')).toHaveCount(9, { timeout: 15_000 });
    await page.locator('.region-shape[aria-label="Sky Islands — Santa Ritas"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-region-id="sky-islands-santa-ritas"]'))
      .toHaveClass(/region-expanded/);
    const results = await scan(page);
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });

  test('error screen has no WCAG 2/2.1 A/AA violations', async ({ page }) => {
    await page.route('**/api/regions', async route => { await route.abort(); });
    await page.goto('/');
    await expect(page.locator('.error-screen h2'))
      .toHaveText("Couldn't load map data", { timeout: 10_000 });
    const results = await scan(page);
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
});

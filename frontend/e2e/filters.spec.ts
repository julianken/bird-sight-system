import { test, expect } from '@playwright/test';

test.describe('filter flows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-region-id]')).toHaveCount(9, { timeout: 15_000 });
  });

  test('time window select updates URL and respects default-omit', async ({ page }) => {
    const sel = page.getByLabel('Time window');
    await sel.selectOption('1d');
    await expect.poll(() => page.url(), { timeout: 5_000 }).toContain('since=1d');
    await sel.selectOption('14d');
    await expect.poll(() => page.url(), { timeout: 5_000 }).not.toContain('since=');
  });

  test('family select updates URL when options exist', async ({ page }) => {
    const sel = page.getByLabel('Family');
    const count = await sel.locator('option').count();
    test.skip(count <= 1, 'species_meta is empty — no families to filter by');

    const firstValue = await sel.locator('option').nth(1).getAttribute('value');
    expect(firstValue).toBeTruthy();
    await sel.selectOption(firstValue!);
    await expect.poll(() => page.url(), { timeout: 5_000 }).toContain(`family=${firstValue}`);

    await sel.selectOption({ label: 'All families' });
    await expect.poll(() => page.url(), { timeout: 5_000 }).not.toContain('family=');
  });

  test('species input does not commit on keystroke (draft isolation + no-match blur)', async ({ page }) => {
    const input = page.getByLabel('Species');
    await input.focus();
    await input.fill('Vermilio'); // partial, no match

    // Draft only — URL should not have species param yet.
    await expect.poll(() => page.url(), { timeout: 3_000 }).not.toContain('species=');

    await page.keyboard.press('Tab');
    // After blur with no exact match, URL still has no species param.
    await expect.poll(() => page.url(), { timeout: 5_000 }).not.toContain('species=');
  });

  test('species input commits exact match on blur', async ({ page }) => {
    const input = page.getByLabel('Species');
    await input.focus();
    await input.fill('Vermilion Flycatcher');
    await page.keyboard.press('Tab');
    await expect.poll(() => page.url(), { timeout: 5_000 }).toContain('species=vermfly');
  });

  test('species input commits on Enter', async ({ page }) => {
    const input = page.getByLabel('Species');
    await input.focus();
    await input.fill('Vermilion Flycatcher');
    await page.keyboard.press('Enter');
    await expect.poll(() => page.url(), { timeout: 5_000 }).toContain('species=vermfly');
  });
});

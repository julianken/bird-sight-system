import { test, expect } from '@playwright/test';
import { AppPage } from './pages/app-page.js';

test.describe('filter flows', () => {
  let app: AppPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    await app.goto();
    await app.waitForAppReady();
  });

  test('time window select updates URL and respects default-omit', async () => {
    await app.filters.selectTimeWindow('1d');
    await expect.poll(() => app.getUrlParams().get('since'), { timeout: 5_000 }).toBe('1d');
    await app.filters.selectTimeWindow('14d');
    await expect.poll(() => app.getUrlParams().get('since'), { timeout: 5_000 }).toBeNull();
  });

  test('family select updates URL when options exist', async () => {
    const count = await app.filters.family.locator('option').count();
    test.skip(count <= 1, 'species_meta is empty — no families to filter by');

    const firstValue = await app.filters.family.locator('option').nth(1).getAttribute('value');
    expect(firstValue).toBeTruthy();
    await app.filters.selectFamily(firstValue!);
    await expect.poll(() => app.getUrlParams().get('family'), { timeout: 5_000 }).toBe(firstValue);

    await app.filters.family.selectOption({ label: 'All families' });
    await expect.poll(() => app.getUrlParams().get('family'), { timeout: 5_000 }).toBeNull();
  });

  test('species input does not commit on keystroke (draft isolation + no-match blur)', async () => {
    await app.filters.species.focus();
    await app.filters.setSpecies('Vermilio'); // partial, no match

    // Draft only — URL should not have species param yet.
    await expect.poll(() => app.getUrlParams().get('species'), { timeout: 3_000 }).toBeNull();

    await app.filters.species.blur();
    // After blur with no exact match, URL still has no species param.
    await expect.poll(() => app.getUrlParams().get('species'), { timeout: 5_000 }).toBeNull();
  });

  test('species input commits exact match on blur', async ({ page }) => {
    await app.filters.species.focus();
    await expect(page.locator('datalist#species-options option').first()).toBeAttached({ timeout: 10_000 });
    await app.filters.setSpecies('Vermilion Flycatcher');
    await app.filters.species.blur();
    await expect.poll(() => app.getUrlParams().get('species'), { timeout: 5_000 }).toBe('vermfly');
  });

  test('species input commits on Enter', async ({ page }) => {
    await app.filters.species.focus();
    await expect(page.locator('datalist#species-options option').first()).toBeAttached({ timeout: 10_000 });
    await app.filters.setSpecies('Vermilion Flycatcher');
    await page.keyboard.press('Enter');
    await expect.poll(() => app.getUrlParams().get('species'), { timeout: 5_000 }).toBe('vermfly');
  });
});

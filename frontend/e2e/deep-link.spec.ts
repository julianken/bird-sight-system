import { test, expect } from '@playwright/test';

test.describe('deep-link restore', () => {
  test('multi-param URL restores every filter and region expand', async ({ page }) => {
    await page.goto('/?region=sky-islands-santa-ritas&notable=true&since=7d');
    await expect(page.locator('[data-region-id]')).toHaveCount(9, { timeout: 15_000 });
    await expect(page.locator('[data-region-id="sky-islands-santa-ritas"]'))
      .toHaveClass(/region-expanded/);
    await expect(page.getByLabel('Notable only')).toBeChecked();
    await expect(page.getByLabel('Time window')).toHaveValue('7d');
  });

  test('invalid since falls back to default (readUrl returns DEFAULTS.since)', async ({ page }) => {
    await page.goto('/?since=garbage');
    await expect(page.locator('[data-region-id]')).toHaveCount(9, { timeout: 15_000 });
    await expect(page.getByLabel('Time window')).toHaveValue('14d');
    // writeUrl only fires inside set(), never on mount — do NOT assert URL normalization here.
  });

  test('species param shows common name in input', async ({ page }) => {
    await page.goto('/?species=vermfly');
    await expect(page.locator('[data-region-id]')).toHaveCount(9, { timeout: 15_000 });
    // Skip if dev DB has no observations (speciesIndex will be empty).
    const familySel = page.getByLabel('Family');
    const familyOptionCount = await familySel.locator('option').count();
    test.skip(familyOptionCount <= 1, 'species_meta is empty — no observations to drive speciesIndex, skipping species deep-link test');
    // speciesDraft is derived from speciesIndex on mount — only populated AFTER
    // observations come back and the effect in FiltersBar re-runs.
    await expect(page.getByLabel('Species')).toHaveValue('Vermilion Flycatcher', { timeout: 10_000 });
  });

  test('family param selects matching option when seeded families exist', async ({ page }) => {
    await page.goto('/?family=tyrannidae');
    await expect(page.locator('[data-region-id]')).toHaveCount(9, { timeout: 15_000 });
    const familySel = page.getByLabel('Family');
    const optionCount = await familySel.locator('option').count();
    test.skip(optionCount <= 1, 'species_meta is empty — no families to restore from URL');
    await expect(familySel).toHaveValue('tyrannidae');
  });

  test('empty URL leaves all controls at defaults', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-region-id]')).toHaveCount(9, { timeout: 15_000 });
    await expect(page.getByLabel('Time window')).toHaveValue('14d');
    await expect(page.getByLabel('Notable only')).not.toBeChecked();
    await expect(page.getByLabel('Family')).toHaveValue('');
    await expect(page.getByLabel('Species')).toHaveValue('');
    await expect(page.locator('.region-expanded')).toHaveCount(0);
  });
});

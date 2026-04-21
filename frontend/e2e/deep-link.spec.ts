import { test, expect } from '@playwright/test';
import { AppPage } from './pages/app-page.js';

// `exact: true` mandatory on every getByLabel filter locator — see
// pages/filters-bar.ts for rationale (FiltersBar datalist + SurfaceNav
// tabs share substrings with "Species" and "Family" labels).

test.describe('deep-link restore', () => {
  // #113 deleted the map; the region-expand restore coverage was
  // map-specific and will be re-asserted against the per-surface
  // deep-link behaviour in #116/#117 (selected feed item / hotspot).
  // Filter + species deep-link coverage below still protects url-state.
  test.skip('multi-param URL restores every filter and region expand', () => {});

  test('notable + since deep-link restores filter values', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('notable=true&since=7d');
    await app.waitForAppReady();
    await expect(page.getByLabel('Notable only', { exact: true })).toBeChecked();
    await expect(page.getByLabel('Time window', { exact: true })).toHaveValue('7d');
  });

  test('invalid since falls back to default (readUrl returns DEFAULTS.since)', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('since=garbage');
    await app.waitForAppReady();
    await expect(page.getByLabel('Time window', { exact: true })).toHaveValue('14d');
    // writeUrl only fires inside set(), never on mount — do NOT assert URL normalization here.
  });

  test('species param shows common name in input', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('species=vermfly');
    await app.waitForAppReady();
    // Skip if dev DB has no observations (speciesIndex will be empty).
    const familySel = page.getByLabel('Family', { exact: true });
    const familyOptionCount = await familySel.locator('option').count();
    test.skip(familyOptionCount <= 1, 'species_meta is empty — no observations to drive speciesIndex, skipping species deep-link test');
    // speciesDraft is derived from speciesIndex on mount — only populated AFTER
    // observations come back and the effect in FiltersBar re-runs.
    await expect(page.getByLabel('Species', { exact: true })).toHaveValue('Vermilion Flycatcher', { timeout: 10_000 });
  });

  test('family param selects matching option when seeded families exist', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('family=tyrannidae');
    await app.waitForAppReady();
    const familySel = page.getByLabel('Family', { exact: true });
    const optionCount = await familySel.locator('option').count();
    test.skip(optionCount <= 1, 'species_meta is empty — no families to restore from URL');
    await expect(familySel).toHaveValue('tyrannidae');
  });

  test('empty URL leaves all controls at defaults', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto();
    await app.waitForAppReady();
    await expect(page.getByLabel('Time window', { exact: true })).toHaveValue('14d');
    await expect(page.getByLabel('Notable only', { exact: true })).not.toBeChecked();
    await expect(page.getByLabel('Family', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Species', { exact: true })).toHaveValue('');
  });
});

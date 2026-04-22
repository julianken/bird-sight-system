import { test, expect } from './fixtures.js';
import AxeBuilder from '@axe-core/playwright';
import { AppPage } from './pages/app-page.js';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test.describe('axe-core WCAG scans', () => {
  test('initial load has no WCAG 2/2.1 A/AA violations', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto();
    await app.waitForAppReady();
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    if (results.violations.length) {
      await test.info().attach('axe-violations', {
        body: JSON.stringify(results.violations, null, 2),
        contentType: 'application/json',
      });
    }
    expect(results.violations).toEqual([]);
  });

  // #113 deleted the map; region-expand as a map-only behaviour no
  // longer has anywhere to happen. A surface-specific axe scan at the
  // expanded-state analogue (selected hotspot / open species card)
  // comes back with #117/#118.
  test.skip('region expanded has no WCAG 2/2.1 A/AA violations', () => {});

  // #118 species surface — the autocomplete carries a WAI-ARIA 1.2 combobox
  // contract (role + aria-autocomplete + aria-expanded + aria-controls),
  // and the listbox + options use proper `role="option"` inside `role="listbox"`.
  // Axe will flag the combobox if any ARIA attribute is missing or mis-paired.
  test('species surface has no WCAG 2/2.1 A/AA violations with autocomplete open', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('view=species');
    await app.waitForAppReady();
    // Type into the autocomplete to open the listbox; axe runs against the
    // open-combobox DOM (listbox + option rows, aria-activedescendant, etc.).
    await page.getByRole('combobox', { name: 'Search species' }).fill('e');
    await page.keyboard.press('ArrowDown');
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    if (results.violations.length) {
      await test.info().attach('axe-violations', {
        body: JSON.stringify(results.violations, null, 2),
        contentType: 'application/json',
      });
    }
    expect(results.violations).toEqual([]);
  });

  test('error screen has no WCAG 2/2.1 A/AA violations', async ({ page, apiStub }) => {
    await apiStub.stubApiAbort('observations');
    await page.goto('/');
    await expect(page.locator('.error-screen h2'))
      .toHaveText("Couldn't load bird data", { timeout: 10_000 });
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    if (results.violations.length) {
      await test.info().attach('axe-violations', {
        body: JSON.stringify(results.violations, null, 2),
        contentType: 'application/json',
      });
    }
    expect(results.violations).toEqual([]);
  });

  test('species detail surface has no WCAG 2/2.1 A/AA violations', async ({ page, apiStub }) => {
    await apiStub.stubSpecies('vermfly', {
      speciesCode: 'vermfly',
      comName: 'Vermilion Flycatcher',
      sciName: 'Pyrocephalus rubinus',
      familyCode: 'tyrannidae',
      familyName: 'Tyrant Flycatchers',
      taxonOrder: 4400,
    });
    const app = new AppPage(page);
    await app.goto('detail=vermfly&view=detail');
    await app.waitForAppReady();
    await expect(page.getByRole('heading', { name: 'Vermilion Flycatcher' }))
      .toBeVisible({ timeout: 10_000 });
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    if (results.violations.length) {
      await test.info().attach('axe-violations', {
        body: JSON.stringify(results.violations, null, 2),
        contentType: 'application/json',
      });
    }
    expect(results.violations).toEqual([]);
  });

  test.describe('at 390×844 mobile viewport', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('species detail surface has no WCAG 2/2.1 A/AA violations (mobile)', async ({ page, apiStub }) => {
      await apiStub.stubSpecies('vermfly', {
        speciesCode: 'vermfly',
        comName: 'Vermilion Flycatcher',
        sciName: 'Pyrocephalus rubinus',
        familyCode: 'tyrannidae',
        familyName: 'Tyrant Flycatchers',
        taxonOrder: 4400,
      });
      const app = new AppPage(page);
      await app.goto('detail=vermfly&view=detail');
      await app.waitForAppReady();
      await expect(page.getByRole('heading', { name: 'Vermilion Flycatcher' }))
        .toBeVisible({ timeout: 10_000 });
      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      if (results.violations.length) {
        await test.info().attach('axe-violations', {
          body: JSON.stringify(results.violations, null, 2),
          contentType: 'application/json',
        });
      }
      expect(results.violations).toEqual([]);
    });

    // #118 mobile — same autocomplete contract but at the release-1 mobile
    // viewport. Covers the flipped-dropdown rendering path too.
    test('species surface has no WCAG 2/2.1 A/AA violations with autocomplete open', async ({ page }) => {
      const app = new AppPage(page);
      await app.goto('view=species');
      await app.waitForAppReady();
      await page.getByRole('combobox', { name: 'Search species' }).fill('e');
      await page.keyboard.press('ArrowDown');
      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      if (results.violations.length) {
        await test.info().attach('axe-violations', {
          body: JSON.stringify(results.violations, null, 2),
          contentType: 'application/json',
        });
      }
      expect(results.violations).toEqual([]);
    });
  });
});

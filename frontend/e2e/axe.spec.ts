import { test, expect } from './fixtures.js';
import AxeBuilder from '@axe-core/playwright';
import { AppPage } from './pages/app-page.js';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const VERMFLY = {
  speciesCode: 'vermfly',
  comName: 'Vermilion Flycatcher',
  sciName: 'Pyrocephalus rubinus',
  familyCode: 'tyrannidae',
  familyName: 'Tyrant Flycatchers',
  taxonOrder: 4400,
} as const;

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
    await apiStub.stubSpecies('vermfly', VERMFLY);
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
      await apiStub.stubSpecies('vermfly', VERMFLY);
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

  // Issue #243 — eBird API ToU §3 attribution must be visible (and reachable
  // by SR / keyboard) on every view that displays eBird-derived data. The
  // assertion here is intentionally view-aware: feed / species / detail
  // surfaces render the credit via SurfaceFooter (a `<footer>` semantic
  // element); the map view renders the credit inside maplibre's
  // AttributionControl alongside OSM and OpenFreeMap.
  test.describe('eBird ToU §3 credit reachability', () => {
    test('feed view exposes a focusable eBird link in a <footer>', async ({ page }) => {
      const app = new AppPage(page);
      await app.goto('view=feed');
      await app.waitForAppReady();
      // Locate via the footer landmark + accessible name so the assertion
      // exercises the same DOM path that assistive tech would.
      const footer = page.locator('footer.surface-footer');
      await expect(footer).toBeVisible();
      const link = footer.getByRole('link', { name: /eBird/i });
      await expect(link).toHaveAttribute('href', 'https://ebird.org');
      await expect(link).toHaveAttribute('rel', 'noopener');
      // The link must be reachable via keyboard, not just visible — focus
      // it and confirm the activeElement matches.
      await link.focus();
      const focusedHref = await page.evaluate(
        () => (document.activeElement as HTMLAnchorElement | null)?.href,
      );
      expect(focusedHref).toBe('https://ebird.org/');
    });

    test('species view exposes a focusable eBird link in a <footer>', async ({ page }) => {
      const app = new AppPage(page);
      await app.goto('view=species');
      await app.waitForAppReady();
      const footer = page.locator('footer.surface-footer');
      await expect(footer).toBeVisible();
      const link = footer.getByRole('link', { name: /eBird/i });
      await expect(link).toHaveAttribute('href', 'https://ebird.org');
      await expect(link).toHaveAttribute('rel', 'noopener');
    });

    test('detail view exposes a focusable eBird link in a <footer>', async ({ page, apiStub }) => {
      await apiStub.stubSpecies('vermfly', VERMFLY);
      const app = new AppPage(page);
      await app.goto('detail=vermfly&view=detail');
      await app.waitForAppReady();
      await expect(page.getByRole('heading', { name: 'Vermilion Flycatcher' }))
        .toBeVisible({ timeout: 10_000 });
      const footer = page.locator('footer.surface-footer');
      await expect(footer).toBeVisible();
      const link = footer.getByRole('link', { name: /eBird/i });
      await expect(link).toHaveAttribute('href', 'https://ebird.org');
      await expect(link).toHaveAttribute('rel', 'noopener');
    });

    test('map view exposes the eBird credit inside the AttributionControl', async ({ page }) => {
      const app = new AppPage(page);
      await app.goto('view=map');
      await app.waitForAppReady();
      // The AttributionControl renders into .maplibregl-ctrl-attrib-inner —
      // its content is HTML strings from customAttribution. The credit
      // is *inside* the control, not in a separate <footer>, so the map
      // view is not double-credited. SurfaceFooter must NOT be present
      // on this view.
      await expect(page.locator('footer.surface-footer')).toHaveCount(0);
      const attrib = page.locator('.maplibregl-ctrl-attrib-inner');
      await expect(attrib).toBeVisible({ timeout: 15_000 });
      const link = attrib.getByRole('link', { name: /eBird/i });
      await expect(link).toHaveAttribute('href', 'https://ebird.org');
      await expect(link).toHaveAttribute('rel', 'noopener');
    });
  });

  // Extend the axe coverage to include feed (initial-load already covers
  // this path, but assert explicitly for ?view=feed) and map. Existing
  // species/detail/error scans above continue to cover the other surfaces.
  test('feed view has no WCAG 2/2.1 A/AA violations', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('view=feed');
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

  test('map view has no WCAG 2/2.1 A/AA violations', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();
    // Wait for the maplibre attribution control to materialise — its
    // rendering is async (depends on style + tile load) and axe should
    // see it.
    await expect(page.locator('.maplibregl-ctrl-attrib-inner'))
      .toBeVisible({ timeout: 15_000 });
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

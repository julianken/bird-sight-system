import { test, expect, VERMFLY, VERMFLY_WITH_PHOTO } from './fixtures.js';
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

  // Map view scans the FamilyLegend overlay (#249) at desktop and mobile
  // viewports. Replaces the historical `region expanded` skip (the
  // pre-#113 map's region-expand axe scan no longer has a target).
  // The maplibre AttributionControl needs WebGL to render and headless
  // Chromium (CI + local) ships without it. We scan the chrome around
  // the map (filters bar, surface nav, the map-canvas wrapper) — that's
  // the part axe actually has DOM for. The attribution markup is unit-
  // tested at the customAttribution-array level, so dropping the canvas
  // contents from the axe scan does not mask a WCAG regression in the
  // map's own controls (those are MapLibre-owned and out of our axe
  // jurisdiction anyway).
  test('map view has no WCAG 2/2.1 A/AA violations (desktop)', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();
    // Allow the lazy MapCanvas chunk to mount before scanning so the legend
    // is in the DOM.
    await expect(page.locator('[data-testid=map-canvas]')).toBeVisible({ timeout: 15_000 });
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    if (results.violations.length) {
      await test.info().attach('axe-violations', {
        body: JSON.stringify(results.violations, null, 2),
        contentType: 'application/json',
      });
    }
    expect(results.violations).toEqual([]);
  });

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

  // Issue #327 task-12 — extend axe coverage to the photo render branch.
  // The existing detail-surface scan above uses VERMFLY (no photoUrl), so
  // it only exercises the silhouette fallback path. The photo path
  // produces an `<img alt="...photo">` whose alt-text + image-alt WCAG
  // rules are scanned only when the photo is in the rendered DOM.
  // `apiStub.stubPhotoImage()` ensures the `<img>`'s `load` fires (no
  // 404→onError fallback to silhouette, which would silently mask the
  // photo branch). Both desktop (1440×900) and mobile (390×844) viewports
  // are covered because the photo's CSS layout differs at each (object-fit
  // crop bounds, container sizing) — axe validates the rendered DOM at
  // each viewport, not just the markup.
  test('species detail surface with photoUrl has no WCAG 2/2.1 A/AA violations (desktop)', async ({ page, apiStub }) => {
    await apiStub.stubSpecies('vermfly', VERMFLY_WITH_PHOTO);
    await apiStub.stubPhotoImage();
    const app = new AppPage(page);
    await app.goto('detail=vermfly&view=detail');
    await app.waitForAppReady();
    await expect(page.getByRole('heading', { name: 'Vermilion Flycatcher' }))
      .toBeVisible({ timeout: 10_000 });
    // Confirm the <img> is in the DOM before scanning — without it, the
    // scan would silently degrade to the silhouette branch and the test
    // name would lie about what was covered.
    await expect(page.getByAltText('Vermilion Flycatcher photo')).toBeVisible();
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

    // Issue #327 task-12 — mobile counterpart of the with-photo axe scan
    // above. The mobile viewport drives a different photo container width
    // (column-stacked layout vs side-by-side on desktop), so the
    // image-alt + landmark + reflow rules need to be scanned here too.
    test('species detail surface with photoUrl has no WCAG 2/2.1 A/AA violations (mobile)', async ({ page, apiStub }) => {
      await apiStub.stubSpecies('vermfly', VERMFLY_WITH_PHOTO);
      await apiStub.stubPhotoImage();
      const app = new AppPage(page);
      await app.goto('detail=vermfly&view=detail');
      await app.waitForAppReady();
      await expect(page.getByRole('heading', { name: 'Vermilion Flycatcher' }))
        .toBeVisible({ timeout: 10_000 });
      await expect(page.getByAltText('Vermilion Flycatcher photo')).toBeVisible();
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

    // #249 — map view at the release-1 mobile viewport scans the
    // FamilyLegend collapsed-by-default state (the chevron tab + its
    // surrounding aside landmark).
    test('map view has no WCAG 2/2.1 A/AA violations (mobile)', async ({ page }) => {
      const app = new AppPage(page);
      await app.goto('view=map');
      await app.waitForAppReady();
      await expect(page.locator('[data-testid=map-canvas]')).toBeVisible({ timeout: 15_000 });
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

  // Issue #243 / #250 — eBird API ToU §3 attribution lives in the app-level
  // AttributionModal trigger (rendered inside the persistent
  // `<footer role="contentinfo" class="app-footer">`) which is reachable
  // from every view. The per-surface SurfaceFooter retired in #250.
  // The map view continues to render the eBird credit inside maplibre's
  // AttributionControl alongside OSM and OpenFreeMap (the in-map control
  // is a low-friction credit and ODbL-compliant for the map data
  // specifically — the modal subsumes the surface-level redundancy only).
  test.describe('attribution reachability (issue #250)', () => {
    test('feed view exposes a Credits trigger in the app-level footer', async ({ page }) => {
      const app = new AppPage(page);
      await app.goto('view=feed');
      await app.waitForAppReady();
      const footer = page.locator('footer.app-footer');
      await expect(footer).toBeVisible();
      const trigger = footer.getByRole('button', { name: /credits/i });
      await expect(trigger).toBeVisible();
    });

    test('species view exposes a Credits trigger in the app-level footer', async ({ page }) => {
      const app = new AppPage(page);
      await app.goto('view=species');
      await app.waitForAppReady();
      const footer = page.locator('footer.app-footer');
      await expect(footer).toBeVisible();
      const trigger = footer.getByRole('button', { name: /credits/i });
      await expect(trigger).toBeVisible();
    });

    test('detail view exposes a Credits trigger in the app-level footer', async ({ page, apiStub }) => {
      await apiStub.stubSpecies('vermfly', VERMFLY);
      const app = new AppPage(page);
      await app.goto('detail=vermfly&view=detail');
      await app.waitForAppReady();
      await expect(page.getByRole('heading', { name: 'Vermilion Flycatcher' }))
        .toBeVisible({ timeout: 10_000 });
      const footer = page.locator('footer.app-footer');
      await expect(footer).toBeVisible();
      const trigger = footer.getByRole('button', { name: /credits/i });
      await expect(trigger).toBeVisible();
    });

    test('map view exposes a Credits trigger in the app-level footer', async ({ page }) => {
      const app = new AppPage(page);
      await app.goto('view=map');
      await app.waitForAppReady();
      const footer = page.locator('footer.app-footer');
      await expect(footer).toBeVisible();
      const trigger = footer.getByRole('button', { name: /credits/i });
      await expect(trigger).toBeVisible();
    });

    // SurfaceFooter retired in #250 — assert no leftover surface-level
    // footers shadow the new app-level footer.
    test('no per-surface footer.surface-footer renders anywhere', async ({ page }) => {
      const app = new AppPage(page);
      for (const view of ['feed', 'species', 'map'] as const) {
        await app.goto(`view=${view}`);
        await app.waitForAppReady();
        await expect(page.locator('footer.surface-footer')).toHaveCount(0);
      }
    });
  });

  // Feed view explicit scan. Initial-load above also covers ?view=feed
  // by default, but assert explicitly for the URL-driven path.
  // (Map view is covered above at desktop + mobile — see lines ~34 and
  // ~146. The earlier duplicate `map view` test at the bottom of this
  // describe was removed in #263 as functionally redundant.)
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
});

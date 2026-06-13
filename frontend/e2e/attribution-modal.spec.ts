import { test, expect } from './fixtures.js';
import { AppPage } from './pages/app-page.js';

/**
 * AttributionModal — #830 update: the modal is controlled-open. The internal
 * `.attribution-trigger` button was removed; the only Credits affordance is the
 * AppHeader ⓘ "Credits" button (`app.attributionTrigger`), which
 * sets the modal's `open` prop. Every test opens via that button.
 * (#1033 V1/V18: label shortened from "Credits & attribution" to "Credits")
 *
 * Covers:
 *   - Credits trigger (AppHeader ⓘ) reachable from every view (map, detail).
 *   - Modal open / focus management / Escape close / focus return.
 *   - Phylopic per-silhouette section renders creator + license + image-
 *     page link for at least one silhouette using the seeded Phylopic
 *     data from #245.
 *
 * No DB writes; this spec only reads from the seed.
 */

const VERMFLY = {
  speciesCode: 'vermfly',
  comName: 'Vermilion Flycatcher',
  sciName: 'Pyrocephalus rubinus',
  familyCode: 'tyrannidae',
  familyName: 'Tyrant Flycatchers',
  taxonOrder: 4400,
} as const;

test.describe('AttributionModal — reachability from AppHeader (desktop)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  // #830: the Credits affordance is the AppHeader ⓘ button (the internal
  // .attribution-trigger was deleted; aria-expanded is intentionally omitted —
  // it opens a top-layer showModal() dialog, not an inline disclosure).
  // 'species' removed from iteration in #688 (Species surface deleted); 'feed'
  // removed in #777 (Feed surface deleted).
  for (const view of ['map'] as const) {
    test(`Credits trigger reachable on view=${view}`, async ({ page }) => {
      const app = new AppPage(page);
      await app.goto(`view=${view}`);
      await app.waitForAppReady();
      await expect(app.attributionTrigger).toBeVisible();
      await expect(app.attributionTrigger).toHaveAttribute('aria-haspopup', 'dialog');
      // The old internal shim is gone from the DOM.
      await expect(page.locator('button.attribution-trigger')).toHaveCount(0);
    });
  }

  test('Credits trigger reachable on view=detail', async ({ page, apiStub }) => {
    await apiStub.stubEmpty();
    await apiStub.stubSpecies('vermfly', VERMFLY);
    const app = new AppPage(page);
    await app.goto('detail=vermfly&view=detail');
    await app.waitForAppReady();
    await expect(page.getByRole('heading', { name: 'Vermilion Flycatcher' }))
      .toBeVisible({ timeout: 10_000 });
    // The AppHeader ⓘ trigger is the persistent Credits affordance on every view.
    await expect(app.attributionTrigger).toBeVisible();
    await expect(page.locator('button.attribution-trigger')).toHaveCount(0);
  });
});

test.describe('AttributionModal — open / close (desktop)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('clicking Credits opens the dialog', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('scope=us');
    await app.waitForAppReady();
    // #830: open via the AppHeader ⓘ button — it sets the modal's controlled
    // `open` prop (no internal shim). Fixed chrome on --z-chrome.
    await app.attributionTrigger.click();
    const dialog = page.locator('dialog.attribution-modal');
    await expect(dialog).toHaveAttribute('open', '');
    // The dialog has an h2 title.
    await expect(dialog.getByRole('heading', { level: 2, name: /credits/i })).toBeVisible();
  });

  test('renders the three credit sections', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('scope=us');
    await app.waitForAppReady();
    await app.attributionTrigger.click();
    const dialog = page.locator('dialog.attribution-modal');
    await expect(dialog.getByRole('heading', { level: 3, name: /bird sightings data/i })).toBeVisible();
    await expect(dialog.getByRole('heading', { level: 3, name: /family silhouettes/i })).toBeVisible();
    await expect(dialog.getByRole('heading', { level: 3, name: /map tiles/i })).toBeVisible();
  });

  test('Phylopic section renders at least one silhouette with creator + license + source link', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('scope=us');
    await app.waitForAppReady();
    await app.attributionTrigger.click();
    const dialog = page.locator('dialog.attribution-modal');
    // Wait for the seeded Phylopic data to land (it arrives via the
    // /api/silhouettes fetch). At least one row with a creator must
    // surface — issue #245 seeded several real Phylopic creators into
    // family_silhouettes.
    const rows = dialog.locator('[data-testid=attribution-phylopic-row]');
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    // At least one row must surface a Phylopic source link (the family
    // common name or family code, hyperlinked).
    const firstRow = rows.first();
    const sourceLinks = firstRow.locator('a[href*="phylopic"]');
    await expect(sourceLinks.first()).toBeVisible();

    // At least one row should carry a CC license link (any one of the
    // mappings in LICENSE_URLS).
    const licenseLinks = dialog.locator('a[href*="creativecommons.org"]');
    expect(await licenseLinks.count()).toBeGreaterThan(0);
  });

  test('all external links use rel="noopener noreferrer" and target="_blank"', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('scope=us');
    await app.waitForAppReady();
    await app.attributionTrigger.click();
    const dialog = page.locator('dialog.attribution-modal');
    await expect(dialog.getByRole('heading', { level: 3, name: /bird sightings data/i })).toBeVisible();
    // Wait for any phylopic data to land so the assertion sees the full
    // set of links (including the per-row source + license links).
    await dialog.locator('[data-testid=attribution-phylopic-row]').first()
      .waitFor({ state: 'visible', timeout: 10_000 });
    const allLinks = dialog.locator('a[href]');
    const linkCount = await allLinks.count();
    expect(linkCount).toBeGreaterThan(0);
    for (let i = 0; i < linkCount; i++) {
      const link = allLinks.nth(i);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  test('Escape closes the dialog and returns focus to the opener', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('scope=us');
    await app.waitForAppReady();
    // #830: open via the AppHeader ⓘ button. The modal restores focus to
    // `document.activeElement` at open time — the ⓘ button — so focus-return is
    // asserted on that button (the controlled-open opener).
    await app.attributionTrigger.click();
    const dialog = page.locator('dialog.attribution-modal');
    await expect(dialog).toHaveAttribute('open', '');

    await page.keyboard.press('Escape');
    // After Escape, the dialog closes and focus returns to the opener.
    await expect(dialog).not.toHaveAttribute('open', '');
    await expect(app.attributionTrigger).toBeFocused();
  });

  test('close button closes the dialog and returns focus to the opener', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('scope=us');
    await app.waitForAppReady();
    await app.attributionTrigger.click();
    const dialog = page.locator('dialog.attribution-modal');
    const close = dialog.getByRole('button', { name: /close/i });
    await close.click();
    await expect(dialog).not.toHaveAttribute('open', '');
    await expect(app.attributionTrigger).toBeFocused();
  });

  test('opening the dialog moves focus into the modal (close button is autofocused)', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('scope=us');
    await app.waitForAppReady();
    await app.attributionTrigger.click();
    const dialog = page.locator('dialog.attribution-modal');
    const close = dialog.getByRole('button', { name: /close/i });
    await expect(close).toBeFocused();
  });
});

test.describe('AttributionModal — mobile viewport', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Credits trigger reachable on the map (mobile)', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('scope=us');
    await app.waitForAppReady();
    // #830: the Credits affordance is the AppHeader ⓘ button.
    await expect(app.attributionTrigger).toBeVisible();
    await expect(page.locator('button.attribution-trigger')).toHaveCount(0);
  });

  test('open + Escape + focus-return cycle works (mobile)', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('scope=us');
    await app.waitForAppReady();
    // #830: open via the AppHeader ⓘ button; focus returns to that opener.
    await app.attributionTrigger.click();
    const dialog = page.locator('dialog.attribution-modal');
    await expect(dialog).toHaveAttribute('open', '');
    await page.keyboard.press('Escape');
    await expect(dialog).not.toHaveAttribute('open', '');
    await expect(app.attributionTrigger).toBeFocused();
  });

  test('Phylopic section renders at least one silhouette (mobile)', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('scope=us');
    await app.waitForAppReady();
    await app.attributionTrigger.click();
    const dialog = page.locator('dialog.attribution-modal');
    const rows = dialog.locator('[data-testid=attribution-phylopic-row]');
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });
    expect(await rows.count()).toBeGreaterThan(0);
  });
});

/**
 * Issue #327 task-11 — iNaturalist photo credit in the AttributionModal.
 *
 * Two viewports (390×844 mobile, 1440×900 desktop) confirm the credit
 * surfaces in the modal Photos section after navigating to a species
 * detail surface and opening Credits. Stubbing /api/species/:code via
 * `apiStub.stubSpecies` is required because the live read-api may not
 * yet have R2 photo data populated for arbitrary species; the test
 * deliberately picks deterministic photoAttribution + photoLicense
 * fixtures so the credit is observable.
 */

const VERMFLY_WITH_PHOTO = {
  ...VERMFLY,
  photoUrl: 'https://photos.bird-maps.com/vermfly.jpg',
  photoAttribution: 'Jane Photographer',
  photoLicense: 'cc-by',
} as const;

test.describe('AttributionModal — iNat photo credit (#327 task-11)', () => {
  for (const viewport of [
    { width: 1440, height: 900, label: 'desktop' },
    { width: 390, height: 844, label: 'mobile' },
  ] as const) {
    test.describe(`${viewport.label} (${viewport.width}x${viewport.height})`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      test('shows iNat photo credit when SpeciesDetailSurface has a photo', async ({ page, apiStub }) => {
        // Stub the species lookup with the photo fixture. The detail
        // surface mounts on view=detail+detail=vermfly and the App
        // threads photoAttribution + photoLicense through to the modal.
        await apiStub.stubEmpty();
        await apiStub.stubSpecies('vermfly', VERMFLY_WITH_PHOTO);
        const app = new AppPage(page);
        await app.goto('detail=vermfly&view=detail');
        await app.waitForAppReady();
        // Wait for the species detail surface to render (heading is the
        // canonical post-fetch indicator).
        await expect(page.getByRole('heading', { name: 'Vermilion Flycatcher' }))
          .toBeVisible({ timeout: 10_000 });

        // #830: open via the AppHeader ⓘ button (controlled-open). It is fixed
        // chrome on --z-chrome in the top-right pill; the detail rail (desktop)
        // insets BELOW the controls cluster and the peek sheet (mobile) sits at
        // the bottom, so the ⓘ stays clickable while view=detail keeps
        // App.activeSpeciesMeta populated (so the Photos section threads through).
        await app.attributionTrigger.click();
        const dialog = page.locator('dialog.attribution-modal');
        await expect(dialog).toHaveAttribute('open', '');

        // Photos section is present with an <h3>Photos</h3>.
        const photosSection = dialog.locator('[data-testid=attribution-photos-section]');
        await expect(photosSection).toBeVisible();
        await expect(photosSection.getByRole('heading', { level: 3, name: /^photos$/i }))
          .toBeVisible();

        // Photographer attribution is rendered.
        await expect(photosSection.getByText(/Jane Photographer/)).toBeVisible();

        // CC license link surfaces with the canonical creativecommons.org
        // deed URL. The cc-by code resolves to "CC BY 4.0" + /licenses/by/4.0/.
        const licenseLink = photosSection.getByRole('link', { name: /CC BY 4\.0/i });
        await expect(licenseLink).toBeVisible();
        await expect(licenseLink).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/');
        await expect(licenseLink).toHaveAttribute('target', '_blank');
        await expect(licenseLink).toHaveAttribute('rel', 'noopener noreferrer');
      });

      test('omits the Photos section when species has no photo metadata', async ({ page, apiStub }) => {
        // VERMFLY (no photoAttribution / photoLicense) — the section
        // must NOT render. Verifies the omit path that protects the
        // user's experience on every other view + every species without
        // a curated detail-panel photo.
        await apiStub.stubEmpty();
        await apiStub.stubSpecies('vermfly', VERMFLY);
        const app = new AppPage(page);
        await app.goto('detail=vermfly&view=detail');
        await app.waitForAppReady();
        await expect(page.getByRole('heading', { name: 'Vermilion Flycatcher' }))
          .toBeVisible({ timeout: 10_000 });

        // #830: open via the AppHeader ⓘ button (controlled-open).
        await app.attributionTrigger.click();
        const dialog = page.locator('dialog.attribution-modal');
        await expect(dialog).toHaveAttribute('open', '');
        // No Photos heading; no photos section testid.
        await expect(dialog.locator('[data-testid=attribution-photos-section]'))
          .toHaveCount(0);
      });
    });
  }
});

/**
 * B3 (#1042 M-11): single-scroller assertion — the Credits modal must have
 * exactly ONE scroll container. The native <dialog> previously had both
 * UA overflow:auto AND the inner .attribution-modal-content with
 * overflow-y:auto + max-height:80vh, producing two side-by-side tracks.
 * After the fix (.attribution-modal { overflow: hidden }), only the inner
 * content div scrolls.
 *
 * B3 (#1042 M-10): scrollbar-color token resolution — .family-legend-entries
 * must compute a non-"auto" scrollbar-color under both light and dark themes,
 * confirming the --scrollbar-* token pair resolves in both [data-theme] blocks.
 */
test.describe('B3 (#1042): single-scroller + scrollbar tokens', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('M-11: only .attribution-modal-content scrolls — dialog itself does not', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('scope=us');
    await app.waitForAppReady();
    await app.attributionTrigger.click();
    const dialog = page.locator('dialog.attribution-modal');
    await expect(dialog).toHaveAttribute('open', '');
    // Wait for the Phylopic data to load so the content is as tall as possible.
    await dialog.locator('[data-testid=attribution-phylopic-row]').first()
      .waitFor({ state: 'visible', timeout: 10_000 });

    // Force the inner content taller than 80vh so both containers would scroll
    // if both had overflow-y:auto.  We inject a tall sentinel div.
    await page.evaluate(() => {
      const content = document.querySelector('.attribution-modal-content');
      if (!content) throw new Error('.attribution-modal-content not found');
      const sentinel = document.createElement('div');
      sentinel.style.height = '2000px';
      sentinel.setAttribute('data-testid', 'scroll-sentinel');
      content.appendChild(sentinel);
    });

    // `overflow:hidden` clips overflowing content but does NOT collapse
    // scrollHeight to clientHeight, so `scrollHeight > clientHeight` is still
    // true on the (non-scrolling) dialog. The faithful "exactly one scroll
    // container" oracle is: the inner content actually scrolls AND is the
    // scroller (overflow-y auto|scroll), while the dialog's overflow-y is
    // hidden (so it cannot scroll).
    const { contentScrolls, contentOverflowY, dialogOverflowY } = await page.evaluate(() => {
      const content = document.querySelector('.attribution-modal-content');
      const dlg     = document.querySelector('dialog.attribution-modal');
      if (!content || !dlg) throw new Error('Elements not found');
      return {
        contentScrolls:   content.scrollHeight > content.clientHeight,
        contentOverflowY: getComputedStyle(content).overflowY,
        dialogOverflowY:  getComputedStyle(dlg).overflowY,
      };
    });

    expect(contentScrolls, '.attribution-modal-content must scroll (scrollHeight > clientHeight)').toBe(true);
    expect(['auto', 'scroll'], 'inner content is the scroll container').toContain(contentOverflowY);
    expect(dialogOverflowY, 'dialog.attribution-modal must NOT scroll (overflow-y:hidden)').toBe('hidden');
  });

  test('M-10: scrollbar-color on .family-legend-entries resolves (not "auto") in both themes', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('scope=us');
    await app.waitForAppReady();

    // .family-legend-entries mounts only when the legend is expanded AND
    // families have derived from observations (FamilyLegend.tsx ~L215). On the
    // 1440×900 desktop viewport the legend defaults to expanded, so the element
    // appears once families load — wait for it before reading computed styles.
    // If this run defaults to collapsed, expand it first.
    const legendEntries = page.locator('.family-legend-entries');
    const toggle = page.locator('.family-legend-toggle');
    try {
      await legendEntries.waitFor({ state: 'attached', timeout: 15_000 });
    } catch {
      if ((await toggle.getAttribute('aria-expanded')) === 'false') {
        await toggle.click();
      }
      await legendEntries.waitFor({ state: 'attached', timeout: 15_000 });
    }

    // Light theme.
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'light');
    });
    const lightScrollbarColor = await page.evaluate(() => {
      const el = document.querySelector('.family-legend-entries');
      if (!el) return null;
      return window.getComputedStyle(el).scrollbarColor;
    });
    expect(
      lightScrollbarColor,
      '.family-legend-entries scrollbar-color must not be null in light theme',
    ).not.toBeNull();
    expect(
      lightScrollbarColor,
      '.family-legend-entries scrollbar-color must not be "auto" in light theme (token not resolving)',
    ).not.toBe('auto');

    // Dark theme.
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    const darkScrollbarColor = await page.evaluate(() => {
      const el = document.querySelector('.family-legend-entries');
      if (!el) return null;
      return window.getComputedStyle(el).scrollbarColor;
    });
    expect(
      darkScrollbarColor,
      '.family-legend-entries scrollbar-color must not be null in dark theme',
    ).not.toBeNull();
    expect(
      darkScrollbarColor,
      '.family-legend-entries scrollbar-color must not be "auto" in dark theme (token not resolving)',
    ).not.toBe('auto');

    // The dark theme thumb must differ from the light theme thumb,
    // confirming the per-theme token values actually differ.
    expect(darkScrollbarColor).not.toBe(lightScrollbarColor);
  });
});

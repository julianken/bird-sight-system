import { test, expect } from './fixtures.js';
import { AppPage } from './pages/app-page.js';

/**
 * Issue #250 — AttributionModal in the persistent app-level footer.
 *
 * Covers:
 *   - Footer reachability from every view (feed, species, map, detail).
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

test.describe('AttributionModal — footer reachability (desktop)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  // Drive each surface and confirm the persistent app footer + Credits
  // trigger are present + visible. The detail view needs a stubbed
  // species lookup so the surface mounts (it depends on
  // useSpeciesDetail).
  for (const view of ['feed', 'species', 'map'] as const) {
    test(`Credits trigger reachable on view=${view}`, async ({ page }) => {
      const app = new AppPage(page);
      await app.goto(`view=${view}`);
      await app.waitForAppReady();
      const footer = page.locator('footer.app-footer');
      await expect(footer).toBeVisible();
      const trigger = footer.getByRole('button', { name: /credits/i });
      await expect(trigger).toBeVisible();
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });
  }

  test('Credits trigger reachable on view=detail', async ({ page, apiStub }) => {
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
});

test.describe('AttributionModal — open / close (desktop)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('clicking Credits opens the dialog', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('view=feed');
    await app.waitForAppReady();
    const trigger = page.locator('footer.app-footer').getByRole('button', { name: /credits/i });
    await trigger.click();
    const dialog = page.locator('dialog.attribution-modal');
    await expect(dialog).toHaveAttribute('open', '');
    // The dialog has an h2 title.
    await expect(dialog.getByRole('heading', { level: 2, name: /credits/i })).toBeVisible();
  });

  test('renders the three credit sections', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('view=feed');
    await app.waitForAppReady();
    await page.locator('footer.app-footer').getByRole('button', { name: /credits/i }).click();
    const dialog = page.locator('dialog.attribution-modal');
    await expect(dialog.getByRole('heading', { level: 3, name: /bird sightings data/i })).toBeVisible();
    await expect(dialog.getByRole('heading', { level: 3, name: /family silhouettes/i })).toBeVisible();
    await expect(dialog.getByRole('heading', { level: 3, name: /map tiles/i })).toBeVisible();
  });

  test('Phylopic section renders at least one silhouette with creator + license + source link', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('view=feed');
    await app.waitForAppReady();
    await page.locator('footer.app-footer').getByRole('button', { name: /credits/i }).click();
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
    await app.goto('view=feed');
    await app.waitForAppReady();
    await page.locator('footer.app-footer').getByRole('button', { name: /credits/i }).click();
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

  test('Escape closes the dialog and returns focus to the Credits trigger', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('view=feed');
    await app.waitForAppReady();
    const trigger = page.locator('footer.app-footer').getByRole('button', { name: /credits/i });
    await trigger.click();
    const dialog = page.locator('dialog.attribution-modal');
    await expect(dialog).toHaveAttribute('open', '');

    await page.keyboard.press('Escape');
    // After Escape, the dialog closes and focus returns to the trigger.
    await expect(dialog).not.toHaveAttribute('open', '');
    await expect(trigger).toBeFocused();
  });

  test('close button closes the dialog and returns focus to the Credits trigger', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('view=feed');
    await app.waitForAppReady();
    const trigger = page.locator('footer.app-footer').getByRole('button', { name: /credits/i });
    await trigger.click();
    const dialog = page.locator('dialog.attribution-modal');
    const close = dialog.getByRole('button', { name: /close/i });
    await close.click();
    await expect(dialog).not.toHaveAttribute('open', '');
    await expect(trigger).toBeFocused();
  });

  test('opening the dialog moves focus into the modal (close button is autofocused)', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('view=feed');
    await app.waitForAppReady();
    const trigger = page.locator('footer.app-footer').getByRole('button', { name: /credits/i });
    await trigger.click();
    const dialog = page.locator('dialog.attribution-modal');
    const close = dialog.getByRole('button', { name: /close/i });
    await expect(close).toBeFocused();
  });
});

test.describe('AttributionModal — mobile viewport', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Credits trigger reachable on view=feed (mobile)', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('view=feed');
    await app.waitForAppReady();
    const footer = page.locator('footer.app-footer');
    await expect(footer).toBeVisible();
    const trigger = footer.getByRole('button', { name: /credits/i });
    await expect(trigger).toBeVisible();
  });

  test('open + Escape + focus-return cycle works (mobile)', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('view=feed');
    await app.waitForAppReady();
    const trigger = page.locator('footer.app-footer').getByRole('button', { name: /credits/i });
    await trigger.click();
    const dialog = page.locator('dialog.attribution-modal');
    await expect(dialog).toHaveAttribute('open', '');
    await page.keyboard.press('Escape');
    await expect(dialog).not.toHaveAttribute('open', '');
    await expect(trigger).toBeFocused();
  });

  test('Phylopic section renders at least one silhouette (mobile)', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('view=feed');
    await app.waitForAppReady();
    await page.locator('footer.app-footer').getByRole('button', { name: /credits/i }).click();
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
        await apiStub.stubSpecies('vermfly', VERMFLY_WITH_PHOTO);
        const app = new AppPage(page);
        await app.goto('detail=vermfly&view=detail');
        await app.waitForAppReady();
        // Wait for the species detail surface to render (heading is the
        // canonical post-fetch indicator).
        await expect(page.getByRole('heading', { name: 'Vermilion Flycatcher' }))
          .toBeVisible({ timeout: 10_000 });

        // Open the Credits modal.
        const trigger = page.locator('footer.app-footer').getByRole('button', { name: /credits/i });
        await trigger.click();
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
        await apiStub.stubSpecies('vermfly', VERMFLY);
        const app = new AppPage(page);
        await app.goto('detail=vermfly&view=detail');
        await app.waitForAppReady();
        await expect(page.getByRole('heading', { name: 'Vermilion Flycatcher' }))
          .toBeVisible({ timeout: 10_000 });

        const trigger = page.locator('footer.app-footer').getByRole('button', { name: /credits/i });
        await trigger.click();
        const dialog = page.locator('dialog.attribution-modal');
        await expect(dialog).toHaveAttribute('open', '');
        // No Photos heading; no photos section testid.
        await expect(dialog.locator('[data-testid=attribution-photos-section]'))
          .toHaveCount(0);
      });
    });
  }
});

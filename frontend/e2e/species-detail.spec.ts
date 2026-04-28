import { test, expect } from './fixtures.js';
import { AppPage } from './pages/app-page.js';

/**
 * Issue #151 — species detail surface (replaces SpeciesPanel sidebar).
 *
 * The detail surface mounts in-flow inside <main> when
 * `?detail=<code>&view=detail` is in the URL. It is NOT a position:fixed
 * overlay. No ESC dismiss, no close button, no overlay.
 *
 * Navigation contract: every test begins with page.goto (no shared state).
 */

const VERMFLY = {
  speciesCode: 'vermfly',
  comName: 'Vermilion Flycatcher',
  sciName: 'Pyrocephalus rubinus',
  familyCode: 'tyrannidae',
  familyName: 'Tyrant Flycatchers',
  taxonOrder: 4400,
} as const;

test.describe('species detail surface (#151)', () => {
  test('detail URL mounts the surface with species info', async ({ page, apiStub }) => {
    await apiStub.stubSpecies('vermfly', VERMFLY);
    const app = new AppPage(page);
    await app.goto('detail=vermfly&view=detail');
    await app.waitForAppReady();

    // Detail surface renders species info inside main. Scope text matches
    // to <main> — the AttributionModal (#250) renders family names inside
    // its dialog, which is in the DOM even when closed (React mounts the
    // children regardless of dialog.open). Without the scope, getByText
    // hits both the surface's `.species-detail-family` and the modal's
    // Phylopic section.
    const main = page.locator('main');
    await expect(main.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeVisible({ timeout: 10_000 });
    await expect(main.getByText('Pyrocephalus rubinus')).toBeVisible();
    await expect(main.getByText('Tyrant Flycatchers')).toBeVisible();

    // URL carries detail and view params.
    await expect.poll(() => new URL(page.url()).searchParams.get('detail'), { timeout: 5_000 })
      .toBe('vermfly');
    await expect.poll(() => new URL(page.url()).searchParams.get('view'), { timeout: 5_000 })
      .toBe('detail');
  });

  test('row click navigates to detail surface without narrowing feed', async ({ page, apiStub }) => {
    await apiStub.stubSpecies('vermfly', VERMFLY);
    const app = new AppPage(page);
    await app.goto();
    await app.waitForAppReady();

    // Click first feed row.
    await expect(page.locator('.feed-row').first()).toBeVisible({ timeout: 10_000 });
    await page.locator('.feed-row').first().click();

    // Should navigate to detail surface.
    await expect.poll(() => new URL(page.url()).searchParams.get('view'), { timeout: 5_000 })
      .toBe('detail');
    await expect.poll(() => new URL(page.url()).searchParams.get('detail'), { timeout: 5_000 })
      .toBeTruthy();

    // species= filter param should NOT be set by a row click.
    const speciesParam = new URL(page.url()).searchParams.get('species');
    expect(speciesParam).toBeNull();
  });

  test('FiltersBar species commit narrows feed without opening detail', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto();
    await app.waitForAppReady();

    // Wait for species options to be populated.
    await expect(page.locator('datalist#species-options option').first()).toBeAttached({ timeout: 10_000 });

    // Type exact species name and press Enter to commit.
    await app.filters.setSpecies('Vermilion Flycatcher');
    await page.keyboard.press('Enter');

    // species= should be set (filter narrowing).
    await expect.poll(() => app.getUrlParams().get('species'), { timeout: 5_000 }).toBe('vermfly');

    // detail= should NOT be set. View should stay on feed.
    expect(app.getUrlParams().get('detail')).toBeNull();
    expect(app.getUrlParams().get('view')).toBe('feed');

    // Feed tab remains selected.
    const feedTab = page.getByRole('tab', { name: 'Feed view' });
    await expect(feedTab).toHaveAttribute('aria-selected', 'true');
  });

  test('network failure shows inline error on detail surface', async ({ page, apiStub }) => {
    await apiStub.stubApiFailure('species', 500);
    const app = new AppPage(page);
    await app.goto('detail=vermfly&view=detail');
    await app.waitForAppReady();
    await expect(page.getByText('Could not load species details')).toBeVisible({ timeout: 10_000 });
  });

  test('ESC does nothing on detail surface (no modal dismiss)', async ({ page, apiStub }) => {
    await apiStub.stubSpecies('vermfly', VERMFLY);
    const app = new AppPage(page);
    await app.goto('detail=vermfly&view=detail');
    await app.waitForAppReady();
    await expect(page.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press('Escape');

    // Surface should still be visible — ESC has no effect.
    await expect(page.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.get('view'), { timeout: 5_000 })
      .toBe('detail');
  });

  test('detail surface has no complementary landmark or overlay', async ({ page, apiStub }) => {
    await apiStub.stubSpecies('vermfly', VERMFLY);
    const app = new AppPage(page);
    await app.goto('detail=vermfly&view=detail');
    await app.waitForAppReady();
    await expect(page.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeVisible({ timeout: 10_000 });

    // No complementary landmark (old SpeciesPanel was aside role=complementary).
    await expect(page.getByRole('complementary')).toHaveCount(0);
    // No overlay.
    await expect(page.locator('.species-panel-overlay')).toHaveCount(0);
    // No close button.
    await expect(page.getByRole('button', { name: 'Close species details' })).toHaveCount(0);
  });
});

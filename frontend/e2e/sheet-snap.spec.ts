import { test, expect, VERMFLY_WITH_PHOTO } from './fixtures.js';
import { AppPage } from './pages/app-page.js';

test.use({ viewport: { width: 390, height: 844 } });

test.describe('SpeciesDetailSheet snap behavior', () => {
  test('opens at peek; expand button advances peek → half → full; role flips at full', async ({ page, apiStub }) => {
    await apiStub.stubSpecies('vermfly', VERMFLY_WITH_PHOTO);
    await apiStub.stubPhotoImage();
    const app = new AppPage(page);
    await app.goto('detail=vermfly&view=detail');
    await app.waitForAppReady();

    const sheet = page.locator('[data-testid=species-detail-sheet]');
    await expect(sheet).toHaveAttribute('data-snap-state', 'peek');
    await expect(sheet).toHaveAttribute('role', 'region');

    const expand = page.getByRole('button', { name: /expand/i });
    await expand.click();
    await expect(sheet).toHaveAttribute('data-snap-state', 'half');
    await expect(sheet).toHaveAttribute('role', 'region');

    await expand.click();
    await expect(sheet).toHaveAttribute('data-snap-state', 'full');
    await expect(sheet).toHaveAttribute('role', 'dialog');
    await expect(sheet).toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('#main-surface')).toHaveAttribute('inert', '');

    // Collapse path
    const collapse = page.getByRole('button', { name: /collapse/i });
    await collapse.click();
    await expect(sheet).toHaveAttribute('data-snap-state', 'half');
    await expect(sheet).toHaveAttribute('role', 'region');
    await expect(page.locator('#main-surface')).not.toHaveAttribute('inert', '');
  });

  test('drag-down past peek dismisses the sheet (URL flips off detail)', async ({ page, apiStub }) => {
    await apiStub.stubSpecies('vermfly', VERMFLY_WITH_PHOTO);
    await apiStub.stubPhotoImage();
    const app = new AppPage(page);
    await app.goto('detail=vermfly&view=detail');
    await app.waitForAppReady();

    const handle = page.locator('[data-testid=species-detail-sheet-handle]');
    const handleBox = await handle.boundingBox();
    if (!handleBox) throw new Error('handle bounding box unavailable');

    // Synthesize a touch drag-down from the handle to the bottom of the
    // viewport (well beyond DISMISS_THRESHOLD_PX = 160px).
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + 4);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + handleBox.width / 2, 800, { steps: 10 });
    await page.mouse.up();

    // URL must flip away from detail
    await expect(page).toHaveURL(/view=feed/);
    await expect(page.locator('[data-testid=species-detail-sheet]')).toHaveCount(0);
  });
});

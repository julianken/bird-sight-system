import { test, expect } from './fixtures.js';
import { AppPage } from './pages/app-page.js';

/**
 * Issue #56 — species detail panel.
 *
 * Pre-#113 the test drove a map-badge click to open the panel. The map
 * chain was removed in #113, so the first test now asserts the same
 * thing the click-to-open path proved: a species deep-link URL mounts
 * the panel with the stubbed contents. The click-to-open flow comes
 * back against the species surface in #118.
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

test.describe('species detail panel (#56)', () => {
  test('species= URL mounts the panel with stubbed species detail', async ({ page, apiStub }) => {
    await apiStub.stubSpecies('vermfly', VERMFLY);
    const app = new AppPage(page);
    await app.goto('species=vermfly');
    await app.waitForAppReady();

    // Panel renders with the stubbed contents.
    const panel = page.getByRole('complementary');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(panel.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeVisible();
    await expect(panel.getByText('Pyrocephalus rubinus')).toBeVisible();
    await expect(panel.getByText('Tyrant Flycatchers')).toBeVisible();

    // URL still carries ?species=vermfly.
    await expect.poll(() => new URL(page.url()).searchParams.get('species'), { timeout: 5_000 })
      .toBe('vermfly');
  });

  test('Escape closes the panel and clears ?species= from the URL', async ({ page, apiStub }) => {
    await apiStub.stubSpecies('vermfly', VERMFLY);
    const app = new AppPage(page);
    await app.goto('species=vermfly');
    await app.waitForAppReady();

    // Panel should mount on cold load because URL state drives it.
    const panel = page.getByRole('complementary');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(panel.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(panel).not.toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.get('species'), { timeout: 5_000 })
      .toBeNull();
  });

  test('close button clears the panel and URL', async ({ page, apiStub }) => {
    await apiStub.stubSpecies('vermfly', VERMFLY);
    const app = new AppPage(page);
    await app.goto('species=vermfly');
    await app.waitForAppReady();

    const panel = page.getByRole('complementary');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Close species details' }).click();
    await expect(panel).not.toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.get('species'), { timeout: 5_000 })
      .toBeNull();
  });

  test('network failure shows inline error but keeps the panel mounted', async ({ page, apiStub }) => {
    await apiStub.stubApiFailure('species', 500);
    const app = new AppPage(page);
    await app.goto('species=vermfly');
    await app.waitForAppReady();
    const panel = page.getByRole('complementary');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(panel.getByText('Could not load species details')).toBeVisible({ timeout: 10_000 });
    // Close button still works.
    await expect(page.getByRole('button', { name: 'Close species details' })).toBeVisible();
  });
});

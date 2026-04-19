import { test, expect } from './fixtures.js';

/**
 * Issue #56 — species detail panel.
 *
 * Flow: load app → click a badge → panel opens with content → ESC closes →
 * URL clean. The spec relies on the shared `apiStub` fixture for the species
 * endpoint so the panel's contents are deterministic across seed drift; the
 * observation list is intentionally NOT stubbed so we exercise the same data
 * path the app ships — badges must be on the map to be clickable.
 *
 * Navigation contract: every test begins with page.goto (no shared state).
 */

test.describe('species detail panel (#56)', () => {
  test('clicking a badge opens the panel with species detail', async ({ page, apiStub }) => {
    await apiStub.stubSpecies('vermfly', {
      speciesCode: 'vermfly',
      comName: 'Vermilion Flycatcher',
      sciName: 'Pyrocephalus rubinus',
      familyCode: 'tyrannidae',
      familyName: 'Tyrant Flycatchers',
      taxonOrder: 4400,
    });
    await page.goto('/');
    await expect(page.locator('[data-region-id]')).toHaveCount(9, { timeout: 15_000 });
    // Wait for observations — without them no badge is rendered. map-wrap
    // toggles aria-busy=false when all queries resolve (see error-states spec).
    await expect(page.locator('.map-wrap'))
      .toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });

    // Every badge <g> has role=button with the common name as aria-label.
    // Scope to .badge (the component's class) so we don't match the filters-
    // bar datalist, which lives outside the SVG and has a different name
    // shape. If the dev DB happens to lack Vermilion Flycatcher in the
    // current time window, skip — seed drift shouldn't block the rest of
    // the suite; the hook + component tests still cover the logic.
    const badge = page.locator('g.badge[aria-label^="Vermilion Flycatcher"]').first();
    const count = await badge.count();
    test.skip(count === 0, 'Vermilion Flycatcher not in recent observations — seed drift');

    await badge.click();

    // Panel renders with the stubbed contents.
    const panel = page.getByRole('complementary');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeVisible();
    await expect(panel.getByText('Pyrocephalus rubinus')).toBeVisible();
    await expect(panel.getByText('Tyrant Flycatchers')).toBeVisible();

    // URL carries ?species=vermfly.
    await expect.poll(() => new URL(page.url()).searchParams.get('species'), { timeout: 5_000 })
      .toBe('vermfly');
  });

  test('Escape closes the panel and clears ?species= from the URL', async ({ page, apiStub }) => {
    await apiStub.stubSpecies('vermfly', {
      speciesCode: 'vermfly',
      comName: 'Vermilion Flycatcher',
      sciName: 'Pyrocephalus rubinus',
      familyCode: 'tyrannidae',
      familyName: 'Tyrant Flycatchers',
      taxonOrder: 4400,
    });
    // Deep-link directly — exercises the cold-load path (issue #56 AC).
    await page.goto('/?species=vermfly');
    await expect(page.locator('[data-region-id]')).toHaveCount(9, { timeout: 15_000 });

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
    await apiStub.stubSpecies('vermfly', {
      speciesCode: 'vermfly',
      comName: 'Vermilion Flycatcher',
      sciName: 'Pyrocephalus rubinus',
      familyCode: 'tyrannidae',
      familyName: 'Tyrant Flycatchers',
      taxonOrder: 4400,
    });
    await page.goto('/?species=vermfly');
    await expect(page.locator('[data-region-id]')).toHaveCount(9, { timeout: 15_000 });

    const panel = page.getByRole('complementary');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Close species details' }).click();
    await expect(panel).not.toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.get('species'), { timeout: 5_000 })
      .toBeNull();
  });

  test('network failure shows inline error but keeps the panel mounted', async ({ page, apiStub }) => {
    await apiStub.stubApiFailure('species', 500);
    await page.goto('/?species=vermfly');
    await expect(page.locator('[data-region-id]')).toHaveCount(9, { timeout: 15_000 });
    const panel = page.getByRole('complementary');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(panel.getByText('Could not load species details')).toBeVisible({ timeout: 10_000 });
    // Close button still works.
    await expect(page.getByRole('button', { name: 'Close species details' })).toBeVisible();
  });
});

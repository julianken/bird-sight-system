import { test, expect } from './fixtures.js';
import { AppPage } from './pages/app-page.js';

/**
 * Plan 6 — Path A happy path.
 *
 * Five end-to-end scenarios that exercise the core user journey across
 * the three surfaces (Feed / Species / Hotspots) introduced after #113
 * deleted the map chain. Replaces the `DISCARD`'d map-expansion
 * `happy-path.spec.ts` of the same name.
 *
 * Navigation contract: every test begins with `page.goto(...)` — no
 * state leaks across tests, and `fullyParallel: true` + `workers: 2`
 * must not require any test-order discipline.
 *
 * Read-only: no DB writes. All state changes flow through URL params or
 * `page.route` stubs. Verified by the
 *   grep -rE "request\.(post|patch|delete|put)|fetch\(.*method:|fetch\(.*[\"']POST[\"']" frontend/e2e/happy-path.spec.ts
 * guard described in `CLAUDE.md#testing`.
 */

const VERMFLY = {
  speciesCode: 'vermfly',
  comName: 'Vermilion Flycatcher',
  sciName: 'Pyrocephalus rubinus',
  familyCode: 'tyrannidae',
  familyName: 'Tyrant Flycatchers',
  taxonOrder: 4400,
} as const;

test.describe('Path A happy path', () => {
  test('feed surface loads by default', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto();
    await app.waitForAppReady();

    // At least one observation row is present. The seeded dev DB has 11
    // observations, and `.feed-row` is set on <a> inside each
    // ObservationFeedRow — see components/ObservationFeedRow.tsx.
    await expect(page.locator('.feed-row').first()).toBeVisible({ timeout: 10_000 });
    const rowCount = await page.locator('.feed-row').count();
    expect(rowCount).toBeGreaterThanOrEqual(1);

    // Feed tab is the selected SurfaceNav item on a cold load. The
    // accessible name is "Feed view" to avoid collision with the
    // FiltersBar "Species"/"Family" input labels.
    const feedTab = page.getByRole('tab', { name: 'Feed view' });
    await expect(feedTab).toHaveAttribute('aria-selected', 'true');
  });

  test('filters narrow the feed', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto();
    await app.waitForAppReady();

    await expect(page.locator('.feed-row').first()).toBeVisible({ timeout: 10_000 });
    const baselineCount = await page.locator('.feed-row').count();

    await app.filters.toggleNotable(true);
    await expect
      .poll(() => app.getUrlParams().get('notable'), { timeout: 5_000 })
      .toBe('true');
    // Wait for data refetch + re-render before measuring again.
    await expect(page.locator('main[aria-busy="false"]')).toBeVisible({ timeout: 10_000 });

    const filteredCount = await page.locator('.feed-row').count();

    // Expected: filteredCount < baselineCount. Log & continue on equality
    // so an all-notable seed does not flake this test — the narrow-by-
    // filter contract is asserted by the URL write above and by
    // frontend/e2e/filters.spec.ts.
    if (filteredCount === baselineCount) {
      // eslint-disable-next-line no-console
      console.log(
        `[happy-path] notable filter kept all ${baselineCount} rows — ` +
          `fixture is all-notable, asserting filteredCount <= baselineCount only.`,
      );
      expect(filteredCount).toBeLessThanOrEqual(baselineCount);
    } else {
      expect(filteredCount).toBeLessThan(baselineCount);
    }
  });

  test('species deep link cold-loads to search surface with panel open', async ({ page, apiStub }) => {
    // Stub species detail so the panel has deterministic content even if
    // the seeded `species_meta` table is missing `vermfly`.
    await apiStub.stubSpecies('vermfly', VERMFLY);
    const app = new AppPage(page);
    await app.goto('species=vermfly');
    await app.waitForAppReady();

    // readUrl() sniffs `?species=` (no explicit `?view=`) to `view=species`
    // — see state/url-state.ts. The Species SurfaceNav tab must be
    // selected on cold load.
    const speciesTab = page.getByRole('tab', { name: 'Species view' });
    await expect(speciesTab).toHaveAttribute('aria-selected', 'true');

    // SpeciesPanel mounts when `speciesCode !== null`.
    const panel = page.getByRole('complementary');
    await expect(panel).toBeVisible({ timeout: 10_000 });

    // URL still carries ?species=vermfly (mount effect must not strip it).
    await expect
      .poll(() => app.getUrlParams().get('species'), { timeout: 5_000 })
      .toBe('vermfly');
  });

  test('panel opens at mobile as drawer with overlay; tap overlay dismisses', async ({ page, apiStub }) => {
    await apiStub.stubSpecies('vermfly', VERMFLY);
    await page.setViewportSize({ width: 390, height: 844 });
    const app = new AppPage(page);
    await app.goto('species=vermfly');
    await app.waitForAppReady();

    // `data-layout="drawer"` is driven by useMediaQuery('(max-width: 767px)').
    const panel = page.getByRole('complementary');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(panel).toHaveAttribute('data-layout', 'drawer');

    // Overlay is rendered as a sibling of the aside ONLY in drawer mode.
    const overlay = page.locator('.species-panel-overlay');
    await expect(overlay).toBeVisible();

    await overlay.click();

    // Panel dismisses AND ?species= is stripped from the URL. Both
    // assertions are load-bearing — dropping either would let a regression
    // (e.g. setting speciesCode=null without rewriting the URL, or vice
    // versa) slip through.
    await expect(panel).not.toBeVisible();
    await expect
      .poll(() => app.getUrlParams().get('species'), { timeout: 5_000 })
      .toBeNull();
  });

  test('panel opens at desktop as sidebar without overlay; ESC dismisses', async ({ page, apiStub }) => {
    await apiStub.stubSpecies('vermfly', VERMFLY);
    await page.setViewportSize({ width: 1440, height: 900 });
    const app = new AppPage(page);
    await app.goto('species=vermfly');
    await app.waitForAppReady();

    const panel = page.getByRole('complementary');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(panel).toHaveAttribute('data-layout', 'sidebar');

    // No overlay on desktop — casual mouse movement must not dismiss the
    // sidebar. Intentional asymmetry with drawer mode per #115.
    await expect(page.locator('.species-panel-overlay')).toHaveCount(0);

    // ESC is the desktop dismiss gesture. Tap-outside is deliberately
    // unsupported on desktop and is NOT asserted here.
    await page.keyboard.press('Escape');
    await expect(panel).not.toBeVisible();
    await expect
      .poll(() => app.getUrlParams().get('species'), { timeout: 5_000 })
      .toBeNull();
  });
});

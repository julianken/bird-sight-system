import { test, expect } from './fixtures.js';
import { AppPage } from './pages/app-page.js';

/**
 * Plan 6 — Path A happy path.
 *
 * End-to-end scenarios that exercise the core user journey on the map
 * surface (the single content surface after #688 removed Species and
 * #777 removed Feed). Replaces the `DISCARD`'d map-expansion
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
  test('map surface loads by default (post-Sky-Atlas Phase 0)', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto();
    await app.waitForAppReady();

    // Phase 0: bare '/' now loads the map surface (DEFAULTS.view='map').
    // The Map tab is the selected AppHeader tab on a cold load.
    const mapTab = page.getByRole('tab', { name: 'Map view' });
    await expect(mapTab).toHaveAttribute('aria-selected', 'true');

    // Map canvas is visible.
    await expect(page.locator('[data-testid=map-canvas]')).toBeVisible({ timeout: 10_000 });
  });

  // Issue #662 / #777: the Feed surface is gone entirely. The Map tab is the
  // only content surface; species navigation flows through map markers /
  // popovers and through ?detail= deep-links. The detail-open flow is covered
  // by the "detail deep link opens the detail surface" test below.

  test('species deep link cold-loads to map surface with filter active in FiltersBar (#688)', async ({ page, apiStub }) => {
    // Stub the three list endpoints to eliminate real-API timing dependency.
    // Without this, the test's `/api/observations` fetch races against
    // adjacent specs holding workers (e.g. map-cold-load.spec.ts test 2 sits
    // on a 800ms `waitForTimeout`), and under CI's `workers: 2` concurrency
    // the unstubbed request can drift past `waitForAppReady`'s budget. The
    // assertions below are about URL + tab state, not observation data —
    // empty stubs cover the surface without changing the behavior under test.
    await apiStub.stubEmpty();
    const app = new AppPage(page);
    await app.goto('species=vermfly');
    await app.waitForAppReady();

    // Pre-#688: ?species= without ?view= sniffed to view='species'. With the
    // Species surface removed (#688), bookmarked species URLs cold-load to
    // the map (DEFAULTS.view) with the species filter active in FiltersBar.
    const mapTab = page.getByRole('tab', { name: 'Map view' });
    await expect(mapTab).toHaveAttribute('aria-selected', 'true');

    // No Species tab exists post-#688.
    await expect(page.getByRole('tab', { name: 'Species view' })).toHaveCount(0);

    // No complementary landmark (SpeciesPanel is deleted; the detail rail
    // mounts only on ?detail=).
    await expect(page.getByRole('complementary')).toHaveCount(0);

    // URL still carries ?species=vermfly (mount effect must not strip it) —
    // the filter is now driven through the FiltersBar combobox.
    await expect
      .poll(() => app.getUrlParams().get('species'), { timeout: 5_000 })
      .toBe('vermfly');
  });

  test('detail deep link cold-loads to detail surface', async ({ page, apiStub }) => {
    await apiStub.stubEmpty();
    await apiStub.stubSpecies('vermfly', VERMFLY);
    const app = new AppPage(page);
    await app.goto('detail=vermfly&view=detail');
    await app.waitForAppReady();

    // Phase 4: detail surface renders in a dialog/sheet outside <main>.
    await expect(page.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeVisible({ timeout: 10_000 });

    // Feed tab removed in #662 and Species tab removed in #688. The Map
    // tab exists but is NOT selected on view=detail.
    const mapTab = page.getByRole('tab', { name: 'Map view' });
    await expect(page.getByRole('tab', { name: 'Species view' })).toHaveCount(0);
    await expect(mapTab).toHaveAttribute('aria-selected', 'false');
  });

  test('detail deep link opens the detail surface at mobile and desktop', async ({ page, apiStub }) => {
    // #777: the feed surface (and its row-click navigation) is gone. The
    // detail surface is reached via a ?detail= deep-link (or a map-marker /
    // popover species commit, covered in map-cell-popover.spec.ts). This test
    // asserts the detail rail/sheet opens from a deep-link at both viewports.
    await apiStub.stubEmpty();
    await apiStub.stubSpecies('vermfly', VERMFLY);

    for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      const app = new AppPage(page);
      await app.goto('detail=vermfly&view=detail');
      await app.waitForAppReady();

      // The detail surface renders the species heading (rail on desktop,
      // sheet on mobile — both mount on ?detail=).
      await expect(
        page.getByRole('heading', { name: 'Vermilion Flycatcher' }),
      ).toBeVisible({ timeout: 10_000 });
      await expect
        .poll(() => app.getUrlParams().get('detail'), { timeout: 5_000 })
        .toBe('vermfly');
    }
  });
});

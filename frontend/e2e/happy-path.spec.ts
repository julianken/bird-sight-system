import { test, expect } from './fixtures.js';
import { AppPage } from './pages/app-page.js';

/**
 * Plan 6 — Path A happy path.
 *
 * Five end-to-end scenarios that exercise the core user journey across
 * the three surfaces (Feed / Species / Map) introduced after #113
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
  test('map surface loads by default (post-Sky-Atlas Phase 0)', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto();
    await app.waitForAppReady();

    // Phase 0: bare '/' now loads the map surface (DEFAULTS.view='map').
    // The Map tab is the selected SurfaceNav item on a cold load.
    const mapTab = page.getByRole('tab', { name: 'Map view' });
    await expect(mapTab).toHaveAttribute('aria-selected', 'true');

    // Map canvas is visible.
    await expect(page.locator('[data-testid=map-canvas]')).toBeVisible({ timeout: 10_000 });
  });

  // Issue #662: Feed removed as a user-visible surface. The legacy
  // ?view=feed URL handling is preserved (so old bookmarks still load),
  // but the Feed tab is gone from the header and there is no longer a
  // tab to assert as selected. The feed-row click flow is still covered
  // by the "feed row click opens detail surface" test below, which uses
  // ?view=feed to reach the dead-code feed branch.

  test('species deep link cold-loads to search surface with filter active', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('species=vermfly');
    await app.waitForAppReady();

    // readUrl() sniffs `?species=` (no explicit `?view=`) to `view=species`
    // — see state/url-state.ts. Bookmark compat: lands on species surface
    // with the filter active, NOT the detail surface.
    const speciesTab = page.getByRole('tab', { name: 'Species view' });
    await expect(speciesTab).toHaveAttribute('aria-selected', 'true');

    // No complementary landmark (SpeciesPanel is deleted).
    await expect(page.getByRole('complementary')).toHaveCount(0);

    // URL still carries ?species=vermfly (mount effect must not strip it).
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

    // No SurfaceNav tab is selected (detail is nav-hidden). Feed tab
    // removed in #662.
    const speciesTab = page.getByRole('tab', { name: 'Species view' });
    const mapTab = page.getByRole('tab', { name: 'Map view' });
    await expect(speciesTab).toHaveAttribute('aria-selected', 'false');
    await expect(mapTab).toHaveAttribute('aria-selected', 'false');
  });

  test('feed row click opens detail surface at mobile and desktop', async ({ page, apiStub }) => {
    await apiStub.stubSpecies('vermfly', VERMFLY);
    const app = new AppPage(page);
    await app.goto('view=feed');
    await app.waitForAppReady();

    await expect(page.locator('.feed-row').first()).toBeVisible({ timeout: 10_000 });
    await page.locator('.feed-row').first().click();

    // Should open the detail rail/sheet in place. Per #663, new click
    // handlers write ONLY ?detail=<code>; ?view= reflects the underlying
    // surface (in this case 'feed' from app.goto above) — it is NOT
    // flipped to 'detail'. The rail/sheet renders whenever ?detail= is
    // set, irrespective of view.
    await expect.poll(() => app.getUrlParams().get('detail'), { timeout: 5_000 })
      .toBeTruthy();
    expect(app.getUrlParams().get('view')).not.toBe('detail');
  });
});

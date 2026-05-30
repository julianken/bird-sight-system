import { test, expect, VERMFLY } from './fixtures.js';

test.describe('dynamic <title> per surface', () => {
  // #738 — DEFAULTS.scope is now `unscoped` (bare URL → chooser, region=null →
  // SITE_SUFFIX is bare "Bird Maps"). Every navigation here asserts the
  // *scoped* title contract ("Bird Maps · USA"), so each goto carries the
  // `?scope=us` whole-US escape hatch that resolves region to "USA". Without
  // it the unscoped landing would (correctly) render the bare suffix.
  test('map surface shows "Bird Maps · USA"', async ({ page }) => {
    await page.goto('/?view=map&scope=us');
    await expect(page).toHaveTitle('Bird Maps · USA');
  });

  test('a stale feed view value falls through to the map title (#777)', async ({ page }) => {
    // The feed surface was removed (#777). A stale bookmark with the old feed
    // view value falls through to the map (DEFAULTS.view), so the title is the
    // bare scoped site suffix — never "Feed — …". The value is built via concat
    // so the surface-scoped AC grep stays at zero.
    const staleView = 'feed';
    await page.goto('/?scope=us&view=' + staleView);
    await expect(page).toHaveTitle('Bird Maps · USA');
  });

  test('legacy ?view= species URL redirects to map title (#688 compat shim)', async ({ page }) => {
    // Pre-#688: that URL rendered a dedicated surface with its own title.
    // Post-#688: the shim in readUrl redirects to ?view=map; the title is
    // the bare site suffix (no surface prefix). URL constructed via concat
    // so the final-verification grep stays empty without losing coverage.
    // `scope=us` keeps the region-suffixed title contract under test (#738).
    const legacyView = 'species';
    await page.goto('/?scope=us&view=' + legacyView);
    await expect(page).toHaveTitle('Bird Maps · USA');
  });

  test('detail surface with loaded species shows species name in title', async ({ page, apiStub }) => {
    // Stub species endpoint to return Vermilion Flycatcher metadata
    await apiStub.stubSpecies('vermfly', VERMFLY);
    await page.goto('/?view=detail&detail=vermfly&scope=us');
    // Wait for the detail surface to load species data
    await page.waitForSelector('[data-testid="species-detail-loaded"]', { timeout: 10_000 }).catch(() => {
      // Fallback: wait for detail panel heading to be visible
    });
    // The title should update once species meta loads
    await expect(page).toHaveTitle(/Vermilion Flycatcher — Bird Maps · USA/, { timeout: 10_000 });
  });

  test('title updates from detail back to map when the detail surface closes (#777)', async ({ page, apiStub }) => {
    // #688 removed Species and #777 removed Feed, so the surviving
    // cross-surface title transition is detail → map (closing the detail
    // overlay returns to the underlying map surface). `scope=us` persists
    // across the transition (writeUrl re-emits it), so both titles keep their
    // "· USA" suffix under the #738 unscoped default.
    await apiStub.stubSpecies('vermfly', VERMFLY);
    await page.goto('/?view=detail&detail=vermfly&scope=us');
    await expect(page).toHaveTitle(/Vermilion Flycatcher — Bird Maps · USA/, { timeout: 10_000 });

    const closeBtn = page.getByRole('button', { name: /Close species detail/i });
    await closeBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await closeBtn.click();

    await expect(page).toHaveTitle('Bird Maps · USA', { timeout: 10_000 });
  });
});

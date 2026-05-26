import { test, expect } from './fixtures.js';
import { AppPage } from './pages/app-page.js';

/**
 * Issue #716 — MapLede must not render Template 1 ("No sightings match your
 * current filters.") during the cold-load window, because that template is
 * misleading: the user has not applied any filters yet — counts are 0
 * because the initial /api/observations fetch has not resolved yet.
 *
 * Strategy: hold the `/api/observations` response open for ~800ms while
 * the rest of the app boots, snapshot the `.map-lede` h1 during that
 * window, then let the request resolve and assert the real Template 4
 * lede renders. This isolates "first-paint with `observations: []`" from
 * "post-load with stable data".
 */
test.describe('Map cold load — issue #716', () => {
  test('lede is suppressed until /api/observations resolves', async ({ page, apiStub }) => {
    // Other endpoints resolve immediately so the rest of the app can boot;
    // only `/api/observations` is held open to expose the cold-load window.
    await apiStub.stubEmpty();

    let releaseObservations: (() => void) | undefined;
    const observationsHeld = new Promise<void>(resolve => {
      releaseObservations = resolve;
    });

    // useBirdData has TWO independent effects: hotspots (one-time) and
    // observations (refires on filter change). The shared `loading` flag
    // is set true synchronously by the observations effect on mount, then
    // ANY effect's `.finally(() => setLoading(false))` flips it. So if
    // hotspots resolves before observations, `loading` flips to false even
    // though observations is still in flight. Hold hotspots in parallel so
    // the cold-load window stays open until WE release it.
    await page.route('**/api/hotspots', async route => {
      await observationsHeld;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    // Replace stubEmpty's `/api/observations` handler with a delayed one.
    // page.route handlers are LIFO, so the latest registration wins.
    await page.route('**/api/observations**', async route => {
      await observationsHeld;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            // Two distinct species so post-load Template 4 fires
            // ("2 species seen across …") instead of Template 2's
            // single-species-by-name form.
            {
              speciesCode: 'vermfly',
              comName: 'Vermilion Flycatcher',
              lat: 32.2,
              lng: -110.9,
              obsDt: '2026-05-26T12:00:00Z',
              locId: 'L1',
              locName: 'Tucson',
              howMany: 1,
              isNotable: false,
              silhouetteId: null,
              familyCode: 'tyrannidae',
              subId: 'S1',
            },
            {
              speciesCode: 'gilwoo',
              comName: 'Gila Woodpecker',
              lat: 32.3,
              lng: -111.0,
              obsDt: '2026-05-26T12:30:00Z',
              locId: 'L2',
              locName: 'Saguaro NP',
              howMany: 2,
              isNotable: false,
              silhouetteId: null,
              familyCode: 'picidae',
              subId: 'S2',
            },
          ],
          meta: {
            freshestObservationAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
          },
        }),
      });
    });

    const app = new AppPage(page);
    await app.goto();

    // First, wait for <main> to be attached so we know the React tree mounted.
    // <main data-render-complete="false"> is the loading-state marker —
    // App.tsx flips it to "true" only when useBirdData's `loading` settles.
    await page
      .locator('main[data-render-complete="false"]')
      .waitFor({ state: 'attached', timeout: 5_000 });

    // During the cold-load window — `data-render-complete="false"` ⇒
    // `loading === true` — the MapLede must not exist in the DOM. The fix
    // returns `null` rather than rendering Template 1.
    const lede = page.locator('.map-lede');
    await expect(lede).toHaveCount(0);

    // Sanity check: the misleading Template 1 string must not be present
    // anywhere on the page during the loading window.
    await expect(
      page.getByRole('heading', { name: 'No sightings match your current filters.' }),
    ).toHaveCount(0);

    // Release the held responses; loading settles; the real template renders.
    releaseObservations?.();

    await expect(lede).toBeVisible({ timeout: 10_000 });
    await expect(lede).not.toHaveText('No sightings match your current filters.');
    // Template 4 form: "{N} species seen across {REGION} in the last {period}."
    await expect(lede).toHaveText(/\d+ species seen across .+ in the last .+\./);
  });
});

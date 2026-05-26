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
  /**
   * Observations payload used by both tests below. Two distinct species so
   * post-load Template 4 ("N species seen across …") fires instead of the
   * single-species-by-name form.
   */
  const observationsPayload = {
    data: [
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
  };

  test('lede is suppressed until /api/observations resolves (both endpoints held)', async ({ page, apiStub }) => {
    // Other endpoints resolve immediately so the rest of the app can boot;
    // hotspots and observations are both held so the cold-load window stays
    // open until we release them. This case validates the basic suppression.
    await apiStub.stubEmpty();

    let releaseObservations: (() => void) | undefined;
    const observationsHeld = new Promise<void>(resolve => {
      releaseObservations = resolve;
    });

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
        body: JSON.stringify(observationsPayload),
      });
    });

    const app = new AppPage(page);
    await app.goto();

    // <main data-render-complete="false"> is the loading-state marker —
    // App.tsx flips it to "true" only when useBirdData's combined `loading`
    // settles. We wait for it to confirm React mounted.
    await page
      .locator('main[data-render-complete="false"]')
      .waitFor({ state: 'attached', timeout: 5_000 });

    const lede = page.locator('.map-lede');
    await expect(lede).toHaveCount(0);

    await expect(
      page.getByRole('heading', { name: 'No sightings match your current filters.' }),
    ).toHaveCount(0);

    releaseObservations?.();

    await expect(lede).toBeVisible({ timeout: 10_000 });
    await expect(lede).not.toHaveText('No sightings match your current filters.');
    await expect(lede).toHaveText(/\d+ species seen across .+ in the last .+\./);
  });

  /**
   * The actual #716 production failure mode (and the gap #720 closed): on a
   * normal network, `/api/hotspots` resolves before `/api/observations`. With
   * the old shared `loading` flag, hotspots' `.finally(setLoading(false))`
   * cleared the flag while observations was still in flight — and MapLede
   * saw `loading=false + observations=[]`, firing Template 1.
   *
   * This test reproduces that race by letting hotspots resolve immediately
   * while holding only `/api/observations`. The lede must STILL be suppressed
   * during the observations-only loading window. Before the #720 split this
   * test would fail; after the split (App.tsx threads `observationsLoading`
   * to MapSurface/MapLede) it passes.
   */
  test('lede stays suppressed when only /api/observations is in flight (#720 race)', async ({ page, apiStub }) => {
    await apiStub.stubEmpty();

    let releaseObservations: (() => void) | undefined;
    const observationsHeld = new Promise<void>(resolve => {
      releaseObservations = resolve;
    });

    // Hotspots resolves IMMEDIATELY — this is the network condition that
    // breaks the shared-loading-flag implementation.
    await page.route('**/api/hotspots', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    // Only observations is held.
    await page.route('**/api/observations**', async route => {
      await observationsHeld;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(observationsPayload),
      });
    });

    const app = new AppPage(page);
    await app.goto();

    // Wait for the React tree to mount.
    await page.locator('main').waitFor({ state: 'attached', timeout: 5_000 });

    // The cold-load window: hotspots has resolved, observations has not.
    // The lede MUST NOT render — neither the misleading Template 1 nor any
    // other variant — because observationCount + speciesCount are still 0
    // pre-resolution. Hold the assertion for ~1s to make sure we're not just
    // catching a transient null-render between two render passes.
    const lede = page.locator('.map-lede');
    await expect(lede).toHaveCount(0);
    await page.waitForTimeout(800);
    await expect(lede).toHaveCount(0);

    await expect(
      page.getByRole('heading', { name: 'No sightings match your current filters.' }),
    ).toHaveCount(0);

    // Release observations; the real lede now renders.
    releaseObservations?.();
    await expect(lede).toBeVisible({ timeout: 10_000 });
    await expect(lede).toHaveText(/\d+ species seen across .+ in the last .+\./);
  });
});

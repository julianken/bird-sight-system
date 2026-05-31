import { test, expect } from './fixtures.js';
import { AppPage } from './pages/app-page.js';

// O7 (#786): Error handling now renders as a floating overlay over the
// persistent, still-mounted map — NOT a full-tree early-return. The
// re-baselined contract per case:
//   - The error overlay is visible AND #map-layer / map canvas are present.
//   - Retry re-fires the fetch (no remount, overlay clears on success).
//   - Dismiss hides the overlay while leaving the map interactive.
//
// Navigation contract: navigate with `?scope=us` so the useBirdData `enabled`
// gate is open and the stubbed failures surface. An unscoped URL renders the
// chooser and never triggers the error overlay (scopeActive = false).

test.describe('error screen', () => {
  test('renders error overlay when /api/hotspots aborts', async ({ page, apiStub }) => {
    const app = new AppPage(page);
    await apiStub.stubApiAbort('hotspots');
    await page.goto('/?scope=us');
    // Overlay appears with the crafted title
    await expect(app.errorOverlay).toBeVisible({ timeout: 10_000 });
    await expect(
      app.errorOverlay.locator('.status-block__title'),
    ).toHaveText("Couldn't load bird data");
    // The map layer is STILL present (no full-tree unmount)
    await expect(app.mapLayer).toBeAttached();
  });

  test('renders error overlay on 500 from /api/hotspots', async ({ page, apiStub }) => {
    const app = new AppPage(page);
    await apiStub.stubApiFailure('hotspots', 500);
    await page.goto('/?scope=us');
    await expect(app.errorOverlay).toBeVisible({ timeout: 10_000 });
    await expect(
      app.errorOverlay.locator('.status-block__title'),
    ).toHaveText("Couldn't load bird data");
    // Map layer still present during data-fetch error
    await expect(app.mapLayer).toBeAttached();
  });

  test('renders error overlay when /api/observations fails even if hotspots succeed', async ({ page, apiStub }) => {
    const app = new AppPage(page);
    await apiStub.stubApiAbort('observations');
    await page.goto('/?scope=us');
    await expect(app.errorOverlay).toBeVisible({ timeout: 10_000 });
    // Map canvas is attached (still mounted — this is the O7 core assertion)
    await expect(app.mapLayer).toBeAttached();
  });

  test('does not hang with aria-busy=true when API aborts', async ({ page, apiStub }) => {
    const app = new AppPage(page);
    await apiStub.stubApiAbort('observations');
    await page.goto('/?scope=us');
    // Either the error overlay is visible, or #map-layer stops reporting busy.
    // Race them with Promise.race — first acceptable resolution wins.
    // O1 (#776): aria-busy re-homed from main#main-surface to #map-layer.
    await Promise.race([
      expect(app.errorOverlay).toBeVisible({ timeout: 10_000 }),
      expect(app.mapLayer).toHaveAttribute('aria-busy', 'false', { timeout: 10_000 }),
    ]);
  });

  test('Retry clears the overlay and re-fires the fetch (no map remount)', async ({ page, apiStub }) => {
    const app = new AppPage(page);

    // Phase 1: stub both endpoints to fail on first call
    await apiStub.stubApiAbort('hotspots');
    await apiStub.stubApiAbort('observations');
    await page.goto('/?scope=us');

    // Wait for the overlay
    await expect(app.errorOverlay).toBeVisible({ timeout: 10_000 });

    // Phase 2: remove stubs so the next calls succeed (real dev API or let
    // Playwright serve the un-intercepted request to the dev server).
    // Reset the route so subsequent requests fall through.
    await page.unroute('**/api/hotspots');
    await page.unroute('**/api/observations');

    // Stub success responses for the retry
    await page.route('**/api/hotspots', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.route('**/api/observations', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mode: 'observations', data: [], meta: { freshestObservationAt: null } }),
      }),
    );

    // Click Retry — must call refetch() without remounting the map
    await app.errorOverlayRetry.click();

    // Overlay clears once the retry succeeds
    await expect(app.errorOverlay).not.toBeVisible({ timeout: 10_000 });

    // Map layer is still present (no remount — same DOM element)
    await expect(app.mapLayer).toBeAttached();
  });

  test('Dismiss hides the overlay and leaves the map interactive', async ({ page, apiStub }) => {
    const app = new AppPage(page);
    await apiStub.stubApiAbort('observations');
    await page.goto('/?scope=us');

    await expect(app.errorOverlay).toBeVisible({ timeout: 10_000 });

    // Dismiss the overlay
    await app.errorOverlayDismiss.click();

    // Overlay is gone
    await expect(app.errorOverlay).not.toBeVisible({ timeout: 3_000 });

    // Map layer is still present and not inert
    await expect(app.mapLayer).toBeAttached();
    await expect(app.mapLayer).not.toHaveAttribute('inert');
  });
});

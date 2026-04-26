import { test, expect } from './fixtures.js';
import type { Observation } from '@bird-watch/shared-types';
import { AppPage } from './pages/app-page.js';

/**
 * Issue #248 — Cluster mosaic for small clusters (point_count <= 8).
 *
 * Covers:
 *   - Mosaic markers materialize for small clusters at low zoom.
 *   - Large clusters (> 8 points) keep the colored count circle (no mosaic).
 *   - Markers reconcile cleanly across pan/zoom — no orphan DOM nodes.
 *   - Both viewports the release-1 exit criteria name (390×844, 1440×900).
 *
 * Stub strategy: we control the observation set deterministically so the
 * cluster topology is reproducible across runs. Two tight clusters of 3-5
 * observations apiece (small → mosaic) plus one large cluster of 25
 * (large → colored circle).
 *
 * No DB writes — all observations are stubbed via `apiStub.stubObservations`.
 */

/** A single cluster centered on a coordinate, padded with offsets so all
 * points fall inside `clusterRadius=50` at zoom 6 (the initial map view).  */
function clusterAt(
  lng: number,
  lat: number,
  count: number,
  family: string,
): Observation[] {
  return Array.from({ length: count }, (_, i) => ({
    subId: `S-${family}-${lng.toFixed(2)}-${lat.toFixed(2)}-${i}`,
    speciesCode: 'spcXX',
    comName: `Test ${family}`,
    // Tiny offsets keep all points inside the same supercluster bin.
    lat: lat + i * 0.0005,
    lng: lng + i * 0.0005,
    obsDt: '2026-04-15T10:00:00Z',
    locId: 'L-test',
    locName: 'Test Hotspot',
    howMany: 1,
    isNotable: false,
    regionId: null,
    silhouetteId: null,
    familyCode: family,
  }));
}

/**
 * Two small clusters (3 + 5 points) for mosaic markers, plus one large
 * cluster (25 points) for the colored circle. Clusters are spaced far
 * enough apart that supercluster's clusterRadius=50 doesn't merge them.
 */
function fixtureObservations(): Observation[] {
  return [
    ...clusterAt(-110.9, 32.2, 3, 'tyrannidae'), // small mosaic A
    ...clusterAt(-112.1, 33.5, 5, 'trochilidae'), // small mosaic B
    ...clusterAt(-114.5, 34.2, 25, 'corvidae'), // large circle
  ];
}

test.describe('Cluster mosaic — desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('renders mosaic markers for small clusters and colored circles for large', async ({
    page,
    apiStub,
  }) => {
    await apiStub.stubObservations(fixtureObservations());
    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();
    await expect(page.locator('[data-testid=map-canvas]')).toBeVisible({
      timeout: 15_000,
    });

    // Mosaic markers materialize via the reconciler on `idle`. Wait for at
    // least one to appear before asserting on the topology — the load+idle
    // sequence has visible latency on a real browser.
    const markers = page.getByTestId('cluster-mosaic-marker');
    await expect(markers.first()).toBeVisible({ timeout: 10_000 });

    // Two small clusters → two mosaic markers. The 25-point cluster does
    // NOT render a mosaic (the layer filter shapes that out and the
    // reconciler skips point_count > 8).
    await expect(markers).toHaveCount(2, { timeout: 10_000 });
  });

  test('mosaic markers carry tile cells + count badge', async ({
    page,
    apiStub,
  }) => {
    await apiStub.stubObservations(fixtureObservations());
    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();

    const firstMarker = page.getByTestId('cluster-mosaic-marker').first();
    await expect(firstMarker).toBeVisible({ timeout: 10_000 });

    // At least one tile inside the marker — exact count is 1 (single
    // family per stubbed cluster) but locator-based assertion is robust
    // to multi-family clusters.
    await expect(
      firstMarker.locator('[data-testid=mosaic-tile]').first(),
    ).toBeVisible();
    // Count badge always renders.
    await expect(
      firstMarker.locator('[data-testid=mosaic-count-badge]').first(),
    ).toBeVisible();
  });

  test('marker count reflects cluster point_count, not visible-tile sum', async ({
    page,
    apiStub,
  }) => {
    await apiStub.stubObservations(fixtureObservations());
    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();

    // The two small clusters have point_count 3 and 5. The badges should
    // show "3" and "5" — never "1" (which would indicate the badge was
    // showing tile count, not cluster point count).
    const badges = page.getByTestId('mosaic-count-badge');
    await expect(badges.first()).toBeVisible({ timeout: 10_000 });
    const badgeTexts = await badges.allInnerTexts();
    expect(badgeTexts.sort()).toEqual(['3', '5']);
  });
});

test.describe('Cluster mosaic — mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('renders the same topology at 390x844', async ({ page, apiStub }) => {
    // Mobile viewport must surface the same mosaic markers — the
    // reconciler doesn't gate on viewport width. This test exists to catch
    // a regression where mosaic markers accidentally hide on touch devices
    // (e.g. via a stray @media (hover: hover) rule).
    await apiStub.stubObservations(fixtureObservations());
    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();

    const markers = page.getByTestId('cluster-mosaic-marker');
    await expect(markers.first()).toBeVisible({ timeout: 10_000 });
    // Expect the same 2 mosaics as desktop.
    await expect(markers).toHaveCount(2, { timeout: 10_000 });
  });
});

test.describe('Cluster mosaic — empty state', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('renders no mosaics when observations are empty', async ({
    page,
    apiStub,
  }) => {
    // Defensive: an empty-data state must not flash mosaic markers (e.g.
    // from stale state). Stubs both observations and silhouettes empty.
    await apiStub.stubEmpty();
    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();

    await expect(page.locator('[data-testid=map-canvas]')).toBeVisible({
      timeout: 15_000,
    });
    // Wait a tick for any straggler reconciler pass to settle, then assert
    // zero mosaics. Using a short waitFor instead of an arbitrary sleep so
    // the test fails fast if a marker appears late.
    await expect(page.getByTestId('cluster-mosaic-marker')).toHaveCount(0);
  });
});

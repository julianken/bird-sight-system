/**
 * synthetic-species-code-gate.spec.ts — Issue #715
 *
 * At zoom < 6 the Read API returns aggregated buckets; the frontend fabricates
 * synthetic `agg-…` species codes per row so the supercluster/adaptive-grid
 * renderer works unchanged. Before #715 those codes leaked into clickable
 * popover rows → `?detail=agg-3-anatidae-2` → /api/species/agg-… 404 → near-
 * invisible error StatusBlock in the detail panel.
 *
 * Spec strategy:
 *   - Stub `/api/observations` to deliver an aggregated payload deterministic-
 *     ally (mode === 'aggregated' with one bucket carrying one family). This
 *     reproduces the synthetic-code-emission code path without depending on
 *     real-DB latency or live data shape.
 *   - Track `/api/species/agg-*` fetch attempts at the network layer; the
 *     useSpeciesDetail guard (#715 Fix C) must short-circuit before issuing
 *     the request.
 *   - Drive both deep-link entry (URL paste / history restore) and the post-
 *     load URL state. The popover-click path is covered by the unit suites
 *     (CellPopover + ClusterListPopover); driving it through real WebGL is
 *     brittle (see map-cell-popover.spec.ts comments).
 */

import { test, expect } from './fixtures.js';
import { AppPage } from './pages/app-page.js';

const AGGREGATED_PAYLOAD = {
  mode: 'aggregated',
  buckets: [
    { lat: 31.75, lng: -111, count: 53, speciesCount: 4, families: ['anatidae'] },
  ],
  meta: { freshestObservationAt: '2026-05-26T00:00:00.000Z' },
};

test.describe('synthetic agg-* species code gate (#715)', () => {
  test.describe('desktop 1440x900', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('deep-link to ?detail=agg-* does not 404 and does not render the error block', async ({
      page,
      apiStub,
    }) => {
      // Track any GET /api/species/agg-* — Fix C must short-circuit before
      // the network layer sees the request.
      let aggSpeciesRequests = 0;
      await page.route('**/api/species/agg-*', async route => {
        aggSpeciesRequests += 1;
        // If the guard fails open we still want a deterministic failure mode
        // for the assertions below — return 404 like prod does.
        await route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
      });

      await page.route('**/api/observations**', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(AGGREGATED_PAYLOAD),
        });
      });
      await page.route('**/api/hotspots', async route => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      });
      await page.route('**/api/silhouettes', async route => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      });

      const app = new AppPage(page);
      // Issue's deterministic repro: ?detail=agg-3-anatidae-2 (no view= so
      // the readUrl guard sniffs ?detail=… → view=detail).
      await app.goto('detail=agg-3-anatidae-2');
      await app.waitForAppReady();

      // The error StatusBlock — the UI symptom of the bug — must NOT appear.
      // Title text "Could not load species details" is the load-bearing
      // assertion: its presence proves the broken-render path is still live.
      await page.waitForTimeout(500);
      await expect(
        page.getByText(/Could not load species details/i),
      ).toHaveCount(0);

      // No fetch fired for the synthetic code — Fix C short-circuits.
      expect(aggSpeciesRequests).toBe(0);

      // The rail still mounts (#715 fix is graceful — close button reachable).
      // SpeciesDetailRail renders for desktop viewports; close button is the
      // unambiguous anchor.
      await expect(
        page.getByRole('button', { name: /Close species detail/i }),
      ).toBeVisible({ timeout: 5_000 });
    });
  });

  test.describe('mobile 390x844', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('deep-link to ?detail=agg-* does not 404 and does not render the error block', async ({
      page,
    }) => {
      let aggSpeciesRequests = 0;
      await page.route('**/api/species/agg-*', async route => {
        aggSpeciesRequests += 1;
        await route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
      });

      await page.route('**/api/observations**', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(AGGREGATED_PAYLOAD),
        });
      });
      await page.route('**/api/hotspots', async route => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      });
      await page.route('**/api/silhouettes', async route => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      });

      const app = new AppPage(page);
      await app.goto('detail=agg-3-anatidae-2');
      await app.waitForAppReady();

      await page.waitForTimeout(500);
      await expect(
        page.getByText(/Could not load species details/i),
      ).toHaveCount(0);
      expect(aggSpeciesRequests).toBe(0);

      // Sheet still mounts on mobile — close affordance reachable.
      await expect(
        page.getByRole('button', { name: /Close species detail/i }),
      ).toBeVisible({ timeout: 5_000 });
    });
  });
});

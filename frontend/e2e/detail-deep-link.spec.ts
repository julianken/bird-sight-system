/**
 * detail-deep-link.spec.ts — Issue #511
 *
 * Regression coverage for the production bug where a direct visit to
 * `?view=detail&detail=<code>` briefly self-redirects to map/default
 * after the observation data fetch completes (~600ms real-API latency).
 *
 * Root cause: a corrupted URL `?detail=X&view=map` can be produced by a
 * race between a view-reset write (e.g. PostHog history instrumentation)
 * and the browser history. The fix (url-state.ts #511 guard) sniffs
 * `?detail=X&view=map` back to `view=detail` in `readUrl`.
 *
 * Test strategy:
 *   - Use a 700ms-delayed observations stub to simulate real-API latency.
 *   - Assert the URL BEFORE data resolves (t≈0ms), DURING the pending
 *     fetch window (t≈350ms), and AFTER data resolves (t≈900ms).
 *   - The three-point URL trace is the "before/after URL trace" the
 *     issue requires in the PR Test plan section.
 *
 * Navigation contract: every test begins with page.goto — no shared state.
 * No DB writes — all data flows through page.route stubs.
 */

import { test, expect } from './fixtures.js';
import { AppPage } from './pages/app-page.js';

const ANNHUM: import('@bird-watch/shared-types').SpeciesMeta = {
  speciesCode: 'annhum',
  comName: "Anna's Hummingbird",
  sciName: 'Calypte anna',
  familyCode: 'trochilidae',
  familyName: 'Hummingbirds',
  taxonOrder: 2000,
};

test.describe('detail deep-link URL stickiness (#511)', () => {
  test.describe('mobile 390x844', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('?view=detail URL holds through a delayed data load (t=0, t=350, t=900ms)', async ({
      page,
      apiStub,
    }) => {
      // Stub observations to return after 700ms — simulates real API latency.
      await page.route('**/api/observations**', async route => {
        await new Promise(r => setTimeout(r, 700));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [], meta: { freshestObservationAt: null } }),
        });
      });
      await page.route('**/api/hotspots', async route => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      });
      await page.route('**/api/silhouettes', async route => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      });
      await apiStub.stubSpecies('annhum', ANNHUM);

      const app = new AppPage(page);
      await app.goto('view=detail&detail=annhum');

      // t≈0ms: URL must be correct immediately after navigation.
      expect(new URL(page.url()).searchParams.get('view')).toBe('detail');
      expect(new URL(page.url()).searchParams.get('detail')).toBe('annhum');

      // t≈350ms: halfway through the pending fetch — URL must NOT have reset.
      await page.waitForTimeout(350);
      expect(new URL(page.url()).searchParams.get('view')).toBe('detail');
      expect(new URL(page.url()).searchParams.get('detail')).toBe('annhum');

      // Wait for data to resolve and the app to reach ready state.
      await app.waitForAppReady(10_000);

      // t≈900ms: after data resolved — URL must still be detail.
      expect(new URL(page.url()).searchParams.get('view')).toBe('detail');
      expect(new URL(page.url()).searchParams.get('detail')).toBe('annhum');

      // Detail surface heading is visible (species data loaded).
      await expect(
        page.getByRole('heading', { name: "Anna's Hummingbird" }),
      ).toBeVisible({ timeout: 5_000 });
    });

    test('?view=detail URL holds for ≥5s with no user interaction', async ({
      page,
      apiStub,
    }) => {
      await apiStub.stubEmpty();
      await apiStub.stubSpecies('annhum', ANNHUM);
      await apiStub.stubPhenology('annhum', []);

      const app = new AppPage(page);
      await app.goto('view=detail&detail=annhum');
      await app.waitForAppReady();

      // Heading visible means species data is loaded.
      await expect(
        page.getByRole('heading', { name: "Anna's Hummingbird" }),
      ).toBeVisible({ timeout: 10_000 });

      // Hold for 5 seconds — the URL must never drift.
      await page.waitForTimeout(5_000);

      expect(new URL(page.url()).searchParams.get('view')).toBe('detail');
      expect(new URL(page.url()).searchParams.get('detail')).toBe('annhum');
    });
  });

  test.describe('desktop 1440x900', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('?view=detail URL holds through a delayed data load (t=0, t=350, t=900ms)', async ({
      page,
      apiStub,
    }) => {
      await page.route('**/api/observations**', async route => {
        await new Promise(r => setTimeout(r, 700));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [], meta: { freshestObservationAt: null } }),
        });
      });
      await page.route('**/api/hotspots', async route => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      });
      await page.route('**/api/silhouettes', async route => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      });
      await apiStub.stubSpecies('annhum', ANNHUM);

      const app = new AppPage(page);
      await app.goto('view=detail&detail=annhum');

      // t≈0ms
      expect(new URL(page.url()).searchParams.get('view')).toBe('detail');
      expect(new URL(page.url()).searchParams.get('detail')).toBe('annhum');

      // t≈350ms
      await page.waitForTimeout(350);
      expect(new URL(page.url()).searchParams.get('view')).toBe('detail');
      expect(new URL(page.url()).searchParams.get('detail')).toBe('annhum');

      // After data resolves
      await app.waitForAppReady(10_000);
      expect(new URL(page.url()).searchParams.get('view')).toBe('detail');
      expect(new URL(page.url()).searchParams.get('detail')).toBe('annhum');

      await expect(
        page.getByRole('heading', { name: "Anna's Hummingbird" }),
      ).toBeVisible({ timeout: 5_000 });
    });

    test('?view=detail URL holds for ≥5s with no user interaction', async ({
      page,
      apiStub,
    }) => {
      await apiStub.stubEmpty();
      await apiStub.stubSpecies('annhum', ANNHUM);
      await apiStub.stubPhenology('annhum', []);

      const app = new AppPage(page);
      await app.goto('view=detail&detail=annhum');
      await app.waitForAppReady();

      await expect(
        page.getByRole('heading', { name: "Anna's Hummingbird" }),
      ).toBeVisible({ timeout: 10_000 });

      await page.waitForTimeout(5_000);

      expect(new URL(page.url()).searchParams.get('view')).toBe('detail');
      expect(new URL(page.url()).searchParams.get('detail')).toBe('annhum');
    });
  });

  test.describe('corrupted URL recovery (#511 guard)', () => {
    test('?detail=annhum&view=map (race-produced URL) recovers to detail surface', async ({
      page,
      apiStub,
    }) => {
      // This test exercises the #511 guard directly: a URL where ?detail= is
      // set but ?view=map (default) was written by a race. readUrl must sniff
      // to view=detail rather than landing on the map surface.
      await apiStub.stubEmpty();
      await apiStub.stubSpecies('annhum', ANNHUM);
      await apiStub.stubPhenology('annhum', []);

      const app = new AppPage(page);
      // Navigate to the corrupted URL form — ?detail before ?view, view=map.
      await app.goto('detail=annhum&view=map');
      await app.waitForAppReady();

      // The detail surface must be visible (sniffed to detail, not map).
      await expect(
        page.getByRole('heading', { name: "Anna's Hummingbird" }),
      ).toBeVisible({ timeout: 10_000 });

      // URL must have recovered to view=detail.
      await expect.poll(() => new URL(page.url()).searchParams.get('view'), { timeout: 5_000 })
        .toBe('detail');
      await expect.poll(() => new URL(page.url()).searchParams.get('detail'), { timeout: 5_000 })
        .toBe('annhum');
    });
  });
});

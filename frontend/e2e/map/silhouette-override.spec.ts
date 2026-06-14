import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures.js';
import { AppPage } from '../pages/app-page.js';

/**
 * Issue #502 — admin-api-uploaded silhouette override rendering.
 * Issue #1028 — graceful degradation when the override mask URL fails to load.
 *
 * The FamilyLegend chip prefers `svgUrl` (CDN URL) over inline `svgData`
 * (path-d). When `svgUrl` is set FamilySilhouette renders a CSS-mask
 * `.family-silhouette-img` <span> (the mask paints nothing visible if the
 * URL fails — the #1028 blank-row bug). FamilySilhouette now preloads the
 * mask URL via `new Image()` and, on load failure, falls through to the
 * inline `<svg>` (the curated `svgData` shape, or the FAMILY_PATHS
 * placeholder) so a curated legend row is NEVER painted blank.
 *
 * Both tests drive the legend deterministically by stubbing `/api/observations`
 * with an AGGREGATED response (scope=us cold-load is aggregated, z<6) carrying
 * a single `cuculidae` bucket, and `/api/silhouettes` with a matching
 * `cuculidae` row. No DB writes; no real upload; no seed dependency.
 */

const CUCULIDAE_BUCKET = {
  mode: 'aggregated' as const,
  buckets: [
    {
      lat: 39,
      lng: -98,
      count: 7,
      speciesCount: 2,
      families: [
        {
          code: 'cuculidae',
          count: 7,
          speciesCount: 2,
          species: [
            { code: 'greroa', count: 4 },
            { code: 'yebcuc', count: 3 },
          ],
          name: 'Cuckoos & Roadrunners',
        },
      ],
    },
  ],
  meta: { freshestObservationAt: new Date(Date.now() - 5 * 60 * 1000).toISOString() },
};

async function stubAggregatedCuckoos(page: Page) {
  await page.route('**/api/observations**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(CUCULIDAE_BUCKET),
    });
  });
}

test.describe('Silhouette override (#502 / #1028)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('legend chip renders the mask-div when svgUrl loads successfully', async ({ page }) => {
    // A 1×1 SVG data-URL: `new Image().src = <data-url>` resolves to `onload`
    // in the browser, so the optimistic mask span stays (no fallback).
    const svgDataUrl =
      'data:image/svg+xml;utf8,' +
      encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 12 L22 12 L12 2 Z"/></svg>');

    await stubAggregatedCuckoos(page);
    await page.route('**/api/silhouettes', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            familyCode: 'cuculidae',
            commonName: 'Cuckoos & Roadrunners',
            color: '#A05A3A',
            colorDark: '#C98A6A',
            source: null,
            license: null,
            creator: null,
            // svgData kept non-null so the fallback would reach a real shape too.
            svgData: 'M5 13 L17 7 L17 10 Z',
            svgUrl: svgDataUrl,
          },
        ]),
      });
    });

    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();

    // Desktop default-expanded legend renders the cuculidae chip. Because the
    // mask URL loads, the chip stays in mask-div form. This assertion GATES —
    // the `.catch(() => {})` swallow that previously made it a no-op is gone.
    const maskDiv = page
      .locator('button[data-testid="family-legend-entry"] .family-silhouette-img')
      .first();
    await expect(maskDiv).toBeVisible({ timeout: 10_000 });
  });

  test('legend chip stays visible (falls back to svg) when svgUrl 404s', async ({ page }) => {
    // #1028 root case: a dead/blocked CDN URL. Stub it to 404 so the mask
    // preload fires `onerror` and FamilySilhouette swaps to the inline <svg>.
    const deadUrl = 'https://silhouettes.bird-maps.com/family/cuculidae.dead404.svg';

    await stubAggregatedCuckoos(page);
    await page.route(deadUrl, async route => {
      await route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
    });
    await page.route('**/api/silhouettes', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            familyCode: 'cuculidae',
            commonName: 'Cuckoos & Roadrunners',
            color: '#A05A3A',
            colorDark: '#C98A6A',
            source: null,
            license: null,
            creator: null,
            // Curated svgData (branch a): the fallback reaches the real shape.
            svgData: 'M5 13 L17 7 L17 10 Z',
            svgUrl: deadUrl,
          },
        ]),
      });
    });

    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();

    const chip = page.locator('button[data-testid="family-legend-entry"]').first();
    await expect(chip).toBeVisible({ timeout: 10_000 });

    // The blank mask span must have been replaced by a visible <svg> glyph —
    // the curated svgData path, NOT an empty mask. This is the #1028 fix:
    // a curated legend row never paints blank even when the CDN URL is dead.
    const svgPath = chip.locator('.family-silhouette svg path');
    await expect(svgPath).toBeVisible({ timeout: 10_000 });
    await expect(svgPath).toHaveAttribute('d', 'M5 13 L17 7 L17 10 Z');
    // And the dead mask div must NOT be present (we swapped away from it).
    await expect(chip.locator('.family-silhouette-img')).toHaveCount(0);
  });
});

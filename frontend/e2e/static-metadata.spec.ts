import { test, expect } from '@playwright/test';

/**
 * Static-head / OG metadata regression guard — issue #785.
 *
 * The app is a static SPA with no SSR. Every social unfurl (Slack, iMessage,
 * Twitter/Facebook crawler) and every search-engine snapshot sees only
 * `index.html`'s static `<head>` — never the React-rendered runtime title.
 * `SurfaceTitleSync` owns the *runtime* per-scope `document.title`; this spec
 * guards the *static* metadata attributes that crawlers consume.
 *
 * This is a static-head assertion — we do NOT wait for `waitForMapLoad()`.
 * Per the navigation contract, tests that deliberately skip the map-load wait
 * assert directly on the static head attributes without `app.waitForMapLoad()`.
 * No `page.route` stubs, no DB writes.
 *
 * Regression tripwire: asserts zero "Arizona" substrings in `<head>` to prevent
 * the AZ-freeze from silently re-entering. Any future AZ-specific text in the
 * static head would surface here immediately.
 */

const NATIONAL_DESCRIPTION =
  'Recent bird sightings across the United States, updated in real time from eBird.';

test.describe('static OG/meta head — CONUS national fallback (#785)', () => {
  test('og:title and twitter:title are the bare national title "Bird Maps"', async ({ page }) => {
    await page.goto('/');
    const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content');
    const twitterTitle = await page.locator('meta[name="twitter:title"]').getAttribute('content');
    expect(ogTitle).toBe('Bird Maps');
    expect(twitterTitle).toBe('Bird Maps');
  });

  test('meta[name=description], og:description, and twitter:description all carry the national description (and are equal)', async ({
    page,
  }) => {
    await page.goto('/');
    const metaDesc = await page
      .locator('meta[name="description"]')
      .getAttribute('content');
    const ogDesc = await page
      .locator('meta[property="og:description"]')
      .getAttribute('content');
    const twitterDesc = await page
      .locator('meta[name="twitter:description"]')
      .getAttribute('content');

    expect(metaDesc).toBe(NATIONAL_DESCRIPTION);
    expect(ogDesc).toBe(NATIONAL_DESCRIPTION);
    expect(twitterDesc).toBe(NATIONAL_DESCRIPTION);
    // All three must be equal — ensures no future drift between them.
    expect(metaDesc).toBe(ogDesc);
    expect(metaDesc).toBe(twitterDesc);
  });

  test('JSON-LD Dataset.spatialCoverage is the CONUS envelope', async ({ page }) => {
    await page.goto('/');
    const ldJson = await page.locator('script[type="application/ld+json"]').textContent();
    const data = JSON.parse(ldJson ?? '{}');

    expect(data.mainEntity.spatialCoverage['@type']).toBe('Place');
    expect(data.mainEntity.spatialCoverage.name).toBe('Contiguous United States');
    expect(data.mainEntity.spatialCoverage.geo['@type']).toBe('GeoShape');
    // CONUS bounding box: minLat minLng maxLat maxLng (same ordering as old AZ value)
    expect(data.mainEntity.spatialCoverage.geo.box).toBe('24.5 -124.8 49.4 -66.9');
  });

  test('no static metadata element contains the substring "Arizona" (AZ-freeze regression tripwire)', async ({
    page,
  }) => {
    await page.goto('/');
    // Check only the static metadata elements — not stylesheets injected at runtime
    // by Vite, which may contain "Arizona" in CSS comments unrelated to this fix.
    const metadataStrings = await page.evaluate(() => {
      const selectors = [
        'title',
        'meta[name="description"]',
        'meta[property="og:title"]',
        'meta[property="og:description"]',
        'meta[name="twitter:title"]',
        'meta[name="twitter:description"]',
        'script[type="application/ld+json"]',
      ];
      return selectors.map((sel) => {
        const el = document.head.querySelector(sel);
        if (!el) return '';
        if (el.tagName === 'TITLE') return el.textContent ?? '';
        if (el.tagName === 'SCRIPT') return el.textContent ?? '';
        return el.getAttribute('content') ?? '';
      });
    });
    // None of the static metadata elements should contain "Arizona".
    for (const text of metadataStrings) {
      expect(text.toLowerCase()).not.toContain('arizona');
    }
  });
});

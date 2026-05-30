import { test, expect } from './fixtures.js';
import { AppPage } from './pages/app-page.js';
import type { Observation } from '@bird-watch/shared-types';

/**
 * Regression: collapsed family legend chip clipped by its scroll/overflow parent.
 *
 * PR #471 (W2) added `.map-context-strip { padding: var(--space-md)
 * var(--space-lg) }` (24 px vertical) + a 1px border-bottom. The combined
 * 69.5px chrome pushed `.map-surface { height: 100% }` below the visible
 * area, causing `#main-surface`'s overflow:auto scroll container to clip the
 * `position:absolute; bottom:12px` collapsed chip entirely.
 *
 * #761 (S2) re-baseline: the map left `#main-surface` entirely — the shell
 * inverted so the map is the viewport ROOT (`#map-layer { position: fixed;
 * inset: 0 }`, a sibling of `<main>`). The collapsed chip now lives inside the
 * viewport-filling `.map-surface`, NOT inside `#main-surface`. The clip parent
 * the original #471 guard checked against is gone by design, so this guard now
 * asserts the chip is fully inside the VIEWPORT (the new bounding box). The
 * invariant the test protects is unchanged: the collapsed chip must be fully
 * visible, never clipped by its container.
 *
 * This test is the regression guard #471 should have had.
 *
 * NOTE: This test drives Playwright MCP which requires a running dev server.
 * In CI the `webServer` stanza in playwright.config.ts starts `vite dev`
 * automatically. In local runs start it manually:
 *   npm run dev --workspace @bird-watch/frontend
 *
 * WebGL skip guard: if maplibre `load` never fires (no GPU in headless), the
 * map-surface has no rendered height and the bounding-rect assertion is
 * meaningless. The test skips cleanly in that case, matching the pattern in
 * family-legend-viewport.spec.ts. CI runs on GitHub Actions VMs that expose
 * software WebGL (SwiftShader), so CI exercises the full assertion.
 */

/**
 * Minimal silhouettes payload — one family entry plus the required _FALLBACK
 * row. Enough to make FamilyLegend mount (silhouettes.length > 0 at
 * FamilyLegend.tsx:132). svgData is a valid path so MapCanvas's SDF sprite
 * registration doesn't reject it.
 */
function stubSilhouettes() {
  return [
    {
      familyCode: 'tyrannidae',
      color: '#E84040',
      svgData: 'M5 13 C5 9 9 8 13 9 L17 7 L17 10 L15 11 L15 14 L13 15 L8 15 L5 13 Z',
      source: null,
      license: null,
      commonName: 'Tyrant Flycatchers',
      creator: null,
    },
    {
      familyCode: '_FALLBACK',
      color: '#555555',
      svgData: 'M 6 12 C 6 9 8 7 11 7 C 13 7 14 8 15 9 L 18 8 L 18 10 L 16 11 L 16 14 L 14 16 L 9 16 L 6 14 Z',
      source: null,
      license: null,
      commonName: 'Unknown family',
      creator: null,
    },
  ];
}

/** One observation matching the single stubbed family so the legend mounts with a count. */
function stubObservations(): Observation[] {
  return [
    {
      subId: 'S12345678',
      speciesCode: 'vermfly',
      comName: 'Vermilion Flycatcher',
      familyCode: 'tyrannidae',
      lat: 32.2217,
      lng: -110.9265,
      locId: 'L123456',
      locName: 'Tucson, AZ',
      obsDt: '2026-05-01',
      howMany: 1,
      isNotable: false,
      silhouetteId: null,
    },
  ];
}

/**
 * Register API stubs in LIFO-safe order: stubEmpty first (catch-all [] for
 * hotspots + observations + silhouettes), then the more-specific handlers
 * for observations and silhouettes win because Playwright routes are LIFO.
 *
 * Mirrors the setupRoutes pattern in family-legend-viewport.spec.ts:154-171.
 */
async function setupRoutes(
  page: import('@playwright/test').Page,
  apiStub: import('./fixtures.js').ApiStub,
): Promise<void> {
  await apiStub.stubEmpty();
  await apiStub.stubObservations(stubObservations());
  await page.route('**/api/silhouettes', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(stubSilhouettes()),
    });
  });
}

/**
 * WebGL skip guard. The map-canvas wrapper always mounts (it's a plain div),
 * but maplibre only fires `load` and exposes `window.__birdMap` once the GL
 * context is live. When the hook is absent the map-surface has no rendered
 * height, so the bounding-rect check would be vacuous. Skip cleanly.
 *
 * Copied verbatim from family-legend-viewport.spec.ts:112-132.
 */
async function skipIfMapHookAbsent(
  page: import('@playwright/test').Page,
  testRef: typeof test,
): Promise<boolean> {
  const present = await page
    .waitForFunction(
      () => typeof (window as { __birdMap?: unknown }).__birdMap !== 'undefined',
      { timeout: 8_000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!present) {
    testRef.skip(
      true,
      'window.__birdMap not exposed — maplibre `load` did not fire ' +
        '(likely WebGL unavailable in headless run).',
    );
  }
  return !present;
}

/**
 * Assert that the collapsed chip's bounding rect is fully inside the VIEWPORT.
 *
 * #761 (S2): the map is now the viewport ROOT (`#map-layer { position: fixed;
 * inset: 0 }`), so the chip's containing/clip parent is the viewport, not
 * `#main-surface` (which the map left). Both edges (bottom and left) are checked
 * to within a 1px tolerance (fractional sub-pixel rounding).
 */
async function assertChipInsideViewport(
  page: import('@playwright/test').Page,
): Promise<{ chipBottom: number; viewportBottom: number; chipLeft: number; viewportLeft: number }> {
  const rects = await page.evaluate(() => {
    // The collapsed chip is the toggle button with aria-expanded="false" inside .map-surface
    const chip = document.querySelector<HTMLElement>(
      '.map-surface button[aria-expanded="false"]',
    );
    if (!chip) return null;
    const chipRect = chip.getBoundingClientRect();
    return {
      chipBottom: chipRect.bottom,
      // #761 (S2): the map fills the viewport, so the bottom/left bound is the
      // viewport edge (the map left #main-surface — the old clip parent is gone).
      viewportBottom: window.innerHeight,
      chipLeft: chipRect.left,
      viewportLeft: 0,
    };
  });

  expect(rects, 'collapsed chip button not found in DOM').not.toBeNull();
  const { chipBottom, viewportBottom, chipLeft, viewportLeft } = rects!;

  // Chip bottom edge must be at or above the viewport bottom (allow 1px sub-pixel rounding)
  expect(
    chipBottom,
    `Collapsed chip bottom (${chipBottom.toFixed(1)}) is BELOW viewport bottom (${viewportBottom.toFixed(1)}) — chip is clipped`,
  ).toBeLessThanOrEqual(viewportBottom + 1);

  // Chip left edge must be at or right of the viewport left edge
  expect(
    chipLeft,
    `Collapsed chip left (${chipLeft.toFixed(1)}) is LEFT OF viewport left (${viewportLeft.toFixed(1)}) — chip is clipped`,
  ).toBeGreaterThanOrEqual(viewportLeft - 1);

  return { chipBottom, viewportBottom, chipLeft, viewportLeft };
}

test.describe('Collapsed legend chip visibility — P0 regression from #471', () => {
  test.describe('desktop (1440×900)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('collapsed chip is fully inside the viewport bounds', async ({ page, apiStub }) => {
      await setupRoutes(page, apiStub);
      const app = new AppPage(page);
      // Clear localStorage so we get the default expanded state, then collapse
      await page.addInitScript(() => {
        try {
          window.localStorage.removeItem('family-legend-expanded');
          window.localStorage.removeItem('family-legend-expanded.v2');
        } catch { /* noop */ }
      });
      await app.goto('view=map');
      await app.waitForAppReady();
      await expect(page.locator('[data-testid=map-canvas]')).toBeVisible({ timeout: 15_000 });

      if (await skipIfMapHookAbsent(page, test)) return;

      // Collapse the legend via the toggle button
      const toggle = page.getByRole('button', { name: /bird families/i });
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');

      // Assert chip is inside the viewport bounds (#761 S2: the map fills the viewport)
      const { chipBottom, viewportBottom } = await assertChipInsideViewport(page);
      // Provide readable context in the test output
      expect(
        chipBottom <= viewportBottom + 1,
        `Desktop: chip bottom ${chipBottom.toFixed(1)} <= viewport bottom ${viewportBottom.toFixed(1)}`,
      ).toBe(true);
    });
  });

  test.describe('mobile (390×844)', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('collapsed chip is fully inside the viewport bounds', async ({ page, apiStub }) => {
      await setupRoutes(page, apiStub);
      const app = new AppPage(page);
      // Mobile defaults to collapsed — clear localStorage and let the
      // viewport-driven default apply.
      await page.addInitScript(() => {
        try {
          window.localStorage.removeItem('family-legend-expanded');
          window.localStorage.removeItem('family-legend-expanded.v2');
        } catch { /* noop */ }
      });
      await app.goto('view=map');
      await app.waitForAppReady();
      await expect(page.locator('[data-testid=map-canvas]')).toBeVisible({ timeout: 15_000 });

      if (await skipIfMapHookAbsent(page, test)) return;

      // On mobile the legend starts collapsed — no click needed
      const toggle = page.getByRole('button', { name: /bird families/i });
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');

      // Assert chip is inside the viewport bounds (#761 S2: the map fills the viewport)
      const { chipBottom, viewportBottom } = await assertChipInsideViewport(page);
      expect(
        chipBottom <= viewportBottom + 1,
        `Mobile: chip bottom ${chipBottom.toFixed(1)} <= viewport bottom ${viewportBottom.toFixed(1)}`,
      ).toBe(true);
    });
  });
});

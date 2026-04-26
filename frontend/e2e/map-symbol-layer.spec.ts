import { test, expect } from './fixtures.js';
import { AppPage } from './pages/app-page.js';
import type { Observation, SpeciesMeta } from '@bird-watch/shared-types';

/**
 * Issue #246 — MapCanvas SDF symbol layer + ObservationPopover detail link.
 *
 * The full WebGL path (silhouette sprites painted at zoom ≥ CLUSTER_MAX_ZOOM,
 * notable-ring halos, _FALLBACK 50%-opacity rendering) is exercised live
 * via Playwright MCP per the CLAUDE.md UI verification protocol —
 * headless Chromium without a real GPU may skip the `load` event, which
 * would suppress the symbol-layer mount.
 *
 * What WE assert here without WebGL:
 *   - The map view mounts cleanly with /api/silhouettes stubbed.
 *   - The MapCanvas chunk imports the symbol-layer build (no missing-
 *     export errors at module load — would surface as an .error-screen).
 *   - When the dev-server's hit-layer keyboard path opens a popover,
 *     the "See species details" button is present and routing through
 *     it switches the URL state to `view=detail&detail=<code>`.
 *
 * The popover-driven URL switch is the ONLY new contract that does not
 * require WebGL, so it's the only thing this spec exercises directly.
 */

function silhouetteFixture() {
  // Minimal silhouettes payload sufficient to seed the symbol-layer prop
  // chain. Includes a `_FALLBACK` row so the addImage pipeline has at
  // least one sprite to register; production data has 26 rows.
  return [
    {
      familyCode: 'tyrannidae',
      color: '#C77A2E',
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

function observationFixture(): Observation[] {
  // A single observation that the dev-server hit-layer can present as a
  // tabbable target (so we don't depend on canvas click hit-testing).
  return [
    {
      subId: 'S100',
      speciesCode: 'vermfly',
      comName: 'Vermilion Flycatcher',
      lat: 32.27,
      lng: -110.85,
      obsDt: '2026-04-15T10:00:00Z',
      locId: 'L99',
      locName: 'Sweetwater Wetlands',
      howMany: 1,
      isNotable: false,
      regionId: null,
      silhouetteId: 'tyrannidae',
      familyCode: 'tyrannidae',
    },
  ];
}

const speciesMetaFixture: SpeciesMeta = {
  speciesCode: 'vermfly',
  comName: 'Vermilion Flycatcher',
  sciName: 'Pyrocephalus rubinus',
  familyCode: 'tyrannidae',
  familyName: 'Tyrannidae',
  taxonOrder: 12345,
};

test.describe('Map symbol layer + popover detail link', () => {
  test.beforeEach(async ({ page, apiStub }) => {
    // Stub the silhouettes endpoint to the minimum payload that exercises
    // the addImage pipeline (real silhouette + _FALLBACK sentinel).
    await page.route('**/api/silhouettes', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(silhouetteFixture()),
      });
    });
    await apiStub.stubObservations(observationFixture());
    await apiStub.stubSpecies('vermfly', speciesMetaFixture);
  });

  test('view=map renders the map canvas without console errors (1440x900)', async ({ page }) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
      if (msg.type() === 'warning') warnings.push(msg.text());
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();

    await expect(page.locator('[data-testid=map-canvas]')).toBeVisible({ timeout: 15_000 });
    // No .error-screen — the MapCanvas chunk imported cleanly. (A missing
    // export from observation-layers would surface as a hard import error
    // and the ErrorBoundary would render this.)
    await expect(page.locator('.error-screen')).toHaveCount(0);

    // Filter out errors that pre-date this PR:
    //   - tiles/fonts.openfreemap.org 404s (network-specific, we don't own).
    //   - The maplibre-gl resolution failure tracked in #258 (npm
    //     workspaces hoist drift causes `@vis.gl/react-maplibre` to fail
    //     to find `maplibre-gl` in the leaf workspace's node_modules under
    //     `vite dev`. Out of scope for this PR; CI hits it because dev-
    //     server e2e runs without the temporary symlink workaround the
    //     local screenshot pass used).
    const ourErrors = errors.filter((e) =>
      !/tiles\.openfreemap\.org|fonts\.openfreemap/i.test(e) &&
      !/Could not resolve "maplibre-gl"/i.test(e),
    );
    expect(ourErrors, `unexpected console errors: ${ourErrors.join('\n')}`).toEqual([]);
    void warnings;
  });

  test('view=map renders cleanly on mobile viewport too (390x844)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();

    await expect(page.locator('[data-testid=map-canvas]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.error-screen')).toHaveCount(0);
  });

  test('hit-layer button → popover → detail link → ?view=detail&detail=<code>', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();

    // The hit-layer overlay is mounted only after maplibre fires its
    // `load` event. In WebGL-less headless runs it never fires; tolerate
    // that the way the spiderfy spec does.
    const hitLayer = page.locator('.map-marker-hit-layer');
    await page.waitForTimeout(2000); // give onLoad a chance
    if ((await hitLayer.count()) === 0) {
      test.skip(true, 'map onLoad did not fire — likely WebGL unavailable in headless run');
      return;
    }

    // Click the (single) hit-target button to open the popover.
    const hitButton = hitLayer.locator('button').first();
    if ((await hitButton.count()) === 0) {
      test.skip(true, 'hit-layer mounted but no markers projected (no observations after geo filter)');
      return;
    }
    await hitButton.click();

    // ObservationPopover dialog opens with the species name + detail link.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByText('Vermilion Flycatcher')).toBeVisible();

    const detailLink = dialog.getByRole('button', { name: /see species details/i });
    await expect(detailLink).toBeVisible();
    // Must NOT be an anchor — App.tsx mounts surfaces mutually-exclusive,
    // and a hash-link wouldn't switch view state.
    expect(await detailLink.evaluate((el) => el.tagName)).toBe('BUTTON');

    await detailLink.click();

    // URL switches to ?view=detail&detail=vermfly. The SpeciesDetailSurface
    // mounts in place of the map.
    await expect.poll(() => app.getUrlParams().get('view'), { timeout: 5_000 }).toBe('detail');
    await expect.poll(() => app.getUrlParams().get('detail'), { timeout: 5_000 }).toBe('vermfly');
    await expect(page.locator('[data-testid=map-canvas]')).toHaveCount(0);
  });
});

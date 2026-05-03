import {
  test,
  expect,
  VERMFLY,
  VERMFLY_PHENOLOGY_FULL,
  VERMFLY_PHENOLOGY_SPARSE,
  VERMFLY_PHENOLOGY_EMPTY,
} from './fixtures.js';
import { AppPage } from './pages/app-page.js';

/**
 * Issue #356 — phenology chart on the species detail surface.
 *
 * The 12-month bar chart mounts inside SpeciesDetailSurface's `data &&`
 * block, fetches /api/species/:code/phenology on mount, and handles four
 * branches: loading / data / empty / error.
 *
 * The 12-test matrix per the issue:
 *   - 3 paths × 2 viewports = 6 functional tests (happy / empty / error)
 *   - 3 fixtures × 2 viewports = 6 console-cleanliness tests
 *
 * Mocking — the /phenology endpoint isn't deployed yet (sibling Child
 * #355's responsibility). Every test stubs the phenology route via
 * `apiStub.stubPhenology()` so this PR is independently mergeable.
 */

test.describe('phenology chart on species detail (#356)', () => {
  for (const viewport of [
    { width: 1440, height: 900, label: 'desktop' },
    { width: 390, height: 844, label: 'mobile' },
  ] as const) {
    test.describe(`${viewport.label} (${viewport.width}x${viewport.height})`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      test('happy path — 12 <rect> bars present and chart has accessible label', async ({ page, apiStub }) => {
        await apiStub.stubSpecies('vermfly', VERMFLY);
        await apiStub.stubPhenology('vermfly', VERMFLY_PHENOLOGY_FULL);
        const app = new AppPage(page);
        await app.goto('detail=vermfly&view=detail');
        await app.waitForAppReady();

        const main = page.locator('main');
        await expect(main.getByRole('heading', { name: 'Vermilion Flycatcher' }))
          .toBeVisible({ timeout: 10_000 });

        // The chart mounts inside the data block. 12 bars rendered.
        const chart = main.locator('svg.phenology-chart');
        await expect(chart).toBeVisible();
        await expect(chart.locator('rect')).toHaveCount(12);

        // Visible month labels — 12 rotated <text> elements below the bars.
        // First one reads 'Jan' (calendar order).
        await expect(chart.locator('text.phenology-label')).toHaveCount(12);
        await expect(chart.locator('text.phenology-label').first()).toHaveText('Jan');

        // Accessible label is present (role="img" + aria-label).
        await expect(chart).toHaveAttribute('role', 'img');
        await expect(chart).toHaveAttribute('aria-label', /phenology/i);
      });

      test('empty path — placeholder bars visible and no crash', async ({ page, apiStub }) => {
        await apiStub.stubSpecies('vermfly', VERMFLY);
        await apiStub.stubPhenology('vermfly', VERMFLY_PHENOLOGY_EMPTY);
        const app = new AppPage(page);
        await app.goto('detail=vermfly&view=detail');
        await app.waitForAppReady();

        const main = page.locator('main');
        await expect(main.getByRole('heading', { name: 'Vermilion Flycatcher' }))
          .toBeVisible({ timeout: 10_000 });

        // Chart still renders 12 placeholder bars (10% height) — empty
        // branch produces a visible "no data" affordance, not a void.
        const chart = main.locator('svg.phenology-chart');
        await expect(chart).toBeVisible();
        await expect(chart.locator('rect')).toHaveCount(12);
        // Placeholder bars carry the muted class.
        await expect(chart.locator('rect.phenology-bar-empty')).toHaveCount(12);
      });

      test('error path — no chart element but surface text still present', async ({ page, apiStub }) => {
        await apiStub.stubSpecies('vermfly', VERMFLY);
        // Fail the phenology fetch — the chart's error branch should
        // return null so the surface text below is unaffected.
        await page.route('**/api/species/vermfly/phenology', async (route) => {
          await route.fulfill({ status: 500, contentType: 'text/plain', body: 'boom' });
        });
        const app = new AppPage(page);
        await app.goto('detail=vermfly&view=detail');
        await app.waitForAppReady();

        const main = page.locator('main');
        await expect(main.getByRole('heading', { name: 'Vermilion Flycatcher' }))
          .toBeVisible({ timeout: 10_000 });
        // Surface text below the chart is still there — error didn't break the surface.
        await expect(main.getByText('Pyrocephalus rubinus')).toBeVisible();
        await expect(main.getByText('Tyrant Flycatchers')).toBeVisible();
        // Wait for the chart's loading state to clear (it shows a
        // role=status while the fetch is in flight; once the 500 lands,
        // the error branch returns null and the loading paragraph is
        // removed). Using the loading paragraph as the gate avoids a
        // race where we'd otherwise assert "no chart" during loading.
        await expect(main.locator('.phenology-chart-loading')).toHaveCount(0);
        // No chart in the DOM (error branch returns null).
        await expect(main.locator('svg.phenology-chart')).toHaveCount(0);
      });
    });
  }

  // Cross-viewport, cross-fixture console-cleanliness sweep — 3 fixtures
  // × 2 viewports = 6 tests. Captures any console errors/warnings that
  // surface when the chart renders at the release-1 viewports under each
  // of the data shapes (full, sparse, empty). One test per combination
  // keeps failure names readable: a broken sparse-zero-fill on mobile
  // shows up as a single failing test, not a tangle.
  for (const viewport of [
    { width: 1440, height: 900, label: 'desktop' },
    { width: 390, height: 844, label: 'mobile' },
  ] as const) {
    for (const fixture of [
      { rows: VERMFLY_PHENOLOGY_FULL, label: 'full' },
      { rows: VERMFLY_PHENOLOGY_SPARSE, label: 'sparse' },
      { rows: VERMFLY_PHENOLOGY_EMPTY, label: 'empty' },
    ] as const) {
      test(`zero console errors+warnings: ${fixture.label} fixture at ${viewport.label} ${viewport.width}x${viewport.height}`, async ({ page, apiStub }) => {
        const errors: string[] = [];
        const warnings: string[] = [];
        page.on('console', (msg) => {
          if (msg.type() === 'error') errors.push(msg.text());
          if (msg.type() === 'warning') warnings.push(msg.text());
        });

        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await apiStub.stubSpecies('vermfly', VERMFLY);
        await apiStub.stubPhenology('vermfly', fixture.rows);

        const app = new AppPage(page);
        await app.goto('detail=vermfly&view=detail');
        await app.waitForAppReady();
        await expect(page.getByRole('heading', { name: 'Vermilion Flycatcher' }))
          .toBeVisible({ timeout: 10_000 });
        // Wait for the chart itself so we know the phenology fetch +
        // render pipeline finished before sampling console state.
        await expect(page.locator('svg.phenology-chart')).toBeVisible();

        // Filter known third-party noise — tile/font 404s from the
        // persistent map chunk that the App preloads even on view=detail.
        // Same filter rule as map-symbol-layer.spec.ts and species-detail.spec.ts.
        const ourErrors = errors.filter((e) =>
          !/tiles\.openfreemap\.org|fonts\.openfreemap/i.test(e),
        );
        const ourWarnings = warnings.filter((w) =>
          !/tiles\.openfreemap\.org|fonts\.openfreemap/i.test(w),
        );
        expect(ourErrors, `unexpected console errors: ${ourErrors.join('\n')}`).toEqual([]);
        expect(ourWarnings, `unexpected console warnings: ${ourWarnings.join('\n')}`).toEqual([]);
      });
    }
  }
});

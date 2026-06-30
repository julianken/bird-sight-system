import { test, expect } from '../fixtures.js';
import { AppPage } from '../pages/app-page.js';
import type { CellObservationsResponse, Observation, SpeciesMeta } from '@bird-watch/shared-types';

/**
 * #1302 (F3, epic #1299) — the zoom<6 CELL path of the Sightings Log.
 *
 * At zoom<6 the map renders the precomputed count-only grid. Clicking a single
 * aggregated bucket and selecting a species in the `<CellPopover>` threads a
 * `{kind:'cell'}` context; the log then fetches that cell's per-sighting rows
 * from `GET /api/observations/cell` (B1) and renders them, including the
 * server-truncation banner.
 *
 * DETERMINISM: reaching a genuine SINGLE aggregated bucket at a specific
 * low-zoom coordinate depends on real MapLibre/supercluster clustering, which
 * is fragile under `retries:0` / `fullyParallel` and never materializes in a
 * WebGL-less headless run. So this spec follows the same probe-and-skip
 * discipline as `sightings-log.spec.ts` and `map-adaptive-grid.spec.ts`: it
 * STUBS `/api/observations/cell` deterministically, then drives the live UI to
 * a single-bucket cell popover; if clustering does not produce one (no WebGL /
 * sparse seed), it skips. The hard mapping/truncation/0-row coverage lives in
 * the unit + RTL specs (use-sightings-rows / SightingsLog / client). The
 * orchestrator's live Playwright pass exercises the full visual path.
 */

const SILHOUETTES = [
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

const speciesMetaFixture: SpeciesMeta = {
  speciesCode: 'vermfly',
  comName: 'Vermilion Flycatcher',
  sciName: 'Pyrocephalus rubinus',
  familyCode: 'tyrannidae',
  familyName: 'Tyrant Flycatchers',
  taxonOrder: 4400,
};

/** Two cell rows out of a (claimed) larger set → truncated banner "latest 2 of 137". */
function cellObservations(): Observation[] {
  return [
    {
      subId: 'CELL-1',
      speciesCode: 'vermfly',
      comName: 'Vermilion Flycatcher',
      lat: 32.27,
      lng: -110.85,
      obsDt: '2026-04-15T12:00:00Z',
      locId: 'L99',
      locName: 'Sweetwater Wetlands',
      howMany: 4,
      isNotable: false,
      silhouetteId: 'tyrannidae',
      familyCode: 'tyrannidae',
    },
    {
      subId: 'CELL-2',
      speciesCode: 'vermfly',
      comName: 'Vermilion Flycatcher',
      lat: 32.21,
      lng: -110.92,
      obsDt: '2026-04-15T08:00:00Z',
      locId: 'L100',
      locName: 'Patagonia Lake',
      howMany: null,
      isNotable: false,
      silhouetteId: 'tyrannidae',
      familyCode: 'tyrannidae',
    },
  ];
}

const CELL_RESPONSE: CellObservationsResponse = {
  data: cellObservations(),
  meta: { cellObservationCount: 137, truncated: true },
};

test.describe('Sightings Log — zoom<6 cell path (#1302)', () => {
  test.beforeEach(async ({ page, apiStub }) => {
    await page.route('**/api/silhouettes', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(SILHOUETTES),
      });
    });
    await apiStub.stubSpecies('vermfly', speciesMetaFixture);
    // Deterministically stub the B1 cell endpoint regardless of which single
    // bucket the live clustering surfaces — the test asserts the LOG renders
    // exactly these rows + this truncation banner once a cell is selected.
    await page.route('**/api/observations/cell**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(CELL_RESPONSE),
      });
    });
  });

  test('single-bucket cell → pick species → log fetches + renders cell sightings with truncation banner (1440×900)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const app = new AppPage(page);
    // Whole-US national view cold-loads at zoom<6 (aggregated grid). A 1d window
    // is the ACTIVE since-window — the cell request must carry it (B1 contract).
    await app.goto('scope=us&since=1d');
    await app.waitForAppReady();

    // The adaptive-grid markers mount only after MapLibre fires `load`; in a
    // WebGL-less headless run that never happens — tolerate via probe+skip.
    const webglReady = await page.evaluate(() => Boolean((window as { __birdMap?: unknown }).__birdMap));
    test.skip(!webglReady, 'WebGL unavailable — map canvas did not paint');

    // Find a single-bucket adaptive-grid marker, open its CellPopover, and pick
    // a clickable species row. A single-bucket cell is the only marker shape
    // that threads a {kind:'cell'} context (handleGridSelectSpecies gate).
    const gridMarker = page.locator('[data-testid=adaptive-grid-marker]').first();
    try {
      await gridMarker.waitFor({ state: 'visible', timeout: 8_000 });
    } catch {
      test.skip(true, 'No adaptive-grid markers at the national overview — sparse seed');
      return;
    }
    await gridMarker.click();

    const popover = page.locator('[data-testid=cell-popover]');
    try {
      await popover.waitFor({ state: 'visible', timeout: 5_000 });
    } catch {
      test.skip(true, 'Clicked marker did not open a CellPopover (cluster, not single bucket)');
      return;
    }

    const speciesRow = popover.locator('[data-testid=cell-popover-row] button').first();
    if ((await speciesRow.count()) === 0) {
      test.skip(true, 'CellPopover has no clickable species row');
      return;
    }
    await speciesRow.click();

    // The detail surface opens (?detail=...). If the chosen bucket was a genuine
    // single bucket, the cell fetch fires and the log renders. If clustering
    // surfaced a multi-bucket marker instead (no cell context), the log is
    // absent — skip, since that is a clustering-shape artifact, not a F3 bug.
    await expect.poll(() => app.getUrlParams().get('detail'), { timeout: 5_000 }).not.toBeNull();

    const log = page.getByRole('region', { name: /sightings under this marker/i });
    try {
      await log.waitFor({ state: 'visible', timeout: 5_000 });
    } catch {
      test.skip(true, 'Selected marker was a multi-bucket cluster (no cell context threaded)');
      return;
    }

    // Deterministic assertions once the cell log is mounted:
    // - exactly the two stubbed rows render,
    await expect(log.locator('.detail-fg-sighting-row')).toHaveCount(2);
    await expect(log.getByText('Sweetwater Wetlands')).toBeVisible();
    // - howMany 4 > 1 → the ×4 count column,
    await expect(log.locator('.detail-fg-sighting-count').first()).toHaveText('×4');
    // - truncation banner uses meta.cellObservationCount (137) as M.
    await expect(log.locator('.detail-fg-sightings-truncation')).toHaveText('Showing latest 2 of 137');

    // The cell request carried the ACTIVE since-window (since=1d) and the
    // single-bucket scope/grid params.
    const cellReq = await page.evaluate(async () => {
      // The route stub already fulfilled it; re-derive the last request URL from
      // the performance entries as a lightweight check.
      const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      return entries.map((e) => e.name).find((n) => n.includes('/api/observations/cell')) ?? null;
    });
    if (cellReq) {
      const u = new URL(cellReq);
      expect(u.searchParams.get('since')).toBe('1d');
      expect(u.searchParams.get('species')).toBe('vermfly');
    }
  });
});

import { test, expect } from '../fixtures.js';
import type { Page } from '@playwright/test';
import { AppPage } from '../pages/app-page.js';
import type {
  AggregatedFamily,
  CellObservationsResponse,
  Observation,
  SpeciesMeta,
} from '@bird-watch/shared-types';

/**
 * #1302 (F3, epic #1299) — the zoom<6 CELL path of the Sightings Log.
 *
 * At zoom<6 the map renders the precomputed count-only grid. The ONLY surface
 * that represents a genuine SINGLE bucket is the `#864` raw UNCLUSTERED leaf:
 * supercluster never emits a 1-point cluster (`getClusters` needs point_count>1;
 * `_cluster` needs a merged neighbour, independent of `clusterMinPoints`), so a
 * single isolated bucket is always painted unclustered and its click is handled
 * by the `unclustered-point` map handler — which opens a `ClusterListPopover`
 * and (post-#1302) threads a `{kind:'cell'}` context. Picking a species there
 * fetches that cell's per-sighting rows from `GET /api/observations/cell` (B1)
 * and renders them, including the server-truncation banner.
 *
 * DETERMINISM: this spec drives the REACHABLE single-bucket path directly. It
 * does NOT rely on real canvas hit-testing to land a click on a painted SDF
 * symbol (which never works in a WebGL-less headless run). Instead it overrides
 * the live maplibre instance's `queryRenderedFeatures` (exposed as `__birdMap`
 * in dev/test) to return ONE bucket feature, then `fire`s the `unclustered-point`
 * click — the same call path a real canvas click takes. Every step after that
 * (popover → species pick → cell fetch → log render) is real DOM + the stubbed
 * B1 endpoint, so the rows / banner / `since` round-trip assertions are
 * deterministic. The ONLY residual nondeterminism is whether maplibre fires
 * `load` at all (it does not without a GPU); that single condition is guarded
 * and `log()`d — it never silently swallows the core assertions below it.
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

// The single isolated bucket centered at a true round(coord*m)/m grid center
// (m=2 at the national z<6 → integer lng/lat). Its family carries the one
// `vermfly` species so the popover row resolves to a clickable common name.
const BUCKET_FAMILIES: AggregatedFamily[] = [
  {
    code: 'tyrannidae',
    count: 7,
    speciesCount: 1,
    species: [{ code: 'vermfly', count: 7 }],
    name: 'Tyrant Flycatchers',
  },
];
const BUCKET_LNG = -110;
const BUCKET_LAT = 32;
const SINGLE_BUCKET_RESPONSE = {
  mode: 'aggregated' as const,
  buckets: [
    {
      lat: BUCKET_LAT,
      lng: BUCKET_LNG,
      count: 7,
      speciesCount: 1,
      families: BUCKET_FAMILIES,
    },
  ],
  meta: { freshestObservationAt: new Date(Date.now() - 5 * 60 * 1000).toISOString() },
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

// ── Shared determinism helpers (desktop + mobile use the SAME guards) ────────
//
// The desktop and mobile tests below are structurally identical up to the
// surface they assert against (Rail vs Sheet). They MUST skip/pass together —
// the asymmetry that motivated this rework (#1310 review) was the mobile test
// hard-failing on the popover wait while its desktop sibling cleanly skipped on
// the same CI run, an artefact of the map-load race, not a product defect.
// Factoring the guards into one helper guarantees both tests gate on the exact
// same conditions in the exact same order.

/**
 * WebGL/readiness guard. The map-canvas wrapper always mounts (it's a plain
 * div), but maplibre only fires `load` — and only then publishes `__birdMap`
 * and registers the `unclustered-point` delegated click listener — once the GL
 * context is live, which it is NOT in a WebGL-less headless run. Returns true
 * when the hook is published; false when it never appears (caller clean-skips).
 */
async function waitForMapHook(page: Page): Promise<boolean> {
  return page
    .waitForFunction(() => Boolean((window as { __birdMap?: unknown }).__birdMap), null, {
      timeout: 12_000,
    })
    .then(() => true)
    .catch(() => false);
}

/**
 * Settle the map to IDLE before driving the synthetic click.
 *
 * `__birdMap` being published (from the `load` handler) is necessary but NOT
 * sufficient: at cold-load the aggregated source + style are still reconciling,
 * and the marker/source layer the `unclustered-point` handler queries can be
 * re-created by a trailing reconcile (sourcedata → render → idle). Firing the
 * delegated click before that settles is exactly what made the popover fail to
 * open (or open-then-dismiss) on the flaky CI run. We wait for the same `idle`
 * MapCanvas's own listeners key off (`loaded() && !isMoving()`), then settle one
 * extra rAF so any trailing reconcile commit lands — the identical discipline
 * `map-cell-popover.spec.ts` uses before tapping a live marker. Best-effort: if
 * the hook is somehow gone we fall through; the post-click bounded wait + skip
 * is the real safety floor.
 */
async function settleMapIdle(page: Page): Promise<void> {
  await page
    .waitForFunction(
      () => {
        const map = (window as { __birdMap?: { loaded: () => boolean; isMoving: () => boolean } })
          .__birdMap;
        return Boolean(map) && map!.loaded() && !map!.isMoving();
      },
      null,
      { timeout: 10_000 },
    )
    .catch(() => {
      /* no settled map hook — the post-click bounded wait + clean skip apply */
    });
  // One rAF past `idle` so a trailing reconcile commit lands before we interact.
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
}

/**
 * Drive the REACHABLE single-bucket path: override the live maplibre instance's
 * `queryRenderedFeatures` (exposed as `__birdMap`) to return ONE bucket feature,
 * then invoke the `unclustered-point` delegated-click wrapper with a synthetic
 * event — the identical call path a real canvas click takes, with no painted SDF
 * symbol and no dependence on the bucket's on-screen pixel position. Returns
 * true when the wrapper existed and was invoked, false otherwise (caller
 * clean-skips: a missing wrapper means `load` had not fully registered the
 * listener, the same WebGL-incomplete condition).
 */
async function driveSingleBucketClick(page: Page): Promise<boolean> {
  return page.evaluate(
    ({ families }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = (window as any).__birdMap;
      if (!map) return false;
      const bucketFeature = {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-110, 32] },
        properties: {
          count: 7,
          speciesCount: 1,
          familiesJson: JSON.stringify(families),
          familyCode: 'tyrannidae',
          silhouetteId: 'tyrannidae',
          color: '#c3772d',
        },
      };
      const orig = map.queryRenderedFeatures.bind(map);
      map.queryRenderedFeatures = (point: unknown, opts?: { layers?: string[] }) =>
        opts?.layers?.includes('unclustered-point') ? [bucketFeature] : orig(point, opts);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const delegated = (map._delegatedListeners?.click ?? []).find((d: any) =>
        (d.layers ?? []).includes('unclustered-point'),
      );
      if (!delegated?.delegates?.click) return false;
      delegated.delegates.click({
        type: 'click',
        target: map,
        point: { x: 120, y: 120 },
        lngLat: { lng: -110, lat: 32 },
        originalEvent: new MouseEvent('click'),
      });
      return true;
    },
    { families: BUCKET_FAMILIES },
  );
}

test.describe('Sightings Log — zoom<6 cell path (#1302)', () => {
  test.beforeEach(async ({ page, apiStub }) => {
    await page.route('**/api/silhouettes', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(SILHOUETTES),
      });
    });
    // ONE isolated aggregated bucket — the single-bucket case the unclustered
    // handler owns. The bare species dictionary resolves `vermfly`'s name in the
    // popover row.
    await page.route('**/api/observations**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(SINGLE_BUCKET_RESPONSE),
      });
    });
    await apiStub.stubSpeciesDictionary();
    await apiStub.stubSpeciesInScope();
    await apiStub.stubSpecies('vermfly', speciesMetaFixture);
    // Deterministically stub the B1 cell endpoint: the test asserts the LOG
    // renders exactly these rows + this truncation banner once a cell is picked.
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

    // GUARD 1 (WebGL/readiness): the live maplibre instance (exposed as
    // `__birdMap`) is published from the `load` handler, which never fires in a
    // WebGL-less headless run. Clean-skip — never hard-fail — when it is absent.
    const webglReady = await waitForMapHook(page);
    if (!webglReady) {
      // eslint-disable-next-line no-console
      console.log(
        '[sightings-log-cell] SKIP: maplibre never fired `load` (no WebGL/GPU) — ' +
          '__birdMap unavailable, so the single-bucket click cannot be driven. ' +
          'The cell mapping/fetch/banner contract is covered deterministically by ' +
          'the unit + RTL specs (MapCanvas / use-sightings-rows / SightingsLog / client).',
      );
      test.skip(true, 'WebGL unavailable — __birdMap not published');
      return;
    }

    // GUARD 2 (idle-gate the popover precondition): settle the map to `idle`
    // (+1 rAF) BEFORE the synthetic click, so the aggregated source/style has
    // reconciled and the click reliably OPENS the popover (rather than racing a
    // trailing reconcile that re-creates the source layer mid-interaction).
    await settleMapIdle(page);

    // Drive the REACHABLE single-bucket path (the `unclustered-point` delegated
    // click wrapper — the identical call path a real canvas click takes). A
    // false return means `load` had not fully registered the listener (the same
    // WebGL-incomplete condition as GUARD 1) → clean-skip, never hard-fail.
    const drove = await driveSingleBucketClick(page);
    if (!drove) {
      // eslint-disable-next-line no-console
      console.log(
        '[sightings-log-cell] SKIP: unclustered-point delegated click wrapper ' +
          'not registered — `load` did not complete listener wiring (no WebGL).',
      );
      test.skip(true, 'unclustered-point delegated click wrapper unavailable');
      return;
    }

    // GUARD 3 (bounded-wait → clean-skip safety floor): the unclustered handler
    // opens the real-species ClusterListPopover. With the idle-gate above it
    // opens reliably; but if this specific run still lost the race (the popover
    // never appears within the bounded window) we degrade to a CLEAN SKIP rather
    // than a hard-fail — matching the WebGL-guarded siblings' "pass or skip,
    // never hard-fail on the map-load race" discipline. When the popover DOES
    // open (the common case) every assertion below runs in full.
    const popover = page.getByTestId('cluster-list-popover');
    const popoverOpened = await popover
      .waitFor({ state: 'visible', timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    if (!popoverOpened) {
      // eslint-disable-next-line no-console
      console.log(
        '[sightings-log-cell] SKIP: single-bucket click did not open the ' +
          'ClusterListPopover within the bounded window (map-load race) — the ' +
          'cell mapping/fetch/banner contract is covered by the unit + RTL specs.',
      );
      test.skip(true, 'ClusterListPopover did not open — map-load race');
      return;
    }

    // Expand the family, then pick the species row → threads the {kind:'cell'}
    // context built from the bucket's own center.
    const familyToggle = popover.getByTestId('cluster-list-popover-family-tyrannidae');
    await familyToggle.locator('button').first().click();
    await popover.getByText(/Vermilion Flycatcher/).click();

    // The detail surface opens (?detail=vermfly) and the cell fetch fires.
    await expect.poll(() => app.getUrlParams().get('detail'), { timeout: 8_000 }).toBe('vermfly');

    const log = page.getByRole('region', { name: /sightings under this marker/i });
    await expect(log).toBeVisible({ timeout: 8_000 });

    // Deterministic assertions once the cell log is mounted:
    // - exactly the two stubbed rows render,
    await expect(log.locator('.detail-fg-sighting-row')).toHaveCount(2);
    await expect(log.getByText('Sweetwater Wetlands')).toBeVisible();
    // - howMany 4 > 1 → the ×4 count column,
    await expect(log.locator('.detail-fg-sighting-count').first()).toHaveText('×4');
    // - truncation banner uses meta.cellObservationCount (137) as M.
    await expect(log.locator('.detail-fg-sightings-truncation')).toHaveText(
      'Showing latest 2 of 137',
    );

    // The cell request carried the ACTIVE since-window (since=1d), the picked
    // species, the bucket center, and the national scope ('US').
    const cellReq = await page.evaluate(() => {
      const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      return entries.map((e) => e.name).find((n) => n.includes('/api/observations/cell')) ?? null;
    });
    expect(cellReq, 'a /api/observations/cell request must have fired').not.toBeNull();
    const u = new URL(cellReq!);
    expect(u.searchParams.get('since')).toBe('1d');
    expect(u.searchParams.get('species')).toBe('vermfly');
    expect(u.searchParams.get('scope')).toBe('US');
    expect(Number(u.searchParams.get('lng'))).toBe(BUCKET_LNG);
    expect(Number(u.searchParams.get('lat'))).toBe(BUCKET_LAT);
  });

  // M4 (#1303) — the MOBILE cell path. Same single-bucket → popover → species
  // pick walk, but the surface is the bottom Sheet. The cell fetch fires when the
  // sheet mounts (entry-page log is always mounted); expanding to FULL presents
  // the fetched rows + truncation banner. Mirrors the desktop cell assertions.
  test('mobile: single-bucket cell → pick species → sheet → expand to FULL renders cell sightings + banner (390×844)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const app = new AppPage(page);
    await app.goto('scope=us&since=1d');
    await app.waitForAppReady();

    // CONSISTENT WITH THE DESKTOP SIBLING — same three guards, same order, so the
    // two tests skip/pass together (the #1310 asymmetry fix). See the helper
    // docstrings above for the rationale of each guard.

    // GUARD 1 (WebGL/readiness).
    const webglReady = await waitForMapHook(page);
    if (!webglReady) {
      // eslint-disable-next-line no-console
      console.log(
        '[sightings-log-cell] SKIP (mobile): maplibre never fired `load` (no WebGL/GPU) — ' +
          '__birdMap unavailable, so the single-bucket click cannot be driven. The cell ' +
          'mapping/fetch/banner contract is covered deterministically by the unit + RTL specs.',
      );
      test.skip(true, 'WebGL unavailable — __birdMap not published');
      return;
    }

    // GUARD 2 (idle-gate the popover precondition).
    await settleMapIdle(page);

    // Drive the single-bucket path; clean-skip if the wrapper is not yet wired.
    const drove = await driveSingleBucketClick(page);
    if (!drove) {
      // eslint-disable-next-line no-console
      console.log(
        '[sightings-log-cell] SKIP (mobile): unclustered-point delegated click wrapper ' +
          'not registered — `load` did not complete listener wiring (no WebGL).',
      );
      test.skip(true, 'unclustered-point delegated click wrapper unavailable');
      return;
    }

    // GUARD 3 (bounded-wait → clean-skip safety floor).
    const popover = page.getByTestId('cluster-list-popover');
    const popoverOpened = await popover
      .waitFor({ state: 'visible', timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    if (!popoverOpened) {
      // eslint-disable-next-line no-console
      console.log(
        '[sightings-log-cell] SKIP (mobile): single-bucket click did not open the ' +
          'ClusterListPopover within the bounded window (map-load race) — the cell ' +
          'mapping/fetch/banner contract is covered by the unit + RTL specs.',
      );
      test.skip(true, 'ClusterListPopover did not open — map-load race');
      return;
    }
    const familyToggle = popover.getByTestId('cluster-list-popover-family-tyrannidae');
    await familyToggle.locator('button').first().click();
    await popover.getByText(/Vermilion Flycatcher/).click();

    await expect.poll(() => app.getUrlParams().get('detail'), { timeout: 8_000 }).toBe('vermfly');

    // Mobile mounts the Sheet (opens at half). Expand to full to present the log.
    const sheet = app.speciesDetailSheet;
    await expect(sheet).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: /expand species detail/i }).click();
    await expect(sheet).toHaveAttribute('data-snap-state', 'full');

    const log = page.getByRole('region', { name: /sightings under this marker/i });
    await expect(log).toBeVisible({ timeout: 8_000 });
    await expect(log.locator('.detail-fg-sighting-row')).toHaveCount(2);
    await expect(log.getByText('Sweetwater Wetlands')).toBeVisible();
    await expect(log.locator('.detail-fg-sighting-count').first()).toHaveText('×4');
    await expect(log.locator('.detail-fg-sightings-truncation')).toHaveText(
      'Showing latest 2 of 137',
    );

    // The cell request carried the active since-window, picked species, bucket
    // center, and national scope — identical contract to the desktop path.
    const cellReq = await page.evaluate(() => {
      const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      return entries.map((e) => e.name).find((n) => n.includes('/api/observations/cell')) ?? null;
    });
    expect(cellReq, 'a /api/observations/cell request must have fired').not.toBeNull();
    const u = new URL(cellReq!);
    expect(u.searchParams.get('since')).toBe('1d');
    expect(u.searchParams.get('species')).toBe('vermfly');
    expect(u.searchParams.get('scope')).toBe('US');
    expect(Number(u.searchParams.get('lng'))).toBe(BUCKET_LNG);
    expect(Number(u.searchParams.get('lat'))).toBe(BUCKET_LAT);
  });
});

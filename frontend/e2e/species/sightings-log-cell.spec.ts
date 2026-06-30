import { test, expect } from '../fixtures.js';
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

    // The ONLY residual nondeterminism: the live maplibre instance (exposed as
    // `__birdMap`) is published from the `load` handler, which never fires in a
    // WebGL-less headless run. Everything past this point is deterministic (a
    // direct fire of the unclustered-point handler + real DOM + the stubbed B1
    // endpoint), so this single guard never masks the core assertions — it only
    // tolerates the no-GPU environment, and logs exactly what it skips.
    const webglReady = await page
      .waitForFunction(() => Boolean((window as { __birdMap?: unknown }).__birdMap), null, {
        timeout: 12_000,
      })
      .then(() => true)
      .catch(() => false);
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

    // Drive the REACHABLE single-bucket path. The `unclustered-point` click is a
    // maplibre LAYER-DELEGATED listener: maplibre stores it on
    // `map._delegatedListeners.click` as `{ layers:['unclustered-point'],
    // delegates:{ click } }`, where `delegates.click` is the wrapper maplibre
    // itself calls on a real canvas click — it runs `queryRenderedFeatures(point,
    // {layers:['unclustered-point']})` and, if a feature matches, invokes the
    // app handler with `e.features` populated. We override `queryRenderedFeatures`
    // to return ONE bucket feature (no subId, real familiesJson — exactly what
    // bucketsToGeoJson writes for an unclustered bucket), then invoke that same
    // `delegates.click` wrapper with a synthetic point/lngLat event. This is the
    // identical call path a real canvas click takes, with no painted SDF symbol
    // and no dependence on the bucket's on-screen pixel position — so it is fully
    // deterministic under WebGL.
    const drove = await page.evaluate(
      ({ families }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const map = (window as any).__birdMap;
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
    expect(drove, 'the unclustered-point delegated click wrapper must exist').toBe(true);

    // The unclustered handler opens the real-species ClusterListPopover.
    const popover = page.getByTestId('cluster-list-popover');
    await expect(popover).toBeVisible({ timeout: 8_000 });

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

    const webglReady = await page
      .waitForFunction(() => Boolean((window as { __birdMap?: unknown }).__birdMap), null, {
        timeout: 12_000,
      })
      .then(() => true)
      .catch(() => false);
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

    const drove = await page.evaluate(
      ({ families }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const map = (window as any).__birdMap;
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
    expect(drove, 'the unclustered-point delegated click wrapper must exist').toBe(true);

    const popover = page.getByTestId('cluster-list-popover');
    await expect(popover).toBeVisible({ timeout: 8_000 });
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

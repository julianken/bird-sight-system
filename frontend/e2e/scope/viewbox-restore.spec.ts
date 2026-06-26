import { test, expect } from '../fixtures.js';
import { AppPage } from '../pages/app-page.js';

/**
 * #1242 (C4 / epic #1238) — `#map=<z>/<lat>/<lng>` viewbox-restore on cold load
 * + write-back. The map camera is otherwise scope-derived; a copied link makes
 * an exact view self-restoring.
 *
 * GPU-FREE assertion (load-bearing): the restore is asserted via the
 * `data-hash-camera` attribute MapCanvas emits on `[data-testid="map-canvas"]`
 * (the wrapper nested inside `#map-layer`) carrying the APPLIED `zoom/lat/lng`.
 * A `__birdMap` GL read would `test.skip` on the no-WebGL CI runner; the
 * attribute does not. `data-camera-bounds` (App.tsx) only carries the scope key,
 * never the camera, so it cannot distinguish a restored hash view.
 *
 * Determinism (no WebGL camera animation on the CI runner): drive cold-load
 * links via `gotoRaw` (literal URL incl. the `#` fragment — `goto()` strips/
 * mangles it), `emulateMedia({ reducedMotion: 'reduce' })`, latch on the
 * attribute / URL hash, never `waitForTimeout` the write-back debounce.
 *
 * Navigation contract: every test issues its own `gotoRaw`; the data cases wait
 * for `waitForAppReady()`. No DB writes (page.route stubs only).
 */
test.describe('viewbox-restore on cold load (#1242)', () => {
  /** An AZ payload so a state scope yields a non-empty lede. */
  const AZ_OBS = [
    {
      subId: 'S1', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
      lat: 32.22, lng: -110.97,
      obsDt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      locId: 'L1', locName: 'Tucson', howMany: 1, isNotable: false,
      silhouetteId: 'tyrannidae', familyCode: 'tyrannidae',
    },
  ];

  /** A camera INSIDE the AZ fixture envelope ([-114.82,31.33,-109.04,37.0]). */
  const AZ_HASH = 'map=11.500/32.22100/-110.97400';
  /** A camera OUTSIDE AZ (a Texas-ish center) — must NOT restore (AC5). */
  const TEXAS_HASH = 'map=6.000/31.00000/-99.00000';

  async function setup(
    page: import('@playwright/test').Page,
    apiStub: import('../fixtures.js').ApiStub,
  ): Promise<{ app: AppPage }> {
    await apiStub.stubStates();
    await apiStub.stubZipIndex();
    await apiStub.stubEmpty();
    await apiStub.stubObservations(AZ_OBS);
    // Reduced motion ⇒ instant camera settle (no animation to wait through).
    await page.emulateMedia({ reducedMotion: 'reduce' });
    return { app: new AppPage(page) };
  }

  test('AC1: cold ?state=US-AZ#map=… lands on the hash view (data-hash-camera) and survives /api/states', async ({
    page,
    apiStub,
  }) => {
    const { app } = await setup(page, apiStub);

    // gotoRaw — literal URL preserves the `#map=` fragment (goto() would not).
    await app.gotoRaw(`state=US-AZ#${AZ_HASH}`);

    // The camera is restored to the hash view (the imperative restore lands once
    // /api/states resolves the real AZ envelope and validates the center).
    await expect(app.mapCanvas).toHaveAttribute(
      'data-hash-camera',
      '11.500/32.22100/-110.97400',
      { timeout: 10_000 },
    );
    // The real AZ envelope landed (the holding CONUS bounds resolved to US-AZ).
    await expect(app.mapLayer).toHaveAttribute('data-camera-bounds', 'US-AZ');
    await app.waitForAppReady();

    // The camera STAYS on the hash view: the holding→real-envelope transition
    // keeps the same boundsKey, so the camera-intent effect must NOT re-frame
    // and clobber the hash. Hold a beat and re-assert it is unchanged (AC1).
    await expect(app.mapCanvas).toHaveAttribute(
      'data-hash-camera',
      '11.500/32.22100/-110.97400',
    );
    await expect(app.mapLayer).toHaveAttribute('data-scope-fitted', 'true', {
      timeout: 3_000,
    });
    await expect(app.mapCanvas).toHaveAttribute(
      'data-hash-camera',
      '11.500/32.22100/-110.97400',
    );
    // And the URL hash is unchanged (the restore did not rewrite it).
    expect(new URL(page.url()).hash).toBe(`#${AZ_HASH}`);
  });

  test('AC5: an OUT-OF-SCOPE hash (?state=US-AZ#<Texas>) falls back to the scope fit (no data-hash-camera)', async ({
    page,
    apiStub,
  }) => {
    const { app } = await setup(page, apiStub);

    await app.gotoRaw(`state=US-AZ#${TEXAS_HASH}`);
    await app.waitForAppReady();
    await expect(app.mapLayer).toHaveAttribute('data-camera-bounds', 'US-AZ');

    // The Texas hash is outside AZ → it must NOT be restored; the attribute is
    // absent (the camera framed the AZ envelope instead, under the artboard).
    await expect(app.mapCanvas).not.toHaveAttribute('data-hash-camera', /.*/);
  });

  test('AC2: a later in-app scope change reframes (ignores the consumed hash)', async ({
    page,
    apiStub,
  }) => {
    const { app } = await setup(page, apiStub);

    // Land restored to the AZ hash view.
    await app.gotoRaw(`state=US-AZ#${AZ_HASH}`);
    await app.waitForAppReady();
    await expect(app.mapCanvas).toHaveAttribute(
      'data-hash-camera',
      '11.500/32.22100/-110.97400',
      { timeout: 10_000 },
    );

    // Switch to Florida via the in-card scope control — a genuine scope change.
    await app.openScopeDisclosure();
    await app.switchStateViaScopeControl('US-FL');

    // The camera reframes to FL (the consumed hash is ignored — first-run-only).
    await expect(app.mapLayer).toHaveAttribute('data-camera-bounds', 'US-FL');
    // The stale AZ hash-camera handle is gone (the new scope was framed, not the hash).
    await expect(app.mapCanvas).not.toHaveAttribute(
      'data-hash-camera',
      '11.500/32.22100/-110.97400',
    );
  });

  test('AC3: a filter write preserves the #map= hash', async ({ page, apiStub }) => {
    const { app } = await setup(page, apiStub);

    await app.gotoRaw(`state=US-AZ#${AZ_HASH}`);
    await app.waitForAppReady();
    await expect(app.mapCanvas).toHaveAttribute(
      'data-hash-camera',
      '11.500/32.22100/-110.97400',
      { timeout: 10_000 },
    );

    // Toggle a filter — writeUrl must preserve the hash (the C4 url-state fix).
    await app.openFilters();
    await page.getByLabel('Time window', { exact: true }).selectOption('1d');

    // The search gains since=1d AND the #map= hash survives.
    await expect(page).toHaveURL(/[?&]since=1d\b/);
    expect(new URL(page.url()).hash).toBe(`#${AZ_HASH}`);
  });

  test('a bare ?scope=us (no #map=) load shows NO data-hash-camera (normal scope-derived path)', async ({
    page,
    apiStub,
  }) => {
    const { app } = await setup(page, apiStub);

    await app.gotoRaw('scope=us');
    await app.waitForAppReady();
    await expect(app.mapLayer).toHaveAttribute('data-camera-bounds', 'us');
    // No hash ⇒ no restore handle.
    await expect(app.mapCanvas).not.toHaveAttribute('data-hash-camera', /.*/);
  });

  // #1289 — REGRESSION GUARD. The original viewbox-restore tests above assert
  // ONLY the camera (`data-hash-camera`) + hash survival — never that the
  // observations FETCH moved off the CONUS z3 seed to the restored viewport.
  // That blind spot let the deep-link "zero markers at high zoom" bug ship: the
  // camera restored but the fetch stayed pinned to the z3 seed (its settle idle
  // swallowed by App's scope-move window), so the restored high-zoom rectangle —
  // which shares no rows/cells with the z3 national aggregate — rendered empty.
  //
  // This test asserts the FETCH directly: a high-zoom `#map=` restore must fire
  // an `/api/observations` request at zoom >= 6 with a bbox ENCLOSING the
  // restored center. A marker-presence check follows, WebGL-guarded with
  // `test.skip` (per the repo convention — full marker render needs a GPU the
  // headless CI runner may lack; the fetch assertion is the GPU-free proof).
  test('#1289: a high-zoom #map= restore fires the observations fetch at the restored viewport (not the z3 seed)', async ({
    page,
    apiStub,
  }) => {
    // A tiny high-zoom (z16) rectangle around Tucson, AZ — INSIDE the AZ scope
    // envelope, so the restore validates + applies. The AZ_OBS fixture point
    // (-110.974, 32.221) sits inside this rectangle, so the restored-viewport
    // fetch is non-empty (and, with a GPU, paints a marker).
    const HIGH_ZOOM_HASH = 'map=16.000/32.22100/-110.97400';
    // The restored center, in the 2-decimal CANONICAL bbox space (#868/#873 —
    // App/client quantize the bbox to ~2dp so the CF cache key collapses). A z16
    // rectangle this tight collapses to a near-degenerate rounded bbox around the
    // center, so the enclosure check is done at this rounded resolution: the
    // restored fetch must be the tiny Tucson rectangle, NOT the CONUS z3 seed.
    const RESTORED_CENTER = { lng: -110.97, lat: 32.22 };
    const ENCLOSE_EPS = 0.02; // tolerate the 2dp canonical rounding either way

    // Capture every /api/observations request URL BEFORE the stubs register, so
    // we can inspect the {bbox, zoom} each fetch carried.
    const obsRequests: Array<{ bbox: number[] | null; zoom: number | null }> = [];
    page.on('request', req => {
      const u = new URL(req.url());
      if (!u.pathname.endsWith('/api/observations')) return;
      const bboxParam = u.searchParams.get('bbox');
      const zoomParam = u.searchParams.get('zoom');
      obsRequests.push({
        bbox: bboxParam ? bboxParam.split(',').map(Number) : null,
        zoom: zoomParam !== null ? Number(zoomParam) : null,
      });
    });

    const { app } = await setup(page, apiStub);
    await app.gotoRaw(`state=US-AZ#${HIGH_ZOOM_HASH}`);

    // The camera restores to the high-zoom hash view (the existing seam).
    await expect(app.mapCanvas).toHaveAttribute(
      'data-hash-camera',
      '16.000/32.22100/-110.97400',
      { timeout: 10_000 },
    );
    await app.waitForAppReady();

    // THE FIX: at least one /api/observations fetch must carry zoom >= 6 (the
    // per-observation path — the restored high-zoom view) AND a bbox enclosing
    // the restored center. Pre-fix, the ONLY fetch is the z3 CONUS seed
    // (zoom=3, bbox=-130,20,-65,52 — which does enclose the center but is the
    // WRONG aggregated-mode read), and NO zoom>=6 fetch ever fires → empty map.
    await expect
      .poll(
        () =>
          obsRequests.some(
            r =>
              r.zoom !== null &&
              r.zoom >= 6 &&
              r.bbox !== null &&
              r.bbox.length === 4 &&
              // The (canonically-rounded) bbox brackets the restored center
              // within the 2dp rounding tolerance — i.e. it is the tiny Tucson
              // rectangle, decisively NOT the CONUS z3 seed (-130..-65).
              r.bbox[0] <= RESTORED_CENTER.lng + ENCLOSE_EPS &&
              r.bbox[2] >= RESTORED_CENTER.lng - ENCLOSE_EPS &&
              r.bbox[1] <= RESTORED_CENTER.lat + ENCLOSE_EPS &&
              r.bbox[3] >= RESTORED_CENTER.lat - ENCLOSE_EPS &&
              // And the bbox is SMALL (a high-zoom viewport), not the wide seed:
              // lng span well under the aggregated-seed CONUS span (65°).
              r.bbox[2] - r.bbox[0] < 1,
          ),
        {
          timeout: 10_000,
          message:
            'expected an /api/observations fetch at zoom>=6 with a small bbox enclosing the restored center',
        },
      )
      .toBe(true);

    // A redundant CONUS z3 seed fetch firing first is ACCEPTABLE (heavily
    // CF-cached) — we only require that the restored-viewport fetch ALSO fires.
    // Sanity-check the seed did fire (proves the assertion above is the FIX, not
    // the seed being mistaken for it).
    expect(obsRequests.some(r => r.zoom === 3)).toBe(true);

    // Secondary: markers should render at the restored view. GPU-dependent, so
    // skip (don't fail) when no marker paints — the headless CI runner may lack
    // WebGL. The fetch assertion above is the load-bearing, GPU-free proof.
    const marker = page
      .locator('[data-testid="adaptive-grid-marker"], .cluster-pill')
      .first();
    const markerVisible = await marker
      .waitFor({ state: 'visible', timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    if (!markerVisible) {
      test.skip(
        true,
        'No marker painted — likely WebGL unavailable in headless run (fetch assertion already proved the fix)',
      );
      return;
    }
    await expect(marker).toBeVisible();
  });
});

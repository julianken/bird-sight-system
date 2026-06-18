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
});

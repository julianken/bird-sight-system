import { test, expect } from './fixtures.js';
import { AppPage } from './pages/app-page.js';

/**
 * #848 — State framing must land at the CORRECT longitude when switching states
 * WHILE the camera is mid-animation.
 *
 * The bug: a state→state switch made while the camera is still moving (an
 * in-flight `easeTo`/pan) frames the new state at the wrong `center.lng` — it
 * sticks near the camera's pre-switch (western) longitude; zoom + latitude land
 * correctly. `fitBounds` interrupts the in-flight `easeTo`; Mercator
 * `handleEaseTo` captures its `from`-basis against the frozen mid-flight
 * transform and — with `renderWorldCopies=false` (state scope) and no `k===1`
 * target snap — lands on the un-wrapped constrained interpolation endpoint, not
 * the `cameraForBounds` target. The fix re-asserts the geometry-correct
 * `cameraForBounds` target on `moveend`.
 *
 * Strategy: read the target via `__birdMap.cameraForBounds(envelope, …)` (which
 * is correct even mid-flight), start a long westward `easeTo`, switch states
 * WHILE moving via the scope control, then settle and assert
 * `|getCenter().lng − target.center.lng| < 0.75` (also lat < 0.5, zoom < 0.3 to
 * isolate the longitude axis). A CONTROL test does the same switch from a
 * SETTLED camera (correct on old + new code) to prove the test isn't vacuous.
 *
 * WebGL-skip via `skipIfMapHookAbsent`. No DB writes (route stubs + camera
 * reads only).
 */

/** New York envelope (STATES_FIXTURE [w,s,e,n] = [-79.76, 40.5, -71.86, 45.02]). */
const NY_BBOX: [[number, number], [number, number]] = [
  [-79.76, 40.5],
  [-71.86, 45.02],
];
/** Florida envelope (STATES_FIXTURE [-87.63, 24.52, -80.03, 31.0]) — SECONDARY eastward target. */
const FL_BBOX: [[number, number], [number, number]] = [
  [-87.63, 24.52],
  [-80.03, 31.0],
];
/** FIT_BOUNDS_PADDING — must match MapCanvas.tsx (single source of truth). */
const FIT_PADDING = { top: 80, bottom: 48, left: 48, right: 48 } as const;

/**
 * WebGL skip guard. `window.__birdMap` is exposed only once maplibre fires
 * `load` on a mounted map. Skip cleanly when the hook is absent (no GPU in
 * headless). Copied from map-unscoped-no-fetch.spec.ts.
 */
async function skipIfMapHookAbsent(
  page: import('@playwright/test').Page,
  testRef: typeof test,
): Promise<boolean> {
  const present = await page
    .waitForFunction(
      () =>
        typeof (window as { __birdMap?: unknown }).__birdMap !== 'undefined',
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

test.describe('#848: state framing longitude when switching states mid-animation', () => {
  // Desktop framing — the controlled experiment in the issue was at 1440×900.
  test.use({ viewport: { width: 1440, height: 900 } });

  /**
   * Register the always-needed scope stubs (`/api/states`, zip-index, empty
   * fallbacks) + a non-empty observations body so the scoped map boots. Mirrors
   * state-scope.spec.ts `setup()`. No DB.
   */
  async function setup(
    page: import('@playwright/test').Page,
    apiStub: import('./fixtures.js').ApiStub,
  ): Promise<{ app: AppPage }> {
    await apiStub.stubStates();
    await apiStub.stubZipIndex();
    // stubEmpty stubs hotspots/observations/silhouettes → [] as a fallback…
    await apiStub.stubEmpty();
    // …then a small observations body (LIFO — wins) so the scoped map renders a
    // non-empty Template-4 lede on both AZ and the switched-to states.
    await apiStub.stubObservations([
      {
        subId: 'S1',
        speciesCode: 'vermfly',
        comName: 'Vermilion Flycatcher',
        lat: 32.22,
        lng: -110.97,
        obsDt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        locId: 'L1',
        locName: 'Tucson',
        howMany: 1,
        isNotable: false,
        silhouetteId: 'tyrannidae',
        familyCode: 'tyrannidae',
      },
    ]);
    return { app: new AppPage(page) };
  }

  /**
   * Read the geometry-correct fit target via __birdMap.cameraForBounds, stash it
   * on window, then start a long WESTWARD easeTo and return isMoving() — the
   * mid-flight precondition. Returns the camera-not-available sentinel as null.
   */
  async function readTargetAndStartLongMove(
    page: import('@playwright/test').Page,
    bbox: [[number, number], [number, number]],
  ): Promise<{ moving: boolean }> {
    return page.evaluate(
      ([bbox, padding]) => {
        const map = (
          window as {
            __birdMap?: {
              cameraForBounds: (
                b: [[number, number], [number, number]],
                o: object,
              ) => { center: { lng: number; lat: number }; zoom: number } | undefined;
              easeTo: (o: object) => void;
              isMoving: () => boolean;
            };
          }
        ).__birdMap!;
        const target = map.cameraForBounds(bbox, { padding, maxZoom: 12 });
        (window as { __birdMidmotionTarget?: unknown }).__birdMidmotionTarget =
          target
            ? {
                lng: target.center.lng,
                lat: target.center.lat,
                zoom: target.zoom,
              }
            : null;
        // Long animation far west — the camera is interrupted mid-flight by the
        // scope switch's fitBounds (the #848 trigger).
        map.easeTo({ center: [-122, 47], zoom: 5, duration: 4000, essential: true });
        return { moving: map.isMoving() };
      },
      [bbox, FIT_PADDING] as [
        [[number, number], [number, number]],
        typeof FIT_PADDING,
      ],
    );
  }

  /**
   * Settle gate. CRITICAL — keep BOTH clauses. `data-scope-fitted` is only a
   * 1000ms timer (SCOPE_MOVE_SETTLE_MS), NOT a camera-settle signal: it can flip
   * true while the camera is STILL correcting. The non-negotiable gate is
   * `!isMoving()` — without it the assertion could read a mid-correction frame
   * and pass vacuously. Do NOT "simplify" by dropping the waitForFunction clause.
   */
  async function waitSettled(
    page: import('@playwright/test').Page,
    app: AppPage,
  ): Promise<void> {
    await expect(app.mapLayer).toHaveAttribute('data-scope-fitted', 'true', {
      timeout: 5_000,
    });
    await page.waitForFunction(
      () => {
        const m = (
          window as { __birdMap?: { loaded: () => boolean; isMoving: () => boolean } }
        ).__birdMap;
        return !!m && m.loaded() && !m.isMoving();
      },
      undefined,
      { timeout: 8_000 },
    );
  }

  /** Read settled center + zoom and the stashed target; assert axis-isolated. */
  async function assertFramedToTarget(
    page: import('@playwright/test').Page,
  ): Promise<void> {
    const result = await page.evaluate(() => {
      const map = (
        window as {
          __birdMap?: {
            getCenter: () => { lng: number; lat: number };
            getZoom: () => number;
          };
          __birdMidmotionTarget?: { lng: number; lat: number; zoom: number } | null;
        }
      ).__birdMap!;
      const target = (
        window as {
          __birdMidmotionTarget?: { lng: number; lat: number; zoom: number } | null;
        }
      ).__birdMidmotionTarget;
      const c = map.getCenter();
      return { lng: c.lng, lat: c.lat, zoom: map.getZoom(), target };
    });
    expect(result.target, 'cameraForBounds returned a target').not.toBeNull();
    const target = result.target!;
    // Longitude is the bug axis: must land within 0.75° of the cameraForBounds
    // target (the bug residual was 15–41°).
    expect(
      Math.abs(result.lng - target.lng),
      `settled lng ${result.lng.toFixed(2)} vs target ${target.lng.toFixed(2)}`,
    ).toBeLessThan(0.75);
    // Latitude + zoom were correct even with the bug — confirm the fix is
    // longitude-axis-scoped and did not regress them.
    expect(Math.abs(result.lat - target.lat)).toBeLessThan(0.5);
    expect(Math.abs(result.zoom - target.zoom)).toBeLessThan(0.3);
  }

  test('mid-motion AZ→NY (far east): settles at the cameraForBounds longitude, not the stuck western one', async ({
    page,
    apiStub,
  }) => {
    test.setTimeout(60_000);
    const { app } = await setup(page, apiStub);

    await app.goto('state=US-AZ');
    await app.waitForAppReady();
    await expect(app.mapLayer).toHaveAttribute('data-scope-fitted', 'true', {
      timeout: 5_000,
    });
    if (await skipIfMapHookAbsent(page, test)) return;

    // Read the NY target + start a long westward animation; assert it IS moving.
    const { moving } = await readTargetAndStartLongMove(page, NY_BBOX);
    expect(moving, 'camera is mid-flight after easeTo(duration:4000)').toBe(true);

    // Switch to NY WHILE the camera is moving. NO resize/drag/reload.
    // #1035: select + Go commit (change no longer navigates).
    await app.openScopeDisclosure();
    await app.switchStateViaScopeControl('US-NY');

    await waitSettled(page, app);
    await assertFramedToTarget(page);
  });

  test('CONTROL: settled AZ→NY frames correctly (proves the test is not vacuous)', async ({
    page,
    apiStub,
  }) => {
    test.setTimeout(60_000);
    const { app } = await setup(page, apiStub);

    await app.goto('state=US-AZ');
    await app.waitForAppReady();
    if (await skipIfMapHookAbsent(page, test)) return;

    // Wait for the AZ frame to fully settle (data-scope-fitted AND !isMoving)
    // BEFORE switching — the camera is at rest, so the fitBounds does not
    // interrupt anything. Correct on both old and new code.
    await waitSettled(page, app);

    // Read the NY target with the camera AT REST (no easeTo) — start no move.
    await page.evaluate((args) => {
      const [bbox, padding] = args;
      const map = (
        window as {
          __birdMap?: {
            cameraForBounds: (
              b: [[number, number], [number, number]],
              o: object,
            ) => { center: { lng: number; lat: number }; zoom: number } | undefined;
          };
        }
      ).__birdMap!;
      const target = map.cameraForBounds(bbox, { padding, maxZoom: 12 });
      (window as { __birdMidmotionTarget?: unknown }).__birdMidmotionTarget =
        target
          ? { lng: target.center.lng, lat: target.center.lat, zoom: target.zoom }
          : null;
    }, [NY_BBOX, FIT_PADDING] as [
      [[number, number], [number, number]],
      typeof FIT_PADDING,
    ]);

    await app.openScopeDisclosure();
    // #1035: select + Go commit (change no longer navigates).
    await app.switchStateViaScopeControl('US-NY');

    await waitSettled(page, app);
    await assertFramedToTarget(page);
  });

  test('mid-motion AZ→FL (secondary eastward target): settles at the cameraForBounds longitude', async ({
    page,
    apiStub,
  }) => {
    test.setTimeout(60_000);
    const { app } = await setup(page, apiStub);

    await app.goto('state=US-AZ');
    await app.waitForAppReady();
    await expect(app.mapLayer).toHaveAttribute('data-scope-fitted', 'true', {
      timeout: 5_000,
    });
    if (await skipIfMapHookAbsent(page, test)) return;

    const { moving } = await readTargetAndStartLongMove(page, FL_BBOX);
    expect(moving, 'camera is mid-flight after easeTo(duration:4000)').toBe(true);

    await app.openScopeDisclosure();
    // #1035: select + Go commit (change no longer navigates).
    await app.switchStateViaScopeControl('US-FL');

    await waitSettled(page, app);
    await assertFramedToTarget(page);
  });
});

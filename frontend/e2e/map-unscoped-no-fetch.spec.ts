import { test, expect } from './fixtures.js';
import { AppPage } from './pages/app-page.js';

/**
 * S4 (#769) — scope-gate `onViewportChange` so the persistent unscoped map (S1)
 * fires ZERO `/api/observations` requests. Closes R1 — the highest-severity risk
 * in the #761 epic risk register (report §8): a backgrounded-but-mounted unscoped
 * map scheduling a bbox refetch and breaking the #740/C6
 * zero-fetch-on-unscoped-landing AC.
 *
 * What state-scope.spec.ts already proves: a bare-URL chooser landing fires zero
 * `/api/observations` (the unmount-independent, fetch-gate-backed assertion).
 *
 * What THIS spec adds (the part state-scope.spec.ts does NOT cover): drive a
 * REAL viewport-idle on the LIVE, MOUNTED unscoped map (via `window.__birdMap` +
 * `map.once('idle')`) and re-assert net `/api/observations` === 0. That `idle` is
 * the exact event `onViewportChange` listens to (MapCanvas's handleLoad wires
 * `map.on('idle', …)`). It is the assertion that would FAIL on the S1 base
 * WITHOUT the scope-gate and PASSES with it — proving the live map, not the
 * unmount, is what suppresses the fetch.
 *
 * Navigation contract: this is a chooser-landing case, so it skips
 * `waitForAppReady()` (no `[data-render-complete]` is expected while unscoped).
 */

/**
 * Drive the maplibre map to a given center + zoom via the `window.__birdMap`
 * test hook (set by MapCanvas.tsx's handleLoad callback in non-prod builds).
 * Installs a one-shot `idle` latch and waits for the post-jump `idle` — the same
 * event `onViewportChange` listens to. Mirrors `driveMapTo` in
 * family-legend-viewport.spec.ts. Returns `false` when the hook is missing.
 */
async function driveMapTo(
  page: import('@playwright/test').Page,
  lng: number,
  lat: number,
  zoom: number,
): Promise<boolean> {
  const dispatched = await page.evaluate(
    ([lng, lat, zoom]: [number, number, number]) => {
      try {
        const w = window as {
          __birdMap?: {
            jumpTo?: (opts: object) => void;
            flyTo?: (opts: object) => void;
            once: (ev: string, cb: () => void) => void;
          };
          __birdMapIdleSince?: number;
        };
        const map = w.__birdMap;
        if (!map) return false;
        // One-shot idle latch — wait for the *next* idle after this camera
        // change rather than racing one that fired before the jump.
        w.__birdMapIdleSince = 0;
        map.once('idle', () => {
          (window as { __birdMapIdleSince?: number }).__birdMapIdleSince =
            Date.now();
        });
        // Prefer jumpTo (synchronous moveend, no animation interpolation) over
        // flyTo({ duration: 0 }) — the in-tree note: flyTo's duration-0 path can
        // race the cold-load initial idle under CI load.
        if (typeof map.jumpTo === 'function') {
          map.jumpTo({ center: [lng, lat], zoom });
        } else if (typeof map.flyTo === 'function') {
          map.flyTo({ center: [lng, lat], zoom, duration: 0 });
        } else {
          return false;
        }
        return true;
      } catch {
        return false;
      }
    },
    [lng, lat, zoom] as [number, number, number],
  );
  if (!dispatched) return false;
  // Deterministically wait for the post-jump idle (the latch flips non-zero)
  // instead of racing a fixed timeout — required under `retries: 0`.
  await page
    .waitForFunction(
      () => {
        const since = (window as { __birdMapIdleSince?: number })
          .__birdMapIdleSince;
        return typeof since === 'number' && since > 0;
      },
      undefined,
      { timeout: 5_000 },
    )
    .catch(() => undefined);
  return true;
}

/**
 * WebGL skip guard. `window.__birdMap` is exposed only once maplibre fires
 * `load` on a mounted map. Skip cleanly when the hook is absent (no GPU in
 * headless). Mirrors `skipIfMapHookAbsent` in family-legend-viewport.spec.ts.
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

test.describe('S4 (#769): live unscoped map fires zero /api/observations', () => {
  // Desktop framing — the unscoped map mounts behind the chooser scrim at any
  // viewport; pin a deterministic one.
  test.use({ viewport: { width: 1440, height: 900 } });

  /**
   * Register the always-needed scope stubs and a `/api/observations` request
   * counter. Mirrors state-scope.spec.ts `setup()` (stubStates + stubZipIndex +
   * stubEmpty, and a `page.on('request', …)` matcher on `/api/observations`).
   */
  async function setup(
    page: import('@playwright/test').Page,
    apiStub: import('./fixtures.js').ApiStub,
  ): Promise<{ app: AppPage; obsRequests: string[] }> {
    await apiStub.stubStates();
    await apiStub.stubZipIndex();
    // stubEmpty also stubs /api/observations → [] as a fallback so any leaked
    // request resolves (and is still counted) rather than 404-ing.
    await apiStub.stubEmpty();

    const obsRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/observations')) obsRequests.push(req.url());
    });

    return { app: new AppPage(page), obsRequests };
  }

  test('a real viewport-idle on the live, mounted unscoped map fires zero /api/observations', async ({
    page,
    apiStub,
  }) => {
    test.setTimeout(60_000);
    const { app, obsRequests } = await setup(page, apiStub);

    // gotoRaw('') — NO default-scope injection: the true bare-URL unscoped
    // landing (goto('') would inject scope=us). Skips waitForAppReady (no map
    // render-complete is expected while unscoped).
    await app.gotoRaw('');

    // The chooser scrim is the visible primary surface; the map is mounted but
    // INERT behind it (S1). This also confirms __birdMap's host is present.
    await expect(app.chooser).toBeVisible();
    await app.expectMapInert();

    // Baseline (the state-scope.spec.ts assertion, kept green here too): no
    // fetch on the static unscoped landing. Hold the window open for any late
    // fetch.
    await page.waitForTimeout(800);
    expect(obsRequests).toHaveLength(0);

    // The S4-specific proof: the map must reach maplibre `load` (so __birdMap is
    // exposed) THROUGH the scrim — the scrim must overlay, not unmount /
    // display:none, the map. If WebGL is unavailable in headless, skip cleanly.
    if (await skipIfMapHookAbsent(page, test)) return;

    // Drive a REAL viewport-idle while still unscoped — the same `idle` event
    // App's onViewportChange listens to. Without the S4 scope-gate this settle
    // would stage a bbox/zoom and (once a scope is active) leak a fetch; with
    // the gate it does ZERO refetch work.
    const driven = await driveMapTo(page, -111.0, 34.0, 6);
    expect(driven).toBe(true);

    // Give any (mistaken) 250ms bbox debounce + fetch effect a generous window
    // to fire before re-asserting.
    await page.waitForTimeout(800);

    // The load-bearing assertion: STILL zero /api/observations after a live
    // unscoped idle. This passes only because onViewportChange early-returns
    // while unscoped (R1 closed) — not because the map is unmounted.
    expect(obsRequests).toHaveLength(0);
  });
});

import { test, expect, STATES_FIXTURE } from './fixtures.js';
import type { FamilySilhouette, StateSummary } from '@bird-watch/shared-types';
import { AppPage } from './pages/app-page.js';
import { padBounds, ARTBOARD_PAD } from '../src/components/map/mask.js';

/**
 * SUB3 / #764 — state-artboard VERIFICATION (epic #760).
 *
 * This spec is the assembled-feature gate for the artboard mask landed by #762
 * (mask fill + camera decouple + `useStatePolygon` + polite live region) and
 * #763 (label isolation `within` filter + `state-artboard-halo` /
 * `state-artboard-outline` float). It covers:
 *   1. the five scope transitions (chooser→state, ZIP→state-within-artboard,
 *      state→state re-mask, state→whole-US no-mask, state→chooser),
 *   2. a label-bleed style-state assertion (re-asserted after a theme swap),
 *   3. a11y (axe scan, polite live-region announcement, reduced-motion landing),
 *   4. a per-test clean-console gate, and
 *   5. mobile-width overlay focus-order / operability over the masked canvas.
 *
 * BE HONEST ABOUT WHAT THIS GATES. Every `__birdMap` assertion below reads
 * WebGL/maplibre style+transform state that does NOT populate on a headless
 * runner that never paints the canvas. Those assertions therefore SKIP cleanly
 * (the `waitForMapReady()` → `test.skip(!ready, …)` precedent from
 * `basemap-dark-flip.spec.ts`) and gate NOTHING on their own in CI. The
 * AUTHORITATIVE deterministic regression coverage lives in the UNIT layer:
 *   - finding-1 (padded clamp ≠ tight fit): `mask.test.ts` (`padBounds` value)
 *     + `MapCanvas.test.tsx` (applied `maxBounds === padBounds(bounds, PAD)`,
 *     tight-fit decouple);
 *   - reduced-motion (`duration: 0`): `MapCanvas.test.tsx` (mock captures the
 *     `fitBounds`/`flyTo` opts);
 *   - label isolation (`within`-shaped filter): `artboard-layers.test.ts`
 *     (`applyLabelIsolation` against a mock `getStyle().layers`).
 * The `__birdMap` reads here are the best-effort LIVE ECHO of those unit gates,
 * useful when WebGL is available locally, skipped (not failed) when it isn't.
 *
 * Canonical layer ids (hardcoded — NOT re-derived, NOT hedged): mask source
 * `state-mask`, mask fill `state-mask-fill` (#762); float layers
 * `state-artboard-halo`, `state-artboard-outline` (#763). The bare string
 * `state-artboard` is a component-internal effect/ref name in MapCanvas, NOT a
 * layer id — asserting on it would pass vacuously, so it is never used here.
 *
 * Navigation contract (CLAUDE.md): every test issues its own `goto`/`gotoRaw`
 * and never relies on state left by a prior test. WebGL-dependent tests begin
 * with the `waitForMapReady()` skip-guard. No DB writes — all routing is
 * `page.route` stubs.
 *
 * Forward-compat (#761): the state→chooser test asserts the map UNMOUNTS on
 * chooser navigation. Under #761 (always-mounted full-viewport canvas) the map
 * no longer remounts — that test is flagged @remount-shaped so the #761
 * implementer updates it rather than papering over a now-false assumption.
 */

/** Canonical mask source + fill ids (from #762; ground truth, hardcoded). */
const MASK_SOURCE_ID = 'state-mask';
const MASK_FILL_ID = 'state-mask-fill';
/** Float-layer ids (from #763). */
const ARTBOARD_HALO_ID = 'state-artboard-halo';
const ARTBOARD_OUTLINE_ID = 'state-artboard-outline';

/** ZIP_FLYTO_ZOOM (src/state/scope-types.ts) — the metro flyTo landing zoom. */
const ZIP_FLYTO_ZOOM = 10;

/**
 * The ONLY console messages the artboard view is permitted to emit. positron's
 * basemap sprite sheet lacks two icons referenced by some landcover/POI tiles;
 * MapLibre logs each once when the style (re)loads (notably on the theme-swap
 * `setStyle`):
 *   - `circle-11` — POI sprite, referenced by the positron style;
 *   - `wood-pattern` — landcover fill-pattern, surfaces on states whose tiles
 *     carry a wood/forest landcover class (e.g. DC's landcover tiles).
 *
 * Scoped EXACT match per message — never a substring/blanket filter, so any NEW
 * warning (an exterior-label bleed, a maskTheme repaint error, a `moveLayer`
 * sequencing throw from #763) still FAILS the suite. Kept LOCAL to this spec
 * (not promoted to `fixtures.ts`) so these still fail on every other surface if
 * they ever leak there.
 *
 * VERIFIED BYTE-FOR-BYTE (2026-05-29) against a live `npm run dev` map session
 * (captured via `page.on('console')` on AZ + DC entries with a dark theme swap).
 * MapLibre 5.x emits the FULL message — `Image "X" could not be loaded.` is
 * followed by the ` Please make sure you have added the image …` remediation
 * suffix. The #764 issue body quoted the short form as an approximation; the
 * live string (locked in below) is the authoritative one. If a MapLibre upgrade
 * reshapes this text, the gate will (correctly) start failing and these literals
 * must be re-verified against the new live string.
 */
const SPRITE_WARNING_SUFFIX =
  ' Please make sure you have added the image with map.addImage() or a "sprite" ' +
  'property in your style. You can provide missing images by listening for the ' +
  '"styleimagemissing" map event.';
const ALLOWED_CONSOLE = new Set<string>([
  `Image "circle-11" could not be loaded.${SPRITE_WARNING_SUFFIX}`,
  `Image "wood-pattern" could not be loaded.${SPRITE_WARNING_SUFFIX}`,
  // Third known-benign POSITRON basemap warning, verified byte-for-byte live
  // (2026-05-29). It is a maplibre style-EXPRESSION eval over the positron
  // basemap's own layers — NOT an app/observation layer: it reproduces with
  // `silhouettes:[]` AND zero observations, so no app-owned layer is involved.
  // It surfaces ONLY at metro zoom (the ZIP→state `flyTo` lands at
  // ZIP_FLYTO_ZOOM=10, where additional positron label/landcover layers
  // activate and one carries a data-driven numeric paint expression that
  // evaluates a null property in some positron tiles). The whole-state entry
  // frame (low zoom ~6) never hits it. Kept EXACT-match (fixed string, trailing
  // period, no suffix) — never a substring/blanket filter, so any genuinely new
  // app warning at metro zoom still fails. NOT promoted to fixtures.ts (stays
  // local to this spec). If a positron/maplibre upgrade removes it, drop this
  // line (the gate will pass without it).
  'Expected value to be of type number, but found null instead.',
]);

/**
 * Environment-specific WebGL noise — NOT an app signal. These two messages
 * depend ENTIRELY on the runner's WebGL backend, not on the app, and the repo
 * already filters comparable third-party/environment console noise by regex
 * (tile/font 404s — `species-detail.spec.ts` / `map-symbol-layer.spec.ts`).
 * Both are scoped to an exact shape so neither can swallow an app-emitted
 * message; the positron basemap warnings stay separate EXACT-match entries in
 * `ALLOWED_CONSOLE`.
 *
 *   1. GPU-DRIVER PERFORMANCE CHATTER (present WHEN WebGL works): on a headed /
 *      software-GL backend MapLibre's `ReadPixels` path makes the driver log
 *      `[.WebGL-…]GL Driver Message (… Performance …): GPU stall due to
 *      ReadPixels`. Driver-emitted, no app signal, absent on a no-WebGL runner.
 *   2. WebGL-CONTEXT-CREATION FAILURE (present WHEN WebGL is ABSENT): a headless
 *      runner with no WebGL backend (the exact case this spec's `__birdMap`
 *      assertions `test.skip` on) makes MapLibre throw a
 *      `webglcontextcreationerror` → console `Error: {… "type":
 *      "webglcontextcreationerror", "message":"Failed to initialize WebGL"}`.
 *      This is the environment condition the WebGL skip-guard exists for; the
 *      pure-DOM tests (mobile overlays, live-region, chooser unmount) must not
 *      fail on it. It only ever appears when WebGL is unavailable — never a mask
 *      regression.
 */
const ENV_CONSOLE_NOISE =
  /\[\.WebGL-[^\]]*\]GL Driver Message .*GPU stall due to ReadPixels|webglcontextcreationerror|Failed to initialize WebGL/i;

/**
 * Two-species AZ payload so a state scope yields a populated (non-empty) lede
 * and the FamilyLegend has entries. Mirrors the `AZ_OBS` seed in
 * `state-scope.spec.ts` / `zip-scope.spec.ts`.
 */
const AZ_OBS = [
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
  {
    subId: 'S2',
    speciesCode: 'gilwoo',
    comName: 'Gila Woodpecker',
    lat: 32.3,
    lng: -111.0,
    obsDt: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
    locId: 'L2',
    locName: 'Saguaro NP',
    howMany: 2,
    isNotable: false,
    silhouetteId: 'picidae',
    familyCode: 'picidae',
  },
];

/**
 * `STATES_FIXTURE` carries only AZ/FL/NY. The mobile small-state case needs a
 * tiny state, so this spec extends the fixture with US-RI (real bbox). The
 * client polygon for US-RI is present in `public/state-polygons.json` (verified
 * 2026-05-29), so `useStatePolygon('US-RI')` resolves a real MultiPolygon. The
 * extended list stays name-sorted (#732 contract: Arizona < Florida < New York
 * < Rhode Island).
 */
const STATES_WITH_RI: StateSummary[] = [
  ...STATES_FIXTURE,
  { stateCode: 'US-RI', name: 'Rhode Island', bbox: [-71.91, 41.15, -71.12, 42.02] },
];

/**
 * Silhouette rows for the AZ seed's families so `FamilyLegend` renders (it
 * returns null when `silhouettes.length === 0`). `stubEmpty()` stubs
 * `/api/silhouettes` → `[]`, which would suppress the legend; this fixture is
 * re-registered AFTER `stubEmpty` (LIFO wins) in `setup()`.
 *
 * Each row carries a VALID `svgData` path-`d` string so MapCanvas's SDF sprite
 * pipeline registers a real `addImage` sprite — a `null` `svgData` makes the
 * map fall back to the `_FALLBACK` sprite and log `Image "_FALLBACK" could not
 * be loaded` + `Expected value to be of type number, but found null` (the
 * exact path values are mined from `map-symbol-layer.spec.ts`). The `_FALLBACK`
 * row is required: it backs every observation whose family has no sprite, so
 * the map registers it at init — omitting it re-introduces the same warning.
 */
const SILHOUETTE_PATH_A = 'M5 13 C5 9 9 8 13 9 L17 7 L17 10 L15 11 L15 14 L13 15 L8 15 L5 13 Z';
const SILHOUETTE_PATH_FALLBACK =
  'M 6 12 C 6 9 8 7 11 7 C 13 7 14 8 15 9 L 18 8 L 18 10 L 16 11 L 16 14 L 14 16 L 9 16 L 6 14 Z';
const SILHOUETTES_FIXTURE: FamilySilhouette[] = [
  {
    familyCode: 'tyrannidae',
    color: '#c2603a',
    colorDark: '#e89a78',
    svgData: SILHOUETTE_PATH_A,
    svgUrl: null,
    source: null,
    license: null,
    commonName: 'Tyrant Flycatchers',
    creator: null,
  },
  {
    familyCode: 'picidae',
    color: '#3a6ea5',
    colorDark: '#8fbce0',
    svgData: SILHOUETTE_PATH_A,
    svgUrl: null,
    source: null,
    license: null,
    commonName: 'Woodpeckers',
    creator: null,
  },
  {
    familyCode: '_FALLBACK',
    color: '#555555',
    colorDark: '#888888',
    svgData: SILHOUETTE_PATH_FALLBACK,
    svgUrl: null,
    source: null,
    license: null,
    commonName: 'Unknown family',
    creator: null,
  },
];

// --- WebGL/style readiness helpers (copied from basemap-dark-flip.spec.ts so
//     this spec is self-contained — the no-cross-test-state convention). ------

/**
 * Wait until the map canvas is visible AND `window.__birdMap` is populated.
 * Returns false when WebGL is unavailable (headless runner never paints) so the
 * caller can `test.skip` gracefully.
 */
async function waitForMapReady(page: import('@playwright/test').Page): Promise<boolean> {
  await page.locator('[data-testid=map-canvas]').waitFor({ state: 'visible', timeout: 15_000 });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ready = await page.evaluate(() => Boolean((window as any).__birdMap));
    if (ready) return true;
    await page.waitForTimeout(300);
  }
  return false;
}

/** Wait for `map.isStyleLoaded()` after a style load / setStyle swap. */
async function waitForStyleLoaded(page: import('@playwright/test').Page): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const loaded = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = (window as any).__birdMap;
      return Boolean(map?.isStyleLoaded?.());
    });
    if (loaded) return;
    await page.waitForTimeout(200);
  }
  // Fallback: give async post-style-load tile loads an extra second.
  await page.waitForTimeout(1_000);
}

// --- __birdMap read helpers (best-effort; require WebGL) --------------------

/** True iff the named layer exists in the live style. */
async function hasLayer(
  page: import('@playwright/test').Page,
  layerId: string,
): Promise<boolean> {
  return page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (id) => Boolean((window as any).__birdMap?.getLayer?.(id)),
    layerId,
  );
}

/** The current `maxBounds` as `[[w,s],[e,n]]`, or null when unset/absent. */
async function getMaxBounds(
  page: import('@playwright/test').Page,
): Promise<[[number, number], [number, number]] | null> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = (window as any).__birdMap;
    const mb = map?.getMaxBounds?.();
    if (!mb) return null;
    const sw = mb.getSouthWest();
    const ne = mb.getNorthEast();
    return [
      [sw.lng, sw.lat],
      [ne.lng, ne.lat],
    ] as [[number, number], [number, number]];
  });
}

/** Current integer-ish zoom. */
async function getZoom(page: import('@playwright/test').Page): Promise<number | null> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = (window as any).__birdMap;
    return typeof map?.getZoom === 'function' ? (map.getZoom() as number) : null;
  });
}

/** Per-corner closeness of two `[[w,s],[e,n]]` bounds within an epsilon. */
function boundsApproxEqual(
  a: [[number, number], [number, number]],
  b: [[number, number], [number, number]],
  eps = 0.5,
): boolean {
  return (
    Math.abs(a[0][0] - b[0][0]) <= eps &&
    Math.abs(a[0][1] - b[0][1]) <= eps &&
    Math.abs(a[1][0] - b[1][0]) <= eps &&
    Math.abs(a[1][1] - b[1][1]) <= eps
  );
}

const AZ_BBOX = STATES_FIXTURE.find((s) => s.stateCode === 'US-AZ')!.bbox;
const NY_BBOX = STATES_FIXTURE.find((s) => s.stateCode === 'US-NY')!.bbox;
const AZ_TIGHT: [[number, number], [number, number]] = [
  [AZ_BBOX[0], AZ_BBOX[1]],
  [AZ_BBOX[2], AZ_BBOX[3]],
];
const NY_TIGHT: [[number, number], [number, number]] = [
  [NY_BBOX[0], NY_BBOX[1]],
  [NY_BBOX[2], NY_BBOX[3]],
];
const AZ_PADDED = padBounds(AZ_TIGHT, ARTBOARD_PAD);
const NY_PADDED = padBounds(NY_TIGHT, ARTBOARD_PAD);

// ---------------------------------------------------------------------------

test.describe('state-artboard verification (SUB3, #764)', () => {
  /**
   * Register the always-needed scope stubs and a STATE-AWARE
   * `/api/observations` handler (LIFO wins): the AZ seed for `state=US-AZ`, an
   * empty envelope otherwise. Attaches a per-test console listener whose
   * captured `error`/`warning` messages (minus the EXACT-match `ALLOWED_CONSOLE`
   * entries) must be empty by the end of the test — `assertCleanConsole()`.
   */
  async function setup(
    page: import('@playwright/test').Page,
    apiStub: import('./fixtures.js').ApiStub,
    states: StateSummary[] = STATES_FIXTURE,
  ): Promise<{
    app: AppPage;
    obsRequests: string[];
    assertCleanConsole: () => void;
  }> {
    await apiStub.stubStates(states);
    await apiStub.stubZipIndex();
    await apiStub.stubEmpty();
    // Re-register /api/silhouettes with the AZ-family rows AFTER stubEmpty so
    // the FamilyLegend renders over the mask (LIFO — wins over stubEmpty's []).
    await page.route('**/api/silhouettes', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(SILHOUETTES_FIXTURE),
      });
    });

    const obsRequests: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/api/observations')) obsRequests.push(url);
    });

    // Clean-console capture. Only error/warning are tracked; the EXACT-match
    // ALLOWED_CONSOLE set drops the known-benign positron basemap warnings
    // (the two sprite-missing warnings + the metro-zoom style-expression
    // null-eval), and ENV_CONSOLE_NOISE drops env-only GPU-driver chatter.
    const offending: string[] = [];
    page.on('console', (msg) => {
      const type = msg.type();
      if (type !== 'error' && type !== 'warning') return;
      const text = msg.text();
      if (ALLOWED_CONSOLE.has(text)) return; // exact equality, never substring
      if (ENV_CONSOLE_NOISE.test(text)) return; // env GPU-driver noise (not app)
      offending.push(`[${type}] ${text}`);
    });

    // State-aware observations (LIFO — wins over stubEmpty's handler).
    await page.route('**/api/observations**', async (route) => {
      const state = new URL(route.request().url()).searchParams.get('state');
      const data = state === 'US-AZ' ? AZ_OBS : [];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data,
          meta: {
            freshestObservationAt:
              data.length > 0 ? new Date(Date.now() - 5 * 60 * 1000).toISOString() : null,
          },
        }),
      });
    });

    return {
      app: new AppPage(page),
      obsRequests,
      assertCleanConsole: () =>
        expect(
          offending,
          `Unexpected console error/warning(s) — only ${[...ALLOWED_CONSOLE]
            .map((s) => JSON.stringify(s))
            .join(' and ')} are permitted:\n${offending.join('\n')}`,
        ).toEqual([]),
    };
  }

  // === Scope-transition matrix ===========================================

  test('chooser → state: mask mounts, maxBounds = padded AZ clamp, URL ?state=US-AZ', async ({
    page,
    apiStub,
  }) => {
    const { app, obsRequests, assertCleanConsole } = await setup(page, apiStub);

    await app.gotoRaw('');
    await expect(app.chooser).toBeVisible();
    await app.pickStateInChooser('US-AZ');

    // URL round-trip + data invariant (the non-WebGL contract, always gating).
    await expect(page).toHaveURL(/[?&]state=US-AZ\b/);
    await app.waitForAppReady();
    await expect(app.mapCanvas).toBeVisible();
    expect(obsRequests.length).toBeGreaterThan(0);
    for (const url of obsRequests) {
      expect(new URL(url).searchParams.get('state')).toBe('US-AZ');
    }

    // Best-effort WebGL echo: mask present + padded clamp ≠ tight fit.
    const ready = await waitForMapReady(page);
    test.skip(!ready, 'WebGL unavailable — __birdMap absent; mask/clamp echo skipped');
    await waitForStyleLoaded(page);

    expect(
      await hasLayer(page, MASK_FILL_ID),
      `mask fill ${MASK_FILL_ID} must be present on a state scope`,
    ).toBe(true);
    expect(
      await page.evaluate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (id) => Boolean((window as any).__birdMap?.getSource?.(id)),
        MASK_SOURCE_ID,
      ),
      `mask source ${MASK_SOURCE_ID} must be present`,
    ).toBe(true);

    const mb = await getMaxBounds(page);
    expect(mb, 'maxBounds should be set on a state scope').not.toBeNull();
    // Echo of the unit gate: applied clamp ≈ padBounds(AZ bbox, PAD) AND ≠ tight.
    expect(
      boundsApproxEqual(mb!, AZ_PADDED),
      `applied maxBounds ${JSON.stringify(mb)} ≈ padded AZ clamp ${JSON.stringify(AZ_PADDED)}`,
    ).toBe(true);
    expect(
      boundsApproxEqual(mb!, AZ_TIGHT),
      `applied maxBounds must be the PADDED clamp, not the tight fit ${JSON.stringify(AZ_TIGHT)}`,
    ).toBe(false);

    assertCleanConsole();
  });

  test('ZIP → state: resolves to ?state=US-AZ (no ?zip=), mask stays, camera at metro flyTo zoom', async ({
    page,
    apiStub,
  }) => {
    const { app, obsRequests, assertCleanConsole } = await setup(page, apiStub);

    await app.gotoRaw('');
    await expect(app.chooser).toBeVisible();
    await app.submitChooserZip('85701'); // Tucson → US-AZ

    await expect(page).toHaveURL(/[?&]state=US-AZ\b/);
    expect(app.getUrlParams().has('zip')).toBe(false); // locked decision #5
    await app.waitForAppReady();
    await expect(app.mapCanvas).toBeVisible();
    expect(obsRequests.length).toBeGreaterThan(0);
    for (const url of obsRequests) {
      expect(new URL(url).searchParams.get('state')).toBe('US-AZ');
    }

    const ready = await waitForMapReady(page);
    test.skip(!ready, 'WebGL unavailable — __birdMap absent; flyTo-within-artboard echo skipped');
    await waitForStyleLoaded(page);

    // flyTo-within-artboard: the AZ mask + padded clamp remain while the camera
    // lands at the metro flyTo zoom (well above the whole-state fit zoom).
    expect(await hasLayer(page, MASK_FILL_ID), 'AZ mask stays mounted on ZIP entry').toBe(true);
    const mb = await getMaxBounds(page);
    expect(mb, 'maxBounds set').not.toBeNull();
    expect(
      boundsApproxEqual(mb!, AZ_PADDED),
      'clamp stays the padded AZ artboard clamp on the ZIP entry',
    ).toBe(true);

    // The flyTo settles asynchronously — poll the zoom up to the camera's
    // 800ms tween + tile settle. The whole-state fit zoom for AZ is ≈6; the
    // metro flyTo is ZIP_FLYTO_ZOOM (10), so "≥ 8" proves the flyTo won over
    // the fit without flaking on sub-integer easing.
    let zoom: number | null = null;
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline) {
      zoom = await getZoom(page);
      if (zoom != null && zoom >= 8) break;
      await page.waitForTimeout(200);
    }
    expect(
      zoom,
      `camera should land near ZIP_FLYTO_ZOOM (${ZIP_FLYTO_ZOOM}) inside the artboard, got ${zoom}`,
    ).toBeGreaterThanOrEqual(8);

    assertCleanConsole();
  });

  test('state → state: re-masks, maxBounds updates to padded NY clamp (no remount)', async ({
    page,
    apiStub,
  }) => {
    // Emulate prefers-reduced-motion BEFORE navigation so MapCanvas's mount-time
    // `useMemo([])` read picks it up. WHY this matters for THIS test (and not the
    // others): the AZ→NY re-mask hangs on the camera completing its move OUT of
    // the old AZ artboard. The reactive `maxBounds` clamp updates to padded NY
    // (App recomputes `scopeBounds`/`boundsKey` → react-map-gl `setMaxBounds`),
    // but maplibre will not let the NEW clamp settle while the camera center is
    // still parked at the OLD state (AZ center is OUTSIDE padded-NY); the
    // `fitBounds(NY)` move is what carries the center across the AZ→NY boundary so
    // the new clamp can take. With the default 600ms animation that move eases
    // across many painted frames — which a HEADLESS WebGL backend that never
    // paints intermediate frames does not advance, so the camera stays wedged on
    // AZ and `getMaxBounds()` reads the stale AZ clamp for the whole poll (the
    // deterministic 10-pass / 1-fail this test exhibited with WebGL present). On a
    // real GPU the frames paint and the move completes (verified live — the app
    // re-masks correctly), so this is a HEADLESS-TIMING artifact, not an app bug.
    // Under reduced motion the camera effect issues `fitBounds(NY, {duration: 0})`
    // (MapCanvas:730 — `prefersReducedMotion ? 0 : 600`), which lands the center
    // inside NY in a SINGLE synchronous jump with no animation frames to paint, so
    // the NY clamp settles deterministically on every backend. The assertion below
    // is UNCHANGED and still proves the clamp genuinely re-masks AZ→NY (padded NY,
    // and ≠ padded AZ). Reduced-motion only removes the frame-painting dependency
    // — the C0 contract is that a scope reframe must ALWAYS land (`essential:true`),
    // so the destination is identical with or without motion.
    await page.emulateMedia({ reducedMotion: 'reduce' });

    const { app, assertCleanConsole } = await setup(page, apiStub);

    await app.goto('state=US-AZ');
    await app.waitForAppReady();
    await expect(app.scopeControl).toBeVisible();

    const ready = await waitForMapReady(page);
    test.skip(!ready, 'WebGL unavailable — __birdMap absent; re-mask echo skipped');
    await waitForStyleLoaded(page);
    // Sanity: we start on the AZ clamp.
    const azMb = await getMaxBounds(page);
    expect(azMb, 'AZ maxBounds set before switch').not.toBeNull();
    expect(boundsApproxEqual(azMb!, AZ_PADDED), 'starts on padded AZ clamp').toBe(true);

    // Switch AZ → NY in place (the on-map ScopeControl select). No remount.
    await app.scopeControlStateSelect.selectOption('US-NY');
    await expect(page).toHaveURL(/[?&]state=US-NY\b/);
    await app.waitForAppReady();

    // The mask repaints (still mounted) and the clamp updates to padded NY. Under
    // reduced motion the re-fit lands instantly, but `useStatePolygon` still
    // resolves NY's polygon asynchronously and the clamp prop propagates over a
    // render or two, so poll generously — up to 8s — for the NY clamp to land
    // rather than asserting on a single read that could race the in-place re-fit.
    await waitForStyleLoaded(page);
    expect(await hasLayer(page, MASK_FILL_ID), 'mask stays mounted across re-mask').toBe(true);
    let nyMb: [[number, number], [number, number]] | null = null;
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      nyMb = await getMaxBounds(page);
      if (nyMb && boundsApproxEqual(nyMb, NY_PADDED)) break;
      await page.waitForTimeout(200);
    }
    expect(nyMb, 'NY maxBounds set after switch').not.toBeNull();
    expect(
      boundsApproxEqual(nyMb!, NY_PADDED),
      `clamp updates to padded NY ${JSON.stringify(NY_PADDED)}, got ${JSON.stringify(nyMb)}`,
    ).toBe(true);
    expect(
      boundsApproxEqual(nyMb!, AZ_PADDED),
      'NY clamp must differ from the AZ clamp (re-mask actually happened)',
    ).toBe(false);

    assertCleanConsole();
  });

  test('state → whole-US: mask unmounts, URL ?scope=us, no state= on /api/observations', async ({
    page,
    apiStub,
  }) => {
    const { app, obsRequests, assertCleanConsole } = await setup(page, apiStub);

    await app.goto('state=US-AZ');
    await app.waitForAppReady();
    await expect(app.scopeControl).toBeVisible();
    const countBeforeSwitch = obsRequests.length;

    // The in-state "Whole US" niche affordance flips to ?scope=us.
    await app.scopeControlWholeUs.click();
    await expect(page).toHaveURL(/[?&]scope=us\b/);
    expect(app.getUrlParams().has('state')).toBe(false);
    await app.waitForAppReady();
    await expect(app.mapCanvas).toBeVisible();

    // Data invariant: the ?scope=us observations request carries NO state=.
    const afterSwitch = obsRequests.slice(countBeforeSwitch);
    expect(afterSwitch.length).toBeGreaterThan(0);
    for (const url of afterSwitch) {
      expect(new URL(url).searchParams.has('state')).toBe(false);
    }

    const ready = await waitForMapReady(page);
    test.skip(!ready, 'WebGL unavailable — __birdMap absent; no-mask echo skipped');
    await waitForStyleLoaded(page);

    // No-mask scope: the mask fill + float layers unmount; maxBounds is the
    // CONUS-wide clamp (or null), NOT the padded AZ clamp.
    expect(await hasLayer(page, MASK_FILL_ID), 'mask fill unmounts on ?scope=us').toBe(false);
    expect(await hasLayer(page, ARTBOARD_OUTLINE_ID), 'outline float unmounts on ?scope=us').toBe(
      false,
    );
    const mb = await getMaxBounds(page);
    if (mb) {
      expect(
        boundsApproxEqual(mb, AZ_PADDED),
        'whole-US clamp must NOT be the padded AZ artboard clamp',
      ).toBe(false);
    }

    assertCleanConsole();
  });

  test('state → chooser: map stays mounted-but-inert, chooser visible, mask never present', async ({
    page,
    apiStub,
  }) => {
    // #761 (S1): the unscoped early-return is gone — the map no longer tears
    // down on chooser navigation. On the "Change scope" exit the map stays
    // MOUNTED but INERT behind the chooser scrim (`#main-surface` carries
    // `inert`), and the scope gate keeps the observations fetch suppressed
    // (`scopeActive === false`) so no new request fires even though the canvas
    // is still mounted. (This resolves the prior @remount-shaped TODO that
    // flagged the now-false count-0 assumption.)
    const { app, obsRequests, assertCleanConsole } = await setup(page, apiStub);

    await app.goto('state=US-AZ');
    await app.waitForAppReady();
    await expect(app.scopeControl).toBeVisible();

    // "Change scope" exit → returns to the CHOOSER scrim (not a CONUS home).
    await app.scopeControlExit.click();
    await expect(app.chooser).toBeVisible();
    await app.expectMapInert();
    expect(app.getUrlParams().has('state')).toBe(false);
    expect(app.getUrlParams().has('scope')).toBe(false);

    // The observations fetch is suppressed again — no NEW request after exit,
    // even though the map is now mounted-and-inert (the scope gate, not the
    // unmount, is what holds the request count flat).
    const countAtExit = obsRequests.length;
    await page.waitForTimeout(600);
    expect(obsRequests.length).toBe(countAtExit);

    // The mask never renders on the chooser scrim (no scope → no state polygon).
    assertCleanConsole();
  });

  // === Label-bleed (best-effort echo of #763's applyLabelIsolation unit test) =

  test('label isolation: basemap symbol layers carry a `within` filter; re-applied after dark swap', async ({
    page,
    apiStub,
  }) => {
    const { app, assertCleanConsole } = await setup(page, apiStub);

    await app.goto('state=US-AZ');
    await app.waitForAppReady();

    const ready = await waitForMapReady(page);
    test.skip(!ready, 'WebGL unavailable — __birdMap absent; label-bleed echo skipped');

    /**
     * Enumerate basemap symbol layers whose filter first-element is `within`.
     * The matcher mirrors #763's `SYMBOL_NAME_PATTERN` heuristic
     * (artboard-layers.ts) — read that pattern, do NOT invent ids. The
     * authoritative deterministic gate is #763's `applyLabelIsolation` UNIT
     * test; this is the live echo. A heuristic miss (a future positron
     * label-layer rename) yields zero matched layers and MUST FAIL, not pass
     * vacuously — hence the `length > 0` assertion FIRST.
     */
    async function countWithinFilteredSymbolLayers(): Promise<{
      matched: number;
      within: number;
    }> {
      return page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const map = (window as any).__birdMap;
        const style = map?.getStyle?.();
        const layers: Array<{ id: string; type: string; source?: string }> =
          style?.layers ?? [];
        // Mirror of artboard-layers.ts SYMBOL_NAME_PATTERN (2026-05-29). If a
        // future basemap renames label layers, update BOTH this and the source
        // heuristic; the `matched > 0` gate below catches the drift.
        const NAME =
          /(^|[-_])(place|settlement|poi|label|town|city|village|state|country)([-_]|$)|_name(_|$)/i;
        const matched = layers.filter(
          (l) => l.type === 'symbol' && l.source !== 'observations' && NAME.test(l.id),
        );
        let within = 0;
        for (const l of matched) {
          const f = map.getFilter(l.id) as unknown;
          // isolated filter is `['within', …]` or `['all', original, ['within', …]]`.
          const isWithin = (expr: unknown): boolean =>
            Array.isArray(expr) && expr[0] === 'within';
          if (
            isWithin(f) ||
            (Array.isArray(f) &&
              f[0] === 'all' &&
              (f as unknown[]).slice(1).some((sub) => isWithin(sub)))
          ) {
            within += 1;
          }
        }
        return { matched: matched.length, within };
      });
    }

    await waitForStyleLoaded(page);
    const light = await countWithinFilteredSymbolLayers();
    // Heuristic-miss guard: a zero-match enumeration must FAIL (the heuristic
    // drifted), never pass vacuously.
    expect(
      light.matched,
      'no basemap symbol layers matched the label heuristic — positron may have renamed label ' +
        'layers; update SYMBOL_NAME_PATTERN in artboard-layers.ts (and the mirror in this spec)',
    ).toBeGreaterThan(0);
    expect(
      light.within,
      'every matched basemap symbol layer must carry a `within` isolation filter (light style)',
    ).toBe(light.matched);

    // Theme swap → setStyle clears+reloads; isolation must RE-APPLY on the new
    // (dark) style. Use the explicit [data-theme] attribute, not
    // prefers-color-scheme emulation (CLAUDE.md).
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await waitForStyleLoaded(page);
    // Give the MapCanvas MutationObserver + style.load re-apply time to settle.
    let dark = await countWithinFilteredSymbolLayers();
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline && (dark.matched === 0 || dark.within !== dark.matched)) {
      await page.waitForTimeout(250);
      dark = await countWithinFilteredSymbolLayers();
    }
    expect(
      dark.matched,
      'no matched symbol layers on the dark style — isolation lost on theme swap',
    ).toBeGreaterThan(0);
    expect(
      dark.within,
      'isolation must re-apply on the dark style (regression guard for filter-lost-on-theme-swap)',
    ).toBe(dark.matched);

    assertCleanConsole();
  });

  // === a11y ===============================================================

  test('a11y: axe scan of ?state=US-AZ has no WCAG 2/2.1 A/AA violations', async ({
    page,
    apiStub,
  }) => {
    const { app } = await setup(page, apiStub);
    await app.goto('state=US-AZ');
    await app.waitForAppReady();
    await expect(app.mapCanvas).toBeVisible({ timeout: 15_000 });

    // Dynamic import keeps the @axe-core/playwright dep local to the a11y tests
    // (already a devDependency, imported at axe.spec.ts:2 — no package.json /
    // lockfile change). Same WCAG tag set axe.spec.ts uses.
    const { default: AxeBuilder } = await import('@axe-core/playwright');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      // The maplibre canvas + its MapLibre-owned AttributionControl need WebGL
      // and are out of our axe jurisdiction (mirrors axe.spec.ts's map-view
      // rationale) — exclude the canvas root so a headless no-WebGL run does not
      // produce spurious canvas-internal nodes. Our own overlays (ScopeControl,
      // FamilyLegend, MapLede, AppHeader) are NOT excluded and are scanned.
      .exclude('[data-testid="map-canvas"] .maplibregl-control-container')
      .analyze();
    if (results.violations.length) {
      await test.info().attach('axe-violations', {
        body: JSON.stringify(results.violations, null, 2),
        contentType: 'application/json',
      });
    }
    expect(results.violations).toEqual([]);
  });

  test('a11y: polite live region announces region on chooser→state and state→state', async ({
    page,
    apiStub,
  }) => {
    const { app, assertCleanConsole } = await setup(page, apiStub);

    await app.gotoRaw('');
    await expect(app.chooser).toBeVisible();

    // The live region (#762, MapLede.tsx) is `role="status" aria-live="polite"`,
    // visually-hidden (.sr-only), text "Showing {region}.".
    await app.pickStateInChooser('US-AZ');
    await app.waitForAppReady();

    const liveRegion = page.locator('[role="status"][aria-live="polite"]').filter({
      hasText: /Showing /,
    });
    await expect(liveRegion).toHaveText('Showing Arizona.');

    // state→state updates the SAME polite region's text (no focus move).
    await app.scopeControlStateSelect.selectOption('US-NY');
    await expect(page).toHaveURL(/[?&]state=US-NY\b/);
    await expect(
      page.locator('[role="status"][aria-live="polite"]').filter({ hasText: /Showing / }),
    ).toHaveText('Showing New York.');

    assertCleanConsole();
  });

  test('a11y: reduced-motion → scope camera move issues duration:0 (best-effort echo)', async ({
    page,
    apiStub,
  }) => {
    // Emulate reduce BEFORE navigation: MapCanvas reads prefers-reduced-motion
    // once at mount (useMemo []), so it must be set before the map mounts.
    await page.emulateMedia({ reducedMotion: 'reduce' });

    const { app } = await setup(page, apiStub);
    await app.goto('state=US-AZ');
    await app.waitForAppReady();

    const ready = await waitForMapReady(page);
    // No vacuous non-WebGL fallback: App.tsx exposes no camera data-attribute,
    // so the URL settles identically whether the camera tweens or lands
    // instantly. The deterministic reduced-motion gate is MapCanvas.test.tsx's
    // unit assertion (mock captures fitBounds/flyTo opts with duration:0); this
    // is the live echo, skipped (not failed) when WebGL is absent.
    test.skip(!ready, 'WebGL unavailable — __birdMap absent; reduced-motion echo skipped');
    await waitForStyleLoaded(page);

    // Wrap fitBounds/flyTo on the live instance to capture the NEXT move's
    // duration, then trigger a re-fit via state→state. Under reduced motion the
    // captured duration must be 0.
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = (window as any).__birdMap;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__lastMoveDuration = undefined;
      const wrap = (name: 'fitBounds' | 'flyTo') => {
        const orig = map[name].bind(map);
        map[name] = (...args: unknown[]) => {
          const opts = args.find((a) => a && typeof a === 'object' && 'duration' in (a as object));
          if (opts) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).__lastMoveDuration = (opts as { duration?: number }).duration;
          }
          return orig(...args);
        };
      };
      wrap('fitBounds');
      wrap('flyTo');
    });

    await app.scopeControlStateSelect.selectOption('US-NY');
    await expect(page).toHaveURL(/[?&]state=US-NY\b/);

    // Poll for the captured duration (the camera effect fires post-URL-commit).
    let duration: number | undefined;
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      duration = await page.evaluate(() => (window as any).__lastMoveDuration as number | undefined);
      if (duration !== undefined) break;
      await page.waitForTimeout(150);
    }
    expect(
      duration,
      'a re-fit under prefers-reduced-motion must issue duration:0 (instant landing)',
    ).toBe(0);
  });

  // === Mobile overlay interplay (390×844) ================================

  test.describe('at 390×844 mobile viewport', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('overlays render over the mask AND ScopeControl is keyboard-operable over the masked canvas', async ({
      page,
      apiStub,
    }) => {
      const { app, assertCleanConsole } = await setup(page, apiStub);

      await app.goto('state=US-AZ');
      await app.waitForAppReady();
      await expect(app.mapCanvas).toBeVisible();

      // DOM overlays render ABOVE the canvas (visible, not occluded). These are
      // DOM-layer assertions and hold WITHOUT WebGL.
      await expect(app.scopeControl).toBeVisible();
      await expect(app.mapLede).toBeVisible();
      // FamilyLegend (<aside class="family-legend">) renders with the AZ seed.
      await expect(page.locator('aside.family-legend')).toBeVisible();

      // Operability over the masked canvas: each ScopeControl control is
      // keyboard-reachable and actionable — the mask is a below-canvas fill and
      // must not steal focus or eat pointer/keyboard events. Focus each control
      // directly (keyboard-reachable) and confirm it receives focus.
      for (const control of [
        app.scopeControlStateSelect,
        app.scopeControlWholeUs,
        app.scopeControlExit,
      ]) {
        await control.focus();
        await expect(control).toBeFocused();
      }

      // Activation still drives the transition over the mask: switch AZ → NY via
      // keyboard on the focused select.
      await app.scopeControlStateSelect.focus();
      await app.scopeControlStateSelect.selectOption('US-NY');
      await expect(page).toHaveURL(/[?&]state=US-NY\b/);

      assertCleanConsole();
    });

    test('small-state (US-RI) entry mounts the mask without error at mobile width', async ({
      page,
      apiStub,
    }) => {
      // US-RI is not in the default STATES_FIXTURE — extend it (with a real RI
      // polygon present in public/state-polygons.json) so the chooser lists RI
      // and useStatePolygon resolves its geometry.
      const { app, assertCleanConsole } = await setup(page, apiStub, STATES_WITH_RI);

      const pageErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(String(err)));

      await app.goto('state=US-RI');
      await app.waitForAppReady();
      await expect(app.mapCanvas).toBeVisible();
      await expect(app.scopeControl).toBeVisible();

      // No uncaught error from the small-state entry frame.
      expect(pageErrors, `US-RI entry threw: ${pageErrors.join('\n')}`).toHaveLength(0);

      // Best-effort: the mask mounts on the small state where WebGL is available.
      const ready = await waitForMapReady(page);
      test.skip(!ready, 'WebGL unavailable — __birdMap absent; RI mask-mount echo skipped');
      await waitForStyleLoaded(page);
      expect(await hasLayer(page, MASK_FILL_ID), 'mask mounts on US-RI at mobile width').toBe(true);
      expect(
        await hasLayer(page, ARTBOARD_HALO_ID),
        'halo float mounts on US-RI at mobile width',
      ).toBe(true);

      assertCleanConsole();
    });
  });
});

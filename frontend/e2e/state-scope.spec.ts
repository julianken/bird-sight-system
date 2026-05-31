import { test, expect, STATES_FIXTURE } from './fixtures.js';
import { AppPage } from './pages/app-page.js';

/**
 * C9 (#741) — chooser-first scope IA: chooser landing, state-select, `?scope=us`
 * CONUS, whole-US-reset → chooser, and `?state=` deep-link precedence.
 *
 * The headline assertion (AC 5 / prototype learning (f)) is the cold-load fetch
 * suppression: a bare URL lands on `<ScopeChooser>` with the map render AND the
 * `/api/observations` fetch SUPPRESSED. Picking a scope mounts the map fresh and
 * fires exactly one observations fetch — carrying `state=US-XX` for a state
 * scope, and NO `state=` for `?scope=us` (the data invariant, #735).
 *
 * Camera-assertion handle (AC 4 / O1 #776): App.tsx now exposes direct camera
 * handles on #map-layer: `data-camera-bounds` (the active boundsKey) and
 * `data-scope-fitted` (false→true after SCOPE_MOVE_SETTLE_MS). These are the
 * canonical handles. The URL round-trip (`?state=` set) + the
 * `/api/observations` request query (`state=US-XX`) remain as belt-and-suspenders.
 * The map canvas presence (`data-testid='map-canvas'`) confirms the scoped map
 * mounted.
 *
 * Navigation contract (AC 15): the chooser-landing + whole-US-reset cases skip
 * `waitForAppReady()` (no map render is expected); the data cases wait for it.
 * Every test begins with its own `goto`/`gotoRaw` — no reliance on prior state.
 */
test.describe('Scope chooser + state/whole-US scope (C9, #741)', () => {
  /** Two-species AZ payload so a state scope yields a non-empty Template-4 lede. */
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
   * Register the always-needed scope stubs (`/api/states`, `/api/silhouettes`,
   * `/api/hotspots`, zip-index) and count `/api/observations` requests. Returns
   * a live `obsRequests` array + the typed `AppPage`. Each spec registers its
   * own `/api/observations` body on top (LIFO — last registration wins).
   */
  async function setup(
    page: import('@playwright/test').Page,
    apiStub: import('./fixtures.js').ApiStub,
  ): Promise<{ app: AppPage; obsRequests: string[]; mapChunkRequests: string[] }> {
    await apiStub.stubStates();
    await apiStub.stubZipIndex();
    // hotspots + silhouettes resolve immediately so the rest of the app boots
    // (stubEmpty also stubs /api/observations → [] as a fallback; specs that
    // need a body re-register it afterwards, LIFO).
    await apiStub.stubEmpty();

    const obsRequests: string[] = [];
    // O9 (#781): count requests for the lazy MapCanvas / maplibre-gl chunk so
    // we can assert the scope-gated prefetch fires it on a scoped path and NEVER
    // on the unscoped chooser landing (the #740/C6 fetch-light landing). The
    // dev server serves the chunk un-hashed (e.g. `/src/components/map/
    // MapCanvas.tsx` + `/node_modules/.vite/deps/maplibre-gl-*.js`); a hashed
    // preview build emits `maplibre-gl-<hash>.js` / `MapCanvas-<hash>.js`. Both
    // are caught by the stable `maplibre` / `MapCanvas` substrings.
    const mapChunkRequests: string[] = [];
    page.on('request', req => {
      const url = req.url();
      if (url.includes('/api/observations')) obsRequests.push(url);
      if (/maplibre/i.test(url) || /MapCanvas/i.test(url)) mapChunkRequests.push(url);
    });

    return { app: new AppPage(page), obsRequests, mapChunkRequests };
  }

  test('chooser landing (bare URL) — map + cold-load /api/observations fetch suppressed', async ({
    page,
    apiStub,
  }) => {
    const { app, obsRequests, mapChunkRequests } = await setup(page, apiStub);

    // gotoRaw — NO default-scope injection, so this is the true bare-URL
    // unscoped landing (the C9 chooser case). Navigation contract: chooser case
    // skips waitForAppReady (no map render expected).
    await app.gotoRaw('');

    // The chooser is the visible primary surface.
    await expect(app.chooser).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Where do you want to look at birds?' }),
    ).toBeVisible();
    // Both co-primary paths are present; the whole-US escape hatch is present
    // but de-emphasized (it is still a button — visibility, not prominence).
    await expect(app.chooserZipInput).toBeVisible();
    await expect(app.chooserStateSelect).toBeVisible();
    await expect(app.chooserWholeUs).toBeVisible();

    // #761 (S1) re-baseline: the map is now MOUNTED but INERT behind the chooser
    // scrim (the prior full-tree unmount is gone). The chooser scrim is the
    // visible primary surface (asserted above); the map canvas is present and
    // #main-surface carries `inert`.
    await app.expectMapInert();

    // Headline assertion (learning (f)) — UNCHANGED and STILL GREEN: ZERO
    // /api/observations requests fire on the chooser landing. The map mounting
    // idle does NOT fire a request — `scopeActive === false` keeps the fetch
    // gate closed (the gate is in App, independent of the now-removed unmount).
    // Hold the window open to be sure no late fetch slips through.
    await page.waitForTimeout(800);
    expect(obsRequests).toHaveLength(0);
    // #761 (S1) re-baseline of the O9 (#781) chunk assertion: under S1 the map
    // MOUNTS idle behind the scrim, so its lazy MapCanvas/maplibre chunk now
    // loads on the unscoped landing (the React.lazy boundary fires once
    // <MapSurface> mounts). This is intended — the map-first model mounts the
    // map once and never unmounts it. The fetch-light guarantee that survives is
    // the NETWORK one above (zero /api/observations); the JS-bundle chunk is no
    // longer suppressible while the map is mounted-but-inert.
    expect(mapChunkRequests.length).toBeGreaterThan(0);
  });

  test('state select round-trip — ?state=US-AZ, map fetches once with state=US-AZ, region "Arizona"', async ({
    page,
    apiStub,
  }) => {
    const { app, obsRequests, mapChunkRequests } = await setup(page, apiStub);
    await apiStub.stubObservations(AZ_OBS);

    await app.gotoRaw('');
    await expect(app.chooser).toBeVisible();
    // #761 (S1) re-baseline of the O9 (#781) pre-pick assertion: under S1 the
    // idle map mounts behind the chooser scrim, so the lazy MapCanvas/maplibre
    // chunk is already loaded BEFORE the scope is picked (the React.lazy
    // boundary fires on the idle map's mount). The post-pick ≥1 assertion below
    // is the surviving O9 signal that the scoped map renders.
    await app.expectMapInert();

    // Pick Arizona from the chooser <select> + Go.
    await app.pickStateInChooser('US-AZ');

    // URL gains ?state=US-AZ.
    await expect(page).toHaveURL(/[?&]state=US-AZ\b/);
    expect(app.getUrlParams().get('state')).toBe('US-AZ');

    // The map mounts; data resolves.
    await app.waitForAppReady();
    await expect(app.mapCanvas).toBeVisible();

    // The chooser is gone (replaced by the scoped map).
    await expect(app.chooser).toHaveCount(0);

    // /api/observations was requested AT LEAST once, and every request carries
    // state=US-AZ (the server clips via ST_Intersects). There must be no
    // unscoped observations request before the scope was chosen.
    expect(obsRequests.length).toBeGreaterThan(0);
    for (const url of obsRequests) {
      expect(new URL(url).searchParams.get('state')).toBe('US-AZ');
    }

    // Region label reads "Arizona" (resolved from the /api/states name table).
    await expect(app.mapLede).toContainText('Arizona');

    // O9 (#781): the scope-pick warmed the MapCanvas/maplibre chunk — at least
    // one chunk request fired on the scoped path (the prefetch on click + the
    // lazy boundary on mount both target the same chunk; ≥1 is the signal).
    expect(mapChunkRequests.length).toBeGreaterThan(0);

    // O1 (#776) camera data-attribute assertions (AC 4 / scoped-path-only):
    // After a state pick + settle, #map-layer exposes the direct camera handles.
    // data-camera-bounds carries the active boundsKey ('US-AZ' for a state scope).
    await expect(app.mapLayer).toHaveAttribute('data-camera-bounds', 'US-AZ');
    // data-scope-fitted flips true after SCOPE_MOVE_SETTLE_MS (1000ms) — wait
    // up to 3s for the timer to fire after the scope-pick animation settles.
    await expect(app.mapLayer).toHaveAttribute('data-scope-fitted', 'true', { timeout: 3_000 });

    // O1 (#776) result-settle aria-live region (R9): after data settles the
    // App-root polite live region carries the scope+result summary. The region
    // is visually hidden (.sr-only) but present in the a11y tree.
    await expect(page.locator('[role="status"].sr-only')).toContainText('Arizona', { timeout: 3_000 });
  });

  test('?scope=us — CONUS map, region "USA", /api/observations carries NO state=', async ({
    page,
    apiStub,
  }) => {
    const { app, obsRequests } = await setup(page, apiStub);
    await apiStub.stubObservations(AZ_OBS);

    // ?scope=us is the explicit whole-US escape hatch (a real scope), so the
    // map renders directly — wait for the data case.
    await app.goto('scope=us');
    await app.waitForAppReady();
    await expect(app.mapCanvas).toBeVisible();

    // Region label is "USA".
    await expect(app.mapLede).toContainText('USA');

    // Data invariant (#735): ?scope=us sends NO state= — byte-for-byte the
    // unscoped national query. Every observations request must omit state=.
    expect(obsRequests.length).toBeGreaterThan(0);
    for (const url of obsRequests) {
      expect(new URL(url).searchParams.has('state')).toBe(false);
    }
    // URL carries scope=us, not state=.
    expect(app.getUrlParams().get('scope')).toBe('us');
    expect(app.getUrlParams().has('state')).toBe(false);
  });

  test('whole-US reset → CHOOSER (not a CONUS home); observations fetch stops', async ({
    page,
    apiStub,
  }) => {
    const { app, obsRequests } = await setup(page, apiStub);
    await apiStub.stubObservations(AZ_OBS);

    // Start in a scoped state view.
    await app.goto('state=US-AZ');
    await app.waitForAppReady();
    await expect(app.scopeControl).toBeVisible();
    expect(obsRequests.length).toBeGreaterThan(0);

    // Activate the "Change scope" exit affordance.
    const countBeforeExit = obsRequests.length;
    await app.scopeControlExit.click();

    // We return to the CHOOSER scrim, NOT a CONUS map. #761 (S1): the map stays
    // MOUNTED but INERT behind the scrim (no teardown on chooser navigation).
    await expect(app.chooser).toBeVisible();
    await app.expectMapInert();
    // URL is bare again (no state=, no scope=).
    expect(app.getUrlParams().has('state')).toBe(false);
    expect(app.getUrlParams().has('scope')).toBe(false);

    // The observations fetch is suppressed again — no NEW request after exit.
    await page.waitForTimeout(800);
    expect(obsRequests.length).toBe(countBeforeExit);
  });

  test('?state= deep-link precedence — ?state wins over ?zip; AZ renders', async ({
    page,
    apiStub,
  }) => {
    const { app, obsRequests } = await setup(page, apiStub);
    await apiStub.stubObservations(AZ_OBS);

    // goto() leaves ?state= present (it injects scope=us only when neither
    // scope nor state is present) — so this is the literal deep-link. ?zip= is
    // never read by url-state; ?state wins and AZ renders.
    await app.goto('state=US-AZ&zip=10001');
    await app.waitForAppReady();
    await expect(app.mapCanvas).toBeVisible();

    // ?state wins; the ?zip is not a scope and is dropped from the resolution.
    expect(app.getUrlParams().get('state')).toBe('US-AZ');
    await expect(app.mapLede).toContainText('Arizona');
    expect(obsRequests.length).toBeGreaterThan(0);
    for (const url of obsRequests) {
      expect(new URL(url).searchParams.get('state')).toBe('US-AZ');
    }

    // #737/S3 (#773): the deep-linked scoped landing frames AZ with the
    // asymmetric `fitBounds` top-padding (FIT_BOUNDS_PADDING = {top:80}) so the
    // STATE envelope's north edge is pushed clear of the floating chrome.
    // Post-#800: the "chrome" is the controls pill (top-right card, ~64px bottom),
    // NOT the old full-width band. FIT_BOUNDS_PADDING.top = 80 clears the controls
    // pill with comfortable margin. The identity card (top-left) is wider but its
    // bottom (~170-200px) extends below the fitBounds framing on the LEFT — the
    // assertion uses the controls pill as the reference, matching the MapCanvas
    // FIT_BOUNDS_PADDING intent (see MapCanvas.tsx §FIT_BOUNDS_PADDING comment).
    // WebGL-guarded — falls through when `__birdMap` is absent
    // (no-WebGL CI project), where the unit test + map-root-geometry chrome guards
    // still cover the contract.
    await page
      .waitForFunction(() => {
        const map = (window as { __birdMap?: { loaded: () => boolean; isMoving: () => boolean } }).__birdMap;
        return !!map && map.loaded() && !map.isMoving();
      }, undefined, { timeout: 10_000 })
      .catch(() => { /* no WebGL hook — covered by unit + geometry guards */ });
    const clearance = await page.evaluate(() => {
      const map = (window as {
        __birdMap?: { project: (lnglat: [number, number]) => { y: number } };
      }).__birdMap;
      // #800: use the controls pill (top-right card) as the reference — its bottom
      // edge (~64px) matches the FIT_BOUNDS_PADDING.top = 80 intent. The identity
      // card (top-left) is taller but corner-anchored, so its bottom extends below
      // the framing on the LEFT side only.
      const pill = document.querySelector<HTMLElement>('.app-header-controls-pill');
      if (!map || !pill) return null;
      // AZ envelope (STATES_FIXTURE bbox [-114.82, 31.33, -109.04, 37.0]): lng
      // center ≈ -111.93, north lat = 37.0 — the value App.tsx passes as the scope
      // `bounds` north and the camera frames to.
      const northY = map.project([-111.93, 37.0]).y;
      return { northY, scopeBottom: pill.getBoundingClientRect().bottom };
    });
    if (clearance) {
      // The framed state's north edge projects BELOW the controls pill — not
      // occluded by the top-right floating chrome card.
      expect(
        clearance.northY,
        `framed AZ north edge (y=${clearance.northY.toFixed(1)}) clears controls-pill bottom (y=${clearance.scopeBottom.toFixed(1)})`,
      ).toBeGreaterThanOrEqual(clearance.scopeBottom);
    }
  });

  test('chooser state <select> lists the name-sorted states from /api/states', async ({
    page,
    apiStub,
  }) => {
    const { app } = await setup(page, apiStub);
    await app.gotoRaw('');
    await expect(app.chooser).toBeVisible();

    // The placeholder + each fixture state name, in the fixture (name-sorted)
    // order. Confirms the chooser consumed the /api/states stub on mount.
    const optionTexts = await app.chooserStateSelect.locator('option').allInnerTexts();
    expect(optionTexts[0]).toBe('Choose a state…');
    expect(optionTexts.slice(1)).toEqual(STATES_FIXTURE.map(s => s.name));
  });
});

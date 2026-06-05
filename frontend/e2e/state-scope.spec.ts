import { test, expect, STATES_FIXTURE } from './fixtures.js';
import { AppPage } from './pages/app-page.js';
import { snapFetchBbox, type Bbox } from '@bird-watch/geo';

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
   * #847 — per-state observation rows, each LOCATED INSIDE its state's
   * STATES_FIXTURE envelope (AZ [-114.82,31.33,-109.04,37.0],
   * FL [-87.63,24.52,-80.03,31.0], NY [-79.76,40.5,-71.86,45.02]). Fed to
   * `stubStateAwareObservations`, which returns a state's rows ONLY when the
   * requested bbox intersects that state's envelope — so an in-app state→state
   * switch that carried the PREVIOUS state's (disjoint) bbox would get an empty
   * 200 ("No recent sightings"), exactly the bug #847 fixes.
   */
  const ROWS_BY_STATE: Record<string, typeof AZ_OBS> = {
    'US-AZ': AZ_OBS,
    'US-FL': [
      {
        subId: 'FL1', speciesCode: 'rosspo', comName: 'Roseate Spoonbill',
        lat: 27.8, lng: -82.6,
        obsDt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        locId: 'LFL1', locName: 'Tampa', howMany: 3, isNotable: false,
        silhouetteId: 'threskiornithidae', familyCode: 'threskiornithidae',
      },
      {
        subId: 'FL2', speciesCode: 'brnpel', comName: 'Brown Pelican',
        lat: 25.8, lng: -80.2,
        obsDt: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
        locId: 'LFL2', locName: 'Miami', howMany: 5, isNotable: false,
        silhouetteId: 'pelecanidae', familyCode: 'pelecanidae',
      },
    ],
    'US-NY': [
      {
        subId: 'NY1', speciesCode: 'amerob', comName: 'American Robin',
        lat: 42.9, lng: -75.5,
        obsDt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        locId: 'LNY1', locName: 'Syracuse', howMany: 2, isNotable: false,
        silhouetteId: 'turdidae', familyCode: 'turdidae',
      },
      {
        subId: 'NY2', speciesCode: 'norcar', comName: 'Northern Cardinal',
        lat: 43.0, lng: -76.1,
        obsDt: new Date(Date.now() - 95 * 60 * 1000).toISOString(),
        locId: 'LNY2', locName: 'Ithaca', howMany: 1, isNotable: false,
        silhouetteId: 'cardinalidae', familyCode: 'cardinalidae',
      },
    ],
  };

  /** [w,s,e,n] envelopes mirroring STATES_FIXTURE — used to assert the LAST
   *  /api/observations request carries a bbox intersecting the NEW scope. */
  const ENV_BY_STATE: Record<string, [number, number, number, number]> = {
    'US-AZ': [-114.82, 31.33, -109.04, 37.0],
    'US-FL': [-87.63, 24.52, -80.03, 31.0],
    'US-NY': [-79.76, 40.5, -71.86, 45.02],
  };

  /** Axis-aligned overlap of two [w,s,e,n] boxes. */
  function bboxIntersects(
    a: [number, number, number, number],
    b: [number, number, number, number],
  ): boolean {
    return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
  }

  /**
   * The aggregated seed zoom the #847 reseed writes alongside the scope
   * envelope (App.tsx `AGGREGATED_SEED_ZOOM`). The reseed fetch is therefore an
   * aggregated (zoom < 6) request, so #868's fetch-time canonicalization applies
   * to it (the bbox is reconstructed from the envelope midpoint, not edge-snapped).
   */
  const AGGREGATED_SEED_ZOOM = 3;

  /**
   * #847 — does `bbox` match the scope `envelope` (each edge within `tol`
   * degrees)? This is the DETERMINISTIC, WebGL-independent differentiator
   * between the bug and the fix: in this no-WebGL CI the map never settles a
   * state-tight viewport into `debouncedBbox`, so on UNPATCHED `main` the
   * post-switch fetch carries the cold-mount CONUS seed (`INITIAL_BBOX_SEED`,
   * `-130,20,-65,52` since #870), which `intersects` (but does NOT match) the
   * new state's envelope.
   * The render-phase reseed sets `debouncedBbox` to the new scope's exact
   * envelope, so AFTER the fix the post-switch bbox matches within tol — RED on
   * main (CONUS seed), GREEN after fix.
   *
   * #873 — for a STATE scope in the aggregated path (`zoom < 6`), `client.ts`
   * now sends the state's FIXED envelope (`StateSummary.bbox`) snapped OUTWARD
   * to the cache grid via `snapFetchBbox(envelope, seedZoom)` — NOT the
   * center-varying `canonicalFetchBbox` of the viewport (that center-varying box
   * was the 100%-MISS defect #873 fixes). So the reseed/settle fetch for a state
   * now carries the snapped fixed envelope; assert against that. (Before #873
   * this compared against `canonicalFetchBbox(envelope, seedZoom)`; the contract
   * changed with the fixed-envelope key.)
   *
   * The RED-on-main / GREEN-after-fix discriminator is preserved: each state's
   * snapped fixed envelope is distinct from the CONUS cold-mount seed's canonical
   * box (`canonicalFetchBbox(INITIAL_BBOX_SEED, 3) = -130,20,-65,52`), which is
   * what an UNPATCHED post-switch fetch carries. The state snapped envelopes are
   * AZ `-115,31,-109,37` / FL `-88,24,-80,31` / NY `-80,40,-71,46` (each axis
   * floored W/S, ceiled E/N to the z3 1.0° grid) — none equal the
   * `-130,20,-65,52` CONUS-seed box, so a missing reseed/envelope still fails
   * this assertion. (`bboxIntersects` above stays a separate, weaker guard: the
   * state envelope always intersects the target state, which is what the server
   * `?state=` ST_Intersects clip relies on for correctness.)
   */
  function bboxMatchesEnvelope(
    bbox: [number, number, number, number],
    envelope: [number, number, number, number],
    tol = 0.5,
  ): boolean {
    // #873 — state scopes transmit the fixed envelope snapped to the grid.
    const expected = snapFetchBbox(envelope as Bbox, AGGREGATED_SEED_ZOOM);
    return bbox.every((v, i) => Math.abs(v - expected[i]) <= tol);
  }

  /** Pull the bbox off the LAST /api/observations request carrying `state`. */
  function lastBboxForState(
    obsRequests: string[],
    state: string,
  ): [number, number, number, number] | null {
    for (let i = obsRequests.length - 1; i >= 0; i--) {
      const u = new URL(obsRequests[i]);
      if (u.searchParams.get('state') !== state) continue;
      const raw = u.searchParams.get('bbox');
      if (!raw) return null;
      const parts = raw.split(',').map(Number);
      if (parts.length === 4 && !parts.some(Number.isNaN)) {
        return parts as [number, number, number, number];
      }
      return null;
    }
    return null;
  }

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

    // #828: the region moved to the wordmark headline; the lede is count-only.
    // The region ("Arizona", resolved from the /api/states name table) now reads
    // in the wordmark line, and the lede is just the count.
    await expect(app.appHeader.locator('.brand-region')).toHaveText('· Arizona');
    await expect(app.mapLede).toHaveText(/^\d+ species$/);

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
    // App-root polite live region (a <div> at App root, distinct from the
    // AppHeader scope-change <span>) re-speaks `ledeText`. #828 made that
    // count-only, so the result-settle region now carries the count ("N
    // species"), NOT the region name. The div is visually hidden (.sr-only) but
    // present in the a11y tree (#741 copy-lockstep — this contract mirrors the
    // displayed lede, so it moves in lockstep with App.tsx's ledeText).
    await expect(page.locator('div[role="status"].sr-only')).toHaveText(/^\d+ species$/, { timeout: 3_000 });
    // #828 a11y (no regression): the REGION is still announced — by the AppHeader
    // scope-change live region ("Showing Arizona."), so a screen-reader user
    // hears "Showing Arizona." then "N species" with no duplication.
    await expect(
      app.appHeader.locator('span[role="status"][aria-live="polite"]'),
    ).toHaveText('Showing Arizona.');
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

    // #828: region "USA" now reads in the wordmark line; the lede is count-only.
    await expect(app.appHeader.locator('.brand-region')).toHaveText('· USA');

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
    // #828: the scope form is collapsed behind the 🔍 disclosure — open it so
    // the "Change scope" exit affordance is revealed.
    await app.openScopeDisclosure();
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
    // #828: AZ rendered → region in the wordmark line; lede is count-only.
    await expect(app.appHeader.locator('.brand-region')).toHaveText('· Arizona');
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

  // #847 — PRIMARY headline guard. An in-app state→state switch (in-card scope
  // control <select>) must repopulate markers with NO manual move/resize/reload.
  // Pre-fix, the post-switch fetch carried the stale NY bbox → disjoint from FL
  // → empty 200 → "No recent sightings". The fix re-seeds the bbox to the FL
  // envelope at render, so the post-switch fetch intersects FL → rows return.
  test('#847: in-app NY→FL switch repopulates (no resize/reload); last fetch carries an FL-intersecting bbox', async ({
    page,
    apiStub,
  }) => {
    const { app, obsRequests } = await setup(page, apiStub);
    await apiStub.stubStateAwareObservations(ROWS_BY_STATE);

    // Land scoped to NY (a non-empty Template lede).
    await app.goto('state=US-NY');
    await app.waitForAppReady();
    await expect(app.mapLede).toHaveText(/^\d+ species$/);

    // In-app switch to FL via the in-card scope control — NO resize/drag/reload.
    await app.openScopeDisclosure();
    await app.scopeControlStateSelect.selectOption('US-FL');

    // (a) The camera flips to FL.
    await expect(app.mapLayer).toHaveAttribute('data-camera-bounds', 'US-FL');
    // (b) The lede repopulates and NEVER sticks on the empty copy.
    await expect(app.mapLede).toHaveText(/^\d+ species$/);
    await expect(app.mapLede).not.toHaveText(/No recent sightings/);
    await expect(app.appHeader.locator('.brand-region')).toHaveText('· Florida');

    // (c) The LAST /api/observations carrying state=US-FL has a bbox tightly
    // matching the FL envelope (the render-phase reseed value) — NOT the stale
    // bbox. On unpatched main this carries the CONUS cold-mount seed, which
    // intersects FL but does NOT match its envelope → RED; the fix reseeds it to
    // the FL envelope → GREEN.
    await expect.poll(() => lastBboxForState(obsRequests, 'US-FL') !== null).toBe(true);
    const flBbox = lastBboxForState(obsRequests, 'US-FL')!;
    expect(bboxIntersects(flBbox, ENV_BY_STATE['US-FL'])).toBe(true);
    expect(
      bboxMatchesEnvelope(flBbox, ENV_BY_STATE['US-FL']),
      `last US-FL bbox=${flBbox.join(',')} must match the FL envelope ${ENV_BY_STATE['US-FL'].join(',')} (reseed); got the stale/CONUS bbox`,
    ).toBe(true);
  });

  // #847 — reverse-direction companion: FL→NY self-recovers the same way.
  test('#847: in-app FL→NY switch repopulates; last fetch carries an NY-intersecting bbox', async ({
    page,
    apiStub,
  }) => {
    const { app, obsRequests } = await setup(page, apiStub);
    await apiStub.stubStateAwareObservations(ROWS_BY_STATE);

    await app.goto('state=US-FL');
    await app.waitForAppReady();
    await expect(app.mapLede).toHaveText(/^\d+ species$/);

    await app.openScopeDisclosure();
    await app.scopeControlStateSelect.selectOption('US-NY');

    await expect(app.mapLayer).toHaveAttribute('data-camera-bounds', 'US-NY');
    await expect(app.mapLede).toHaveText(/^\d+ species$/);
    await expect(app.mapLede).not.toHaveText(/No recent sightings/);
    await expect(app.appHeader.locator('.brand-region')).toHaveText('· New York');

    await expect.poll(() => lastBboxForState(obsRequests, 'US-NY') !== null).toBe(true);
    const nyBbox = lastBboxForState(obsRequests, 'US-NY')!;
    expect(bboxIntersects(nyBbox, ENV_BY_STATE['US-NY'])).toBe(true);
    expect(
      bboxMatchesEnvelope(nyBbox, ENV_BY_STATE['US-NY']),
      `last US-NY bbox=${nyBbox.join(',')} must match the NY envelope ${ENV_BY_STATE['US-NY'].join(',')} (reseed); got the stale/CONUS bbox`,
    ).toBe(true);
  });

  // #847 — whole-US (?scope=us) → state companion: the CONUS-contains-every-state
  // boundary. From ?scope=us (no state= sent) the in-card switch to AZ must seed
  // an AZ-intersecting bbox so AZ rows return.
  test('#847: ?scope=us → AZ switch repopulates; last fetch carries an AZ-intersecting bbox', async ({
    page,
    apiStub,
  }) => {
    const { app, obsRequests } = await setup(page, apiStub);
    await apiStub.stubStateAwareObservations(ROWS_BY_STATE);

    await app.goto('scope=us');
    await app.waitForAppReady();

    await app.openScopeDisclosure();
    await app.scopeControlStateSelect.selectOption('US-AZ');

    await expect(app.mapLayer).toHaveAttribute('data-camera-bounds', 'US-AZ');
    await expect(app.mapLede).toHaveText(/^\d+ species$/);
    await expect(app.mapLede).not.toHaveText(/No recent sightings/);
    await expect(app.appHeader.locator('.brand-region')).toHaveText('· Arizona');

    await expect.poll(() => lastBboxForState(obsRequests, 'US-AZ') !== null).toBe(true);
    const azBbox = lastBboxForState(obsRequests, 'US-AZ')!;
    expect(bboxIntersects(azBbox, ENV_BY_STATE['US-AZ'])).toBe(true);
    expect(
      bboxMatchesEnvelope(azBbox, ENV_BY_STATE['US-AZ']),
      `last US-AZ bbox=${azBbox.join(',')} must match the AZ envelope ${ENV_BY_STATE['US-AZ'].join(',')} (reseed); got the stale/CONUS bbox`,
    ).toBe(true);
  });
});

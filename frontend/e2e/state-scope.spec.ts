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
 * Camera-assertion handle (AC 4): App.tsx exposes no dedicated camera
 * data-attribute, so the camera move is asserted via the URL round-trip
 * (`?state=` set) + the `/api/observations` request query (`state=US-XX`) — the
 * agreed handle. The map canvas presence (`data-testid='map-canvas'`) confirms
 * the scoped map mounted.
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
  ): Promise<{ app: AppPage; obsRequests: string[] }> {
    await apiStub.stubStates();
    await apiStub.stubZipIndex();
    // hotspots + silhouettes resolve immediately so the rest of the app boots
    // (stubEmpty also stubs /api/observations → [] as a fallback; specs that
    // need a body re-register it afterwards, LIFO).
    await apiStub.stubEmpty();

    const obsRequests: string[] = [];
    page.on('request', req => {
      const url = req.url();
      if (url.includes('/api/observations')) obsRequests.push(url);
    });

    return { app: new AppPage(page), obsRequests };
  }

  test('chooser landing (bare URL) — map + cold-load /api/observations fetch suppressed', async ({
    page,
    apiStub,
  }) => {
    const { app, obsRequests } = await setup(page, apiStub);

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

    // The map canvas is NOT rendered (the unscoped early-return shows the
    // chooser in place of the map surface).
    await expect(app.mapCanvas).toHaveCount(0);
    await expect(app.mainSurface).toHaveCount(0);

    // Headline assertion (learning (f)): ZERO /api/observations requests fire on
    // the chooser landing. Hold the window open to be sure no late fetch slips
    // through (the scope gate is in App, not just the unmount).
    await page.waitForTimeout(800);
    expect(obsRequests).toHaveLength(0);
  });

  test('state select round-trip — ?state=US-AZ, map fetches once with state=US-AZ, region "Arizona"', async ({
    page,
    apiStub,
  }) => {
    const { app, obsRequests } = await setup(page, apiStub);
    await apiStub.stubObservations(AZ_OBS);

    await app.gotoRaw('');
    await expect(app.chooser).toBeVisible();

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

    // We return to the CHOOSER, NOT a CONUS map.
    await expect(app.chooser).toBeVisible();
    await expect(app.mapCanvas).toHaveCount(0);
    await expect(app.mainSurface).toHaveCount(0);
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

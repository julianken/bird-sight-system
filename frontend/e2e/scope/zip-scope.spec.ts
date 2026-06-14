import { test, expect } from '../fixtures.js';
import { AppPage } from '../pages/app-page.js';

/**
 * D6 (#741) — ZIP round-trip, empty-region narration, and the ZIP / `/api/states`
 * error paths. Asserts the C7 sparse/empty-region copy wired by #740.
 *
 * The ZIP path resolves a 5-digit ZIP to a `?state=US-XX` scope (NO `?zip=`,
 * locked decision #5) + a transient metro `flyTo` at `ZIP_FLYTO_ZOOM` (10). The
 * camera move is asserted via the URL round-trip (`?state=` set, no `?zip=`) +
 * the `/api/observations` request query (`state=US-XX`). O1 (#776) added direct
 * camera handles (`data-camera-bounds` / `data-scope-fitted` on #map-layer) —
 * this spec's assertion re-baseline to those direct handles is deferred to
 * WS9.3; the URL+observations-proxy assertions remain as belt-and-suspenders.
 * The metro-zoom landing is the prototype's learning (f) (the ZIP `flyTo` wins
 * over the whole-state `fitBounds` on the chooser→map remount).
 *
 * Empty-region (AC 11) is the data-availability ≠ filter-narrowing distinction:
 * a valid non-AZ ZIP whose state is empty on the AZ-only seed must read the
 * sparse copy "No recent sightings in {region} yet.", NOT "No sightings match
 * your current filters."
 */
test.describe('ZIP scope round-trip + empty-region + error paths (D6, #741)', () => {
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
   * Register the always-needed stubs and count `/api/observations` +
   * `zip-index.json` requests. A STATE-AWARE `/api/observations` handler returns
   * the AZ seed for `state=US-AZ` and an empty envelope for any other state —
   * so the AZ scope is populated while NY (and any other) reads as a sparse,
   * data-available-but-empty region.
   */
  async function setup(
    page: import('@playwright/test').Page,
    apiStub: import('../fixtures.js').ApiStub,
  ): Promise<{ app: AppPage; obsRequests: string[]; zipIndexRequests: string[] }> {
    await apiStub.stubStates();
    await apiStub.stubZipIndex();
    await apiStub.stubEmpty();

    const obsRequests: string[] = [];
    const zipIndexRequests: string[] = [];
    page.on('request', req => {
      const url = req.url();
      if (url.includes('/api/observations')) obsRequests.push(url);
      if (url.includes('/zip-index.json')) zipIndexRequests.push(url);
    });

    // State-aware observations (LIFO — wins over stubEmpty's handler).
    await page.route('**/api/observations**', async route => {
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

    return { app: new AppPage(page), obsRequests, zipIndexRequests };
  }

  test('ZIP 85701 → state-zoom: ?state=US-AZ (no ?zip=), data clips to AZ', async ({
    page,
    apiStub,
  }) => {
    const { app, obsRequests } = await setup(page, apiStub);

    await app.gotoRaw('');
    await expect(app.chooser).toBeVisible();

    // Tucson ZIP → resolves to US-AZ + a metro flyTo (zoom 10). The lazy ZIP
    // index warms on focus; submitChooserZip focuses (fill) then submits.
    await app.submitChooserZip('85701');

    // URL gains ?state=US-AZ and NEVER ?zip= (locked decision #5).
    await expect(page).toHaveURL(/[?&]state=US-AZ\b/);
    expect(app.getUrlParams().get('state')).toBe('US-AZ');
    expect(app.getUrlParams().has('zip')).toBe(false);

    // The map mounts and clips to AZ (camera handle: state= round-trip + the
    // observations query carries state=US-AZ; the metro-zoom landing is the
    // App flyTo, asserted indirectly via the AZ scope + populated data).
    await app.waitForAppReady();
    await expect(app.mapCanvas).toBeVisible();
    expect(obsRequests.length).toBeGreaterThan(0);
    for (const url of obsRequests) {
      expect(new URL(url).searchParams.get('state')).toBe('US-AZ');
    }
    // AZ has data → the count-only lede reads a populated region (#828: the
    // region moved to the wordmark headline, so the lede no longer names it).
    // #1047: lede always reports sightings in both aggregation modes.
    await expect(app.mapLede).toHaveText(/^\d+ sightings( of .+)?$/);
    await expect(app.mapLede).not.toContainText('No recent sightings');
  });

  test('valid non-AZ ZIP (10001 → US-NY, empty) → distinct sparse/empty-region copy', async ({
    page,
    apiStub,
  }) => {
    const { app } = await setup(page, apiStub);

    await app.gotoRaw('');
    await expect(app.chooser).toBeVisible();

    // Manhattan ZIP → resolves to US-NY, which is empty on the AZ-only seed.
    await app.submitChooserZip('10001');

    await expect(page).toHaveURL(/[?&]state=US-NY\b/);
    await app.waitForAppReady();
    await expect(app.mapCanvas).toBeVisible();

    // Data-availability copy (C7 / #828): the region itself is sparse — NOT the
    // filter-narrowing copy. #828 shortened both to count-only forms: the sparse
    // (no-filter) branch reads "No recent sightings", the filter-narrowing branch
    // reads "No matches for these filters". The load-bearing distinction (data-
    // availability ≠ filter-narrowing) is preserved in the shortened copy.
    await expect(app.mapLede).toHaveText('No recent sightings');
    // The filter-narrowing copy MUST be absent (the load-bearing distinction).
    await expect(page.getByText('No matches for these filters')).toHaveCount(0);
    await expect(page.getByText('No sightings match your current filters.')).toHaveCount(0);
  });

  test('unknown well-formed ZIP → role=status "ZIP not recognized"; scope unchanged; value retained', async ({
    page,
    apiStub,
  }) => {
    const { app, obsRequests } = await setup(page, apiStub);

    await app.gotoRaw('');
    await expect(app.chooser).toBeVisible();

    // 10002 is a well-formed 5-digit ZIP absent from the canned index.
    await app.submitChooserZip('10002');

    // Never a silent no-op: a role=status message is visible.
    await expect(app.chooserZipStatus).toBeVisible();
    await expect(app.chooserZipStatus).toHaveText(
      'ZIP not recognized — try a nearby ZIP or pick a state',
    );

    // Scope/URL unchanged — still on the chooser scrim, no state= written.
    // #761 (S1): the map is mounted-but-INERT behind the scrim (no unmount).
    await expect(app.chooser).toBeVisible();
    await app.expectMapInert();
    expect(app.getUrlParams().has('state')).toBe(false);
    // The input value is retained (not cleared).
    await expect(app.chooserZipInput).toHaveValue('10002');
    // No scope was activated → no observations fetch.
    await page.waitForTimeout(400);
    expect(obsRequests).toHaveLength(0);
  });

  test('malformed ZIP → rejected, no scope, no lookup fetch (gate before fetch, D3)', async ({
    page,
    apiStub,
  }) => {
    const { app, zipIndexRequests } = await setup(page, apiStub);

    await app.gotoRaw('');
    await expect(app.chooser).toBeVisible();

    // A non-5-digit value is malformed. #827 added a submit `<button>` to the
    // ZipInput form, which would normally let the browser's native HTML5
    // constraint validation (`pattern="[0-9]{5}"`) block the submit on a
    // malformed value — but that would make a malformed click a silent no-op
    // (a native bubble, never our styled hint), breaking the never-silent
    // contract. So the form carries `noValidate`: native blocking is off, and
    // the component's own JS gate (`/^\d{5}$/`) owns the malformed path,
    // rendering the inline ".zip-input__error" hint. This submits via the "Go"
    // button (submitChooserZip clicks it) — the iOS-safe pointer path.
    await app.submitChooserZip('123');

    // The never-silent contract via the button: the inline "Enter a 5-digit
    // ZIP" hint is VISIBLE (the AC — a malformed submit is never a silent
    // no-op). This is now the in-browser path too (was jsdom-only before #827).
    await expect(app.chooserZipError).toBeVisible();

    // `noValidate` suppresses native *blocking*, not validity *computation*:
    // the input still reports `patternMismatch` via the validity API.
    const validity = await app.chooserZipInput.evaluate(
      (el: HTMLInputElement) => ({ valid: el.validity.valid, patternMismatch: el.validity.patternMismatch }),
    );
    expect(validity.valid).toBe(false);
    expect(validity.patternMismatch).toBe(true);

    // Scope unchanged — still on the chooser scrim, no state= written.
    // #761 (S1): the map is mounted-but-INERT behind the scrim (no unmount).
    await expect(app.chooser).toBeVisible();
    expect(app.getUrlParams().has('state')).toBe(false);
    await app.expectMapInert();

    // D3: the malformed SUBMIT triggers no lookup fetch. `loadZipIndex` warms
    // lazily on FOCUS (an intentional pre-fetch, single-flight memoized), so a
    // focused-then-malformed-submit yields at MOST the one focus warm and never
    // a per-submit lookup — the JS regex gate short-circuits before `lookupZip`.
    // (Were the gate after the fetch, a malformed submit would add a request.)
    await page.waitForTimeout(400);
    expect(zipIndexRequests.length).toBeLessThanOrEqual(1);
    // The input value is retained (never a silent clear).
    await expect(app.chooserZipInput).toHaveValue('123');
  });

  test('/api/states fetch-error → chooser degrades gracefully; ZIP path still resolves a scope', async ({
    page,
    apiStub,
  }) => {
    // Register the failure FIRST so the LIFO stubStates in setup would override
    // it — instead we DON'T call stubStates here; we fail /api/states.
    await apiStub.stubZipIndex();
    await apiStub.stubEmpty();
    await apiStub.stubApiFailure('states', 500);

    const obsRequests: string[] = [];
    page.on('request', req => {
      if (req.url().includes('/api/observations')) obsRequests.push(req.url());
    });
    // State-aware observations so the ZIP-resolved AZ scope is populated.
    await page.route('**/api/observations**', async route => {
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

    const app = new AppPage(page);

    // No uncaught error: capture page errors over the whole test.
    const pageErrors: string[] = [];
    page.on('pageerror', err => pageErrors.push(String(err)));

    await app.gotoRaw('');

    // The chooser still renders (does NOT throw to the error screen). The
    // selector degrades to an honest placeholder; the ZIP path stays usable.
    await expect(app.chooser).toBeVisible();
    await expect(app.errorScreen).toHaveCount(0);

    // The user can STILL pick a scope via the ZIP path.
    await app.submitChooserZip('85701');
    await expect(page).toHaveURL(/[?&]state=US-AZ\b/);
    await app.waitForAppReady();
    await expect(app.mapCanvas).toBeVisible();

    // No uncaught page error surfaced from the /api/states failure.
    expect(pageErrors).toHaveLength(0);
  });
});

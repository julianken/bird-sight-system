import { test as base } from '@playwright/test';
import type {
  Observation,
  SpeciesDictEntry,
  SpeciesMeta,
  StateSummary,
} from '@bird-watch/shared-types';

/**
 * Read API endpoints that can be stubbed. Keep in sync with
 * services/read-api/src/app.ts. `'states'` is the A4/#732 endpoint
 * (`GET /api/states`) — adding it here makes `stubApiFailure('states', …)` /
 * `stubApiAbort('states')` typecheck for the #741 fetch-error case.
 */
export type StubbableEndpoint = 'hotspots' | 'observations' | 'species' | 'silhouettes' | 'states';

/**
 * Canonical Vermilion Flycatcher SpeciesMeta fixture (NO photoUrl) — exercises
 * the silhouette fallback path on the species detail surface. Used in
 * species-detail.spec.ts, axe.spec.ts, attribution-modal.spec.ts.
 */
export const VERMFLY: SpeciesMeta = {
  speciesCode: 'vermfly',
  comName: 'Vermilion Flycatcher',
  sciName: 'Pyrocephalus rubinus',
  familyCode: 'tyrannidae',
  familyName: 'Tyrant Flycatchers',
  taxonOrder: 4400,
};

/**
 * Vermilion Flycatcher SpeciesMeta WITH photoUrl + attribution + license —
 * exercises the iNat photo render path on the species detail surface
 * (issue #327 task-10). The photoUrl is intentionally a *.bird-maps.com host
 * so e2e specs can `page.route` it to a 1×1 stub image without external
 * dependencies. The cc-by license code resolves to "CC BY 4.0" /
 * https://creativecommons.org/licenses/by/4.0/ in the AttributionModal.
 */
export const VERMFLY_WITH_PHOTO: SpeciesMeta = {
  ...VERMFLY,
  photoUrl: 'https://photos.bird-maps.com/vermfly.jpg',
  photoAttribution: 'Jane Photographer',
  photoLicense: 'cc-by',
};

/**
 * Vermilion Flycatcher Observation fixture — used by tests that exercise
 * the FiltersBar species typeahead. The datalist + speciesIndex are derived
 * from `useBirdData` observations; the typeahead can only resolve
 * "Vermilion Flycatcher" → "vermfly" if an observation with that
 * (comName, speciesCode) pair is in the list.
 *
 * Required because /api/observations returns aggregated buckets at low zoom
 * (#627) — the default cold-start fetch (CONUS bbox + zoom=3) hits aggregated
 * mode, which carries no per-observation rows. #859 moved species aggregation
 * server-side (each bucket now nests real `AggregatedFamily.species` codes)
 * and deleted the synthetic-observation expansion the frontend used to
 * fabricate from buckets. Tests that rely on the real-species typeahead — which
 * derives from per-observation (comName, speciesCode) pairs — must therefore
 * stub a per-observation payload explicitly.
 */
export const VERMFLY_OBS: Observation[] = [
  {
    subId: 'OBS-VERMFLY-1',
    speciesCode: 'vermfly',
    comName: 'Vermilion Flycatcher',
    lat: 32.2226,
    lng: -110.9747,
    obsDt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    locId: 'L99999',
    locName: 'Tucson, AZ',
    howMany: 1,
    isNotable: false,
    silhouetteId: 'tyrannidae',
    familyCode: 'tyrannidae',
    taxonOrder: 4400,
  },
];

/**
 * Species-dictionary fixture for the bare `GET /api/species` endpoint (#859,
 * `client.ts:168-170`). D2 (#1050) re-pointed the FiltersBar species index at
 * this dictionary (national, filter-independent) so search works at every zoom.
 * fixtures.ts previously stubbed only observations/hotspots/silhouettes/states/
 * zip-index — NOT this endpoint — so without `stubSpeciesDictionary` the
 * dictionary-backed datalist would silently re-point the species specs at the
 * live seeded DB. One row (Vermilion Flycatcher) is enough to resolve
 * "Vermilion Flycatcher" → "vermfly" in the exact-match specs.
 */
export const SPECIES_DICT_FIXTURE: SpeciesDictEntry[] = [
  { code: 'vermfly', comName: 'Vermilion Flycatcher', familyCode: 'tyrannidae' },
];

/**
 * Minimal name-sorted `StateSummary[]` for the scope chooser/control `<select>`
 * (#741). Three CONUS states with real `bbox:[w,s,e,n]` envelopes so the
 * `?state=US-XX` camera `fitBounds`/`maxBounds` derivation in App.tsx has a
 * non-degenerate envelope to frame. Both `<ScopeChooser>` (#742) and the
 * in-state `<ScopeControl>` (#737) fetch `GET /api/states` on mount, so EVERY
 * scope spec must register `stubStates()` — an unstubbed route (the local
 * read-api has no seed in e2e) renders a perpetually-loading / disabled
 * selector. Name-sorted (Arizona < Florida < New York) to mirror the endpoint
 * contract (#732 returns rows name-sorted).
 */
export const STATES_FIXTURE: StateSummary[] = [
  { stateCode: 'US-AZ', name: 'Arizona', bbox: [-114.82, 31.33, -109.04, 37.0] },
  { stateCode: 'US-FL', name: 'Florida', bbox: [-87.63, 24.52, -80.03, 31.0] },
  { stateCode: 'US-NY', name: 'New York', bbox: [-79.76, 40.5, -71.86, 45.02] },
];

/** Columnar on-disk shape of `public/zip-index.json` (D2), mirrored from
 *  `frontend/src/data/zip-lookup.ts::ZipIndex`. */
export interface ZipIndexFixture {
  v: number;
  states: string[];
  zips: Record<string, [number, number, number]>;
}

/**
 * Small canned columnar ZIP index matching the production on-disk shape
 * (`{ v, states, zips }`, D2) consumed by `frontend/src/data/zip-lookup.ts`.
 * `zips` maps ZIP5 → `[lat, lng, stateIdx]` ([lat, lng], NOT MapLibre order —
 * `lookupZip` swaps to `[lng, lat]` on decode). Two entries:
 *   - `85701` → US-AZ (Tucson). After columnar decode → center `[-110.974,
 *     32.222]` ([lng, lat]) inside the Arizona envelope.
 *   - `10001` → US-NY (Manhattan). Lands inside New York — used by the
 *     empty-region case (NY is empty on the AZ-only observation seed).
 * `10002` is deliberately ABSENT so a well-formed-but-unknown ZIP exercises the
 * "ZIP not recognized" path. Never serve the real ~1 MB asset in e2e.
 */
export const ZIP_INDEX_FIXTURE: ZipIndexFixture = {
  v: 1,
  states: ['US-AZ', 'US-NY'],
  zips: {
    // [lat, lng, stateIdx] — lookupZip decodes to center [lng, lat].
    '85701': [32.222, -110.974, 0], // Tucson, AZ
    '10001': [40.7506, -73.9971, 1], // Manhattan, NY
  },
};

/**
 * 1×1 transparent PNG (67 bytes, base64) used by `stubPhotoImage` to satisfy
 * the browser's `<img>` request for `photoUrl`. Returning a real binary keeps
 * the network stack happy: we never load a real photo across the wire from the
 * browser, but the `<img>`'s `load` fires successfully so `onError` is NOT
 * triggered and the photo render branch stays mounted.
 */
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/**
 * Playwright route stubs for the Read API. Each helper registers a single
 * `page.route` handler; route handlers are LIFO, so a later registration
 * wins over an earlier one for the same glob.
 */
export interface ApiStub {
  /**
   * Stubs the three list endpoints (`/api/hotspots`, `/api/observations`,
   * `/api/silhouettes`) to return `200 []`. Does NOT stub
   * `/api/species/{code}` — add that route manually if your test
   * exercises species detail lookup.
   */
  stubEmpty(): Promise<void>;
  /** Stubs `/api/observations` to return `200` with the provided list. */
  stubObservations(obs: Observation[]): Promise<void>;
  /**
   * D2 (#1050) — stubs the BARE `GET /api/species` species dictionary (#859)
   * to return `200` with the provided rows (default `SPECIES_DICT_FIXTURE`).
   * Matched by a URL PREDICATE (pathname ends in exactly `/api/species`, no
   * trailing code segment) — NOT a `**\/api/species**` glob — so it never
   * swallows the per-species detail route `**\/api/species/{code}` that
   * `stubSpecies` and the live dev-server own. The FiltersBar species index
   * (and its datalist) is dictionary-backed post-#1050, so every spec that
   * exercises the species typeahead must register this to stay hermetic.
   */
  stubSpeciesDictionary(entries?: SpeciesDictEntry[]): Promise<void>;
  /**
   * #847 — state-aware, bbox-intersecting `/api/observations` stub. Models the
   * server's `stateCode AND bbox` clip (packages/db-client/src/observations.ts:
   * 184): it parses `state` and `bbox=[w,s,e,n]` off the request URL and returns
   * a state's `rows` ONLY when the requested bbox intersects that state's
   * envelope (looked up from `STATES_FIXTURE` by `stateCode`). A request whose
   * bbox is disjoint from the requested state's envelope — the stale-bbox
   * de-pairing the #847 bug produces — returns a clean empty 200 (zero rows),
   * exactly reproducing "No recent sightings" with no thrown error. A request
   * with no `bbox=` (or no `state=`) returns the state's rows unconditionally
   * (no clip to apply). Pure `page.route`; no DB writes.
   */
  stubStateAwareObservations(rowsByState: Record<string, Observation[]>): Promise<void>;
  /**
   * Stubs `**\/api/states**` to return `200` with the provided name-sorted
   * `StateSummary[]` (default `STATES_FIXTURE`). Both `<ScopeChooser>` (#742)
   * and the in-state `<ScopeControl>` (#737) fetch this on mount, so every
   * scope spec must register it — without it the local read-api (unseeded in
   * e2e) yields an empty/flaky selector.
   */
  stubStates(states?: StateSummary[]): Promise<void>;
  /**
   * Stubs `**\/zip-index.json*` (the trailing `*` matches the
   * `?v=<datasetVersion>` cache-bust suffix `zip-lookup.ts` appends) to return
   * `200` with a small canned columnar index (default `ZIP_INDEX_FIXTURE`).
   * Never serves the real ~1 MB `public/zip-index.json`.
   */
  stubZipIndex(index?: ZipIndexFixture): Promise<void>;
  /**
   * Stubs `**\/api/species/{code}` to return `200` with the provided
   * SpeciesMeta. The glob captures the exact code as a path suffix so
   * other codes fall through to the real dev-server handler (useful when a
   * test selects exactly one species and wants deterministic contents).
   */
  stubSpecies(code: string, meta: SpeciesMeta): Promise<void>;
  /**
   * Stubs `**\/api/${endpoint}**` to respond with HTTP `status` and a
   * `text/plain` body. Use for HTTP-level error paths (500, 401, etc.).
   * The trailing `**` tolerates query strings and sub-paths — endpoints
   * must not share a prefix with a sibling endpoint.
   */
  stubApiFailure(endpoint: StubbableEndpoint, status: number): Promise<void>;
  /**
   * Aborts `**\/api/${endpoint}**` at the network layer (no response).
   * Use for fetch-rejection paths (CORS, offline, DNS failure). For an
   * HTTP-level failure, use `stubApiFailure` instead.
   */
  stubApiAbort(endpoint: StubbableEndpoint): Promise<void>;
  /**
   * Stubs `**\/photos.bird-maps.com/**` with a tiny 1×1 PNG so a
   * `<img src="https://photos.bird-maps.com/...">` request resolves
   * successfully in the browser. Use when a test renders
   * `VERMFLY_WITH_PHOTO` and asserts on the photo branch — without this,
   * the request would either go to the real CDN (real network dependency)
   * or 404 (which would fire the `<img>`'s `onError` and silently switch
   * to the silhouette fallback, masking the photo behavior under test).
   */
  stubPhotoImage(): Promise<void>;
}

export const test = base.extend<{ apiStub: ApiStub }>({
  apiStub: async ({ page }, use) => {
    const stub: ApiStub = {
      async stubEmpty() {
        await page.route('**/api/hotspots', async route => {
          await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        });
        await page.route('**/api/observations**', async route => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            // ObservationsResponse envelope — stubEmpty uses null freshestObservationAt
            body: JSON.stringify({ data: [], meta: { freshestObservationAt: null } }),
          });
        });
        await page.route('**/api/silhouettes', async route => {
          await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        });
      },
      async stubObservations(obs) {
        await page.route('**/api/observations**', async route => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            // ObservationsResponse envelope — freshestObservationAt reflects recent data
            body: JSON.stringify({
              data: obs,
              meta: { freshestObservationAt: new Date(Date.now() - 5 * 60 * 1000).toISOString() },
            }),
          });
        });
      },
      async stubSpeciesDictionary(entries = SPECIES_DICT_FIXTURE) {
        // URL PREDICATE (not a glob): match ONLY the bare dictionary endpoint
        // (pathname ending in `/api/species`), so `/api/species/{code}` (the
        // per-species detail route) falls through to stubSpecies / the live
        // dev-server. A `**/api/species**` glob would wrongly capture both.
        await page.route(
          (url) => url.pathname.endsWith('/api/species'),
          async route => {
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(entries),
            });
          },
        );
      },
      async stubStateAwareObservations(rowsByState) {
        // [w,s,e,n] envelope per state, from STATES_FIXTURE.
        const envByState = new Map<string, [number, number, number, number]>(
          STATES_FIXTURE.map(s => [s.stateCode, s.bbox]),
        );
        const intersects = (
          a: [number, number, number, number],
          b: [number, number, number, number],
        ): boolean => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

        await page.route('**/api/observations**', async route => {
          const url = new URL(route.request().url());
          const state = url.searchParams.get('state');
          const bboxParam = url.searchParams.get('bbox');
          const rows = (state && rowsByState[state]) || [];

          // Apply the server's `stateCode AND bbox` clip: a state's rows are
          // returned only when the requested bbox intersects that state's
          // envelope. No bbox / no known state → no clip (return the rows).
          let clipped = rows;
          if (state && bboxParam) {
            const parts = bboxParam.split(',').map(Number);
            const env = envByState.get(state);
            if (parts.length === 4 && !parts.some(Number.isNaN) && env) {
              const bbox = parts as [number, number, number, number];
              clipped = intersects(bbox, env) ? rows : [];
            }
          }

          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              data: clipped,
              meta: {
                freshestObservationAt:
                  clipped.length > 0
                    ? new Date(Date.now() - 5 * 60 * 1000).toISOString()
                    : null,
              },
            }),
          });
        });
      },
      async stubStates(states = STATES_FIXTURE) {
        await page.route('**/api/states**', async route => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(states),
          });
        });
      },
      async stubZipIndex(index = ZIP_INDEX_FIXTURE) {
        await page.route('**/zip-index.json*', async route => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(index),
          });
        });
      },
      async stubSpecies(code, meta) {
        await page.route(`**/api/species/${code}`, async route => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(meta),
          });
        });
      },
      async stubApiFailure(endpoint, status) {
        await page.route(`**/api/${endpoint}**`, async route => {
          await route.fulfill({
            status,
            contentType: 'text/plain',
            body: `stubbed ${status}`,
          });
        });
      },
      async stubApiAbort(endpoint) {
        await page.route(`**/api/${endpoint}**`, async route => {
          await route.abort();
        });
      },
      async stubPhotoImage() {
        await page.route('**/photos.bird-maps.com/**', async route => {
          await route.fulfill({
            status: 200,
            contentType: 'image/png',
            body: Buffer.from(TINY_PNG_BASE64, 'base64'),
          });
        });
      },
    };
    await use(stub);
  },
});

export { expect } from '@playwright/test';

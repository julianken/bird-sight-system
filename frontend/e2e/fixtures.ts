import { test as base } from '@playwright/test';
import type { Observation, SpeciesMeta } from '@bird-watch/shared-types';

/** Read API endpoints that can be stubbed. Keep in sync with services/read-api/src/app.ts. */
export type StubbableEndpoint = 'hotspots' | 'observations' | 'species' | 'silhouettes';

/**
 * Phenology fixture — 12 non-zero monthly counts for Vermilion Flycatcher.
 * Exercises the happy-path render branch (12 bars, heights scaled to max).
 * The shape is the un-zero-filled wire payload — the component zero-fills
 * to all 12 months internally, but here we emit all 12 to keep the e2e
 * assertion direct (12 bars rendered → 12 rows on the wire).
 */
export const VERMFLY_PHENOLOGY_FULL: Array<{ month: number; count: number }> = [
  { month: 1, count: 8 },
  { month: 2, count: 6 },
  { month: 3, count: 14 },
  { month: 4, count: 22 },
  { month: 5, count: 30 },
  { month: 6, count: 28 },
  { month: 7, count: 26 },
  { month: 8, count: 24 },
  { month: 9, count: 18 },
  { month: 10, count: 12 },
  { month: 11, count: 9 },
  { month: 12, count: 7 },
];

/**
 * Phenology fixture — sparse response (3 months only). Exercises the
 * zero-fill branch: the component must produce 12 bars from a 3-row
 * payload by zero-filling the missing months.
 */
export const VERMFLY_PHENOLOGY_SPARSE: Array<{ month: number; count: number }> = [
  { month: 3, count: 4 },
  { month: 6, count: 8 },
  { month: 9, count: 12 },
];

/**
 * Phenology fixture — empty response. Exercises the placeholder-bars
 * branch: 12 muted bars at 10% height, no crash, no console noise.
 */
export const VERMFLY_PHENOLOGY_EMPTY: Array<{ month: number; count: number }> = [];

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
  /**
   * Stubs `**\/api/species/{code}/phenology` to return `200` with the
   * provided rows. The code is matched as an exact path segment so other
   * codes fall through to the real dev-server handler. Pair with
   * `stubSpecies` when a test renders the SpeciesDetailSurface — the
   * chart component fires its fetch from inside the `data && (...)` block
   * once the species itself resolves.
   */
  stubPhenology(
    code: string,
    rows: Array<{ month: number; count: number }>,
  ): Promise<void>;
}

export const test = base.extend<{ apiStub: ApiStub }>({
  apiStub: async ({ page }, use) => {
    const stub: ApiStub = {
      async stubEmpty() {
        await page.route('**/api/hotspots', async route => {
          await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        });
        await page.route('**/api/observations**', async route => {
          await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
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
            body: JSON.stringify(obs),
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
      async stubPhenology(code, rows) {
        await page.route(`**/api/species/${code}/phenology`, async route => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(rows),
          });
        });
      },
    };
    await use(stub);
  },
});

export { expect } from '@playwright/test';

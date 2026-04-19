import { test as base } from '@playwright/test';
import type { Observation } from '@bird-watch/shared-types';

/**
 * Playwright route stubs for the Read API. Each helper registers a single
 * `page.route` handler; route handlers are LIFO, so a later registration
 * wins over an earlier one for the same glob.
 */
export interface ApiStub {
  /**
   * Stubs the three list endpoints (`/api/regions`, `/api/hotspots`,
   * `/api/observations`) to return `200 []`. Does NOT stub
   * `/api/species/{code}` — add that route manually if your test
   * exercises species detail lookup.
   */
  stubEmpty(): Promise<void>;
  /** Stubs `/api/observations` to return `200` with the provided list. */
  stubObservations(obs: Observation[]): Promise<void>;
  /**
   * Stubs `**\/api/${endpoint}**` to respond with HTTP `status` and a
   * `text/plain` body. Use for HTTP-level error paths (500, 401, etc.).
   * The trailing `**` tolerates query strings and sub-paths — endpoints
   * must not share a prefix with a sibling endpoint.
   */
  stubApiFailure(endpoint: string, status: number): Promise<void>;
  /**
   * Aborts `**\/api/${endpoint}**` at the network layer (no response).
   * Use for fetch-rejection paths (CORS, offline, DNS failure). For an
   * HTTP-level failure, use `stubApiFailure` instead.
   */
  stubApiAbort(endpoint: string): Promise<void>;
}

export const test = base.extend<{ apiStub: ApiStub }>({
  apiStub: async ({ page }, use) => {
    const stub: ApiStub = {
      async stubEmpty() {
        await page.route('**/api/regions', async route => {
          await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        });
        await page.route('**/api/hotspots', async route => {
          await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        });
        await page.route('**/api/observations**', async route => {
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
    };
    await use(stub);
  },
});

export { expect } from '@playwright/test';

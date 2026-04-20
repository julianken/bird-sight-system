import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { EbirdClient, EbirdClientError, EbirdServerError } from './client.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const SAMPLE_OBS = [
  {
    speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
    sciName: 'Pyrocephalus rubinus', locId: 'L101234', locName: 'Madera Canyon',
    obsDt: '2026-04-15 08:00', howMany: 2, lat: 31.72, lng: -110.88,
    obsValid: true, obsReviewed: false, locationPrivate: false, subId: 'S100',
  },
];

describe('EbirdClient.fetchRecent', () => {
  it('returns observations for a region', async () => {
    server.use(
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent', ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('back')).toBe('14');
        expect(request.headers.get('x-ebirdapitoken')).toBe('test-key');
        return HttpResponse.json(SAMPLE_OBS);
      })
    );
    const client = new EbirdClient({ apiKey: 'test-key' });
    const obs = await client.fetchRecent('US-AZ', { back: 14 });
    expect(obs).toHaveLength(1);
    expect(obs[0]?.speciesCode).toBe('vermfly');
  });
});

describe('EbirdClient.fetchNotable', () => {
  it('returns notable observations only', async () => {
    server.use(
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent/notable', () => {
        return HttpResponse.json([{ ...SAMPLE_OBS[0], speciesCode: 'eltrog' }]);
      })
    );
    const client = new EbirdClient({ apiKey: 'k' });
    const obs = await client.fetchNotable('US-AZ');
    expect(obs[0]?.speciesCode).toBe('eltrog');
  });
});

describe('EbirdClient.fetchHotspots', () => {
  it('returns hotspots for a region', async () => {
    server.use(
      http.get('https://api.ebird.org/v2/ref/hotspot/US-AZ', () => {
        return HttpResponse.json([
          { locId: 'L1', locName: 'Sweetwater', countryCode: 'US',
            subnational1Code: 'US-AZ', lat: 32.30, lng: -110.99,
            numSpeciesAllTime: 280 },
        ]);
      })
    );
    const client = new EbirdClient({ apiKey: 'k' });
    const h = await client.fetchHotspots('US-AZ');
    expect(h[0]?.locId).toBe('L1');
    expect(h[0]?.numSpeciesAllTime).toBe(280);
  });
});

describe('EbirdClient.fetchTaxonomy', () => {
  it('returns the full eBird taxonomy with species and non-species categories', async () => {
    server.use(
      http.get('https://api.ebird.org/v2/ref/taxonomy/ebird', ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('cat')).toBe('species');
        expect(url.searchParams.get('fmt')).toBe('json');
        expect(url.searchParams.get('locale')).toBe('en');
        // eBird's /ref/taxonomy/ebird requires a NUMERIC version (e.g. 2024) OR
        // no version param (defaults to latest). Sending `version=latest` makes
        // the endpoint 400 with typeMismatch. We drop the param entirely.
        expect(url.searchParams.has('version')).toBe(false);
        expect(request.headers.get('x-ebirdapitoken')).toBe('test-key');
        return HttpResponse.json([
          {
            sciName: 'Pyrocephalus rubinus',
            comName: 'Vermilion Flycatcher',
            speciesCode: 'verfly',
            category: 'species',
            taxonOrder: 30501,
            bandingCodes: ['VEFL'],
            comNameCodes: ['VEFL'],
            sciNameCodes: ['PYRU'],
            order: 'Passeriformes',
            familyCode: 'tyrann1',
            familyComName: 'Tyrant Flycatchers',
            familySciName: 'Tyrannidae',
          },
        ]);
      })
    );
    const client = new EbirdClient({ apiKey: 'test-key' });
    const taxa = await client.fetchTaxonomy();
    expect(taxa).toHaveLength(1);
    expect(taxa[0]?.speciesCode).toBe('verfly');
    expect(taxa[0]?.familyComName).toBe('Tyrant Flycatchers');
    expect(taxa[0]?.familyCode).toBe('tyrann1');
    expect(taxa[0]?.taxonOrder).toBe(30501);
    expect(taxa[0]?.category).toBe('species');
  });

  // Regression guard for the prod failure that shipped in PR #84 (commit
  // 24c93d89): the first taxonomy Cloud Run Job 400'd with
  //   {"errors":[{"status":"400 BAD_REQUEST","code":"typeMismatch",
  //     "title":"Field version of taxaRefCmd: This field must be a number."}]}
  // because the client sent `version=latest`. If someone re-introduces the
  // param, this test simulates eBird's real response and asserts the client
  // surfaces it as EbirdClientError(400).
  it('surfaces eBird 400 typeMismatch when version=latest is sent (regression)', async () => {
    server.use(
      http.get('https://api.ebird.org/v2/ref/taxonomy/ebird', ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('version') === 'latest') {
          return HttpResponse.json(
            {
              errors: [
                {
                  status: '400 BAD_REQUEST',
                  code: 'typeMismatch',
                  title:
                    'Field version of taxaRefCmd: This field must be a number.',
                },
              ],
            },
            { status: 400 }
          );
        }
        return HttpResponse.json([]);
      })
    );
    // Intentionally reach past fetchTaxonomy() — which no longer sets version —
    // and verify the client-level behavior when a 400 *does* come back, proving
    // the error path is intact and a re-introduction of the bad param would
    // fail loudly instead of silently returning [].
    const client = new EbirdClient({
      apiKey: 'test-key',
      retryBaseMs: 1,
      maxRetries: 5,
    });
    // Drive the failure by hitting the same URL with version=latest directly.
    const url = new URL(
      'https://api.ebird.org/v2/ref/taxonomy/ebird?cat=species&fmt=json&locale=en&version=latest'
    );
    const err = await (client as unknown as {
      getJson: (u: URL) => Promise<unknown>;
    })
      .getJson(url)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EbirdClientError);
    const clientErr = err as EbirdClientError;
    expect(clientErr.status).toBe(400);
    expect(clientErr.body).toContain('typeMismatch');
    expect(clientErr.body).toContain('This field must be a number');
  });

  // Direct regression test against the public fetchTaxonomy() surface: if
  // anyone re-introduces `version=latest` (or any non-numeric version),
  // fetchTaxonomy() must reject — not silently return []. The MSW handler
  // returns a 400 whenever version is present; with the fix, no version is
  // sent and the request succeeds.
  it('fetchTaxonomy() does not send a version param (handler would 400 if it did)', async () => {
    server.use(
      http.get('https://api.ebird.org/v2/ref/taxonomy/ebird', ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.has('version')) {
          return HttpResponse.json(
            {
              errors: [
                {
                  status: '400 BAD_REQUEST',
                  code: 'typeMismatch',
                  title:
                    'Field version of taxaRefCmd: This field must be a number.',
                },
              ],
            },
            { status: 400 }
          );
        }
        return HttpResponse.json([]);
      })
    );
    const client = new EbirdClient({ apiKey: 'test-key' });
    // With the fix this resolves (empty array); against the bad code this
    // rejects with EbirdClientError(400) — so this test fails loudly if the
    // param is re-added.
    await expect(client.fetchTaxonomy()).resolves.toEqual([]);
  });
});

describe('EbirdClient retries', () => {
  it('retries on 5xx and eventually succeeds', async () => {
    let calls = 0;
    server.use(
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent', () => {
        calls++;
        if (calls < 3) return new HttpResponse('boom', { status: 503 });
        return HttpResponse.json(SAMPLE_OBS);
      })
    );
    const client = new EbirdClient({ apiKey: 'k', retryBaseMs: 1, maxRetries: 5 });
    const obs = await client.fetchRecent('US-AZ');
    expect(calls).toBe(3);
    expect(obs).toHaveLength(1);
  });

  it('throws immediately on 4xx (no retry)', async () => {
    let calls = 0;
    server.use(
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent', () => {
        calls++;
        return new HttpResponse('forbidden', { status: 403 });
      })
    );
    const client = new EbirdClient({ apiKey: 'k', retryBaseMs: 1, maxRetries: 5 });
    await expect(client.fetchRecent('US-AZ')).rejects.toThrow(/403/);
    expect(calls).toBe(1);
  });

  it('throws after exhausting retries on 5xx', async () => {
    let calls = 0;
    server.use(
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent', () => {
        calls++;
        return new HttpResponse('always broken', { status: 502 });
      })
    );
    const client = new EbirdClient({ apiKey: 'k', retryBaseMs: 1, maxRetries: 2 });
    await expect(client.fetchRecent('US-AZ')).rejects.toThrow(/502/);
    expect(calls).toBe(3); // 1 initial + 2 retries
  });

  it('retries on request timeout then throws EbirdServerError', async () => {
    let calls = 0;
    server.use(
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent', async () => {
        calls++;
        await new Promise(r => setTimeout(r, 50));
        return HttpResponse.json([]);
      })
    );
    const client = new EbirdClient({ apiKey: 'k', maxRetries: 1, retryBaseMs: 1, requestTimeoutMs: 5 });
    await expect(client.fetchRecent('US-AZ')).rejects.toThrow(EbirdServerError);
    expect(calls).toBe(2); // initial + 1 retry
  });
});

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { EbirdClient, EbirdServerError } from './client.js';

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

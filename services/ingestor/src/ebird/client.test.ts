import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { EbirdClient } from './client.js';

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

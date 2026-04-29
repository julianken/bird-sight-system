import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { fetchInatPhoto } from './client.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const INAT_OBSERVATIONS_URL = 'https://api.inaturalist.org/v1/observations';

describe('fetchInatPhoto', () => {
  it('fetchBestPhoto returns InatPhoto for cc-licensed research-grade hit', async () => {
    server.use(
      http.get(INAT_OBSERVATIONS_URL, ({ request }) => {
        const url = new URL(request.url);
        // Verify the full query-param contract from the issue spec.
        expect(url.searchParams.get('taxon_name')).toBe('Pyrocephalus rubinus');
        expect(url.searchParams.get('place_id')).toBe('40'); // Arizona
        expect(url.searchParams.get('quality_grade')).toBe('research');
        expect(url.searchParams.get('photo_license')).toBe('cc-by,cc-by-sa,cc0');
        expect(url.searchParams.get('order_by')).toBe('votes');
        expect(url.searchParams.get('per_page')).toBe('1');
        expect(url.searchParams.get('photos')).toBe('true');
        // iNat recommended-practices doc requires a meaningful UA.
        expect(request.headers.get('User-Agent')).toMatch(/bird-maps\.com/);
        return HttpResponse.json({
          total_results: 1,
          page: 1,
          per_page: 1,
          results: [
            {
              photos: [
                {
                  url: 'https://inaturalist-open-data.s3.amazonaws.com/photos/12345/square.jpg',
                  attribution: '(c) Jane Doe, some rights reserved (CC BY)',
                  license_code: 'cc-by',
                },
              ],
            },
          ],
        });
      })
    );

    const photo = await fetchInatPhoto('Pyrocephalus rubinus');

    expect(photo).not.toBeNull();
    expect(photo).toEqual({
      url: 'https://inaturalist-open-data.s3.amazonaws.com/photos/12345/medium.jpg',
      attribution: '(c) Jane Doe, some rights reserved (CC BY)',
      license: 'cc-by',
    });
    // Defensive: the size substitution must replace 'square', not produce a
    // 75px thumbnail in the detail panel.
    expect(photo?.url).not.toContain('square');
    expect(photo?.url).toContain('medium');
  });

  it('fetchBestPhoto returns null on zero results', async () => {
    server.use(
      http.get(INAT_OBSERVATIONS_URL, () => {
        return HttpResponse.json({
          total_results: 0,
          page: 1,
          per_page: 1,
          results: [],
        });
      })
    );

    const photo = await fetchInatPhoto('Imaginarius nonexistens');
    expect(photo).toBeNull();
  });

  it('fetchBestPhoto retries once on 429', async () => {
    let calls = 0;
    server.use(
      http.get(INAT_OBSERVATIONS_URL, () => {
        calls++;
        if (calls === 1) {
          return new HttpResponse('rate limited', { status: 429 });
        }
        return HttpResponse.json({
          total_results: 1,
          page: 1,
          per_page: 1,
          results: [
            {
              photos: [
                {
                  url: 'https://example.org/photos/1/square.jpg',
                  attribution: '(c) Bob, CC0',
                  license_code: 'cc0',
                },
              ],
            },
          ],
        });
      })
    );

    const photo = await fetchInatPhoto('Pyrocephalus rubinus', {
      retryBaseMs: 1,
    });

    expect(calls).toBe(2);
    expect(photo).not.toBeNull();
    expect(photo?.license).toBe('cc0');
    expect(photo?.url).toContain('medium.jpg');
  });
});

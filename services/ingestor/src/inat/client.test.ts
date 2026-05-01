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

  it('fetchBestPhoto returns null on zero results across all three tiers', async () => {
    let calls = 0;
    server.use(
      http.get(INAT_OBSERVATIONS_URL, () => {
        calls++;
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
    // Tier cascade: AZ → US → global, so an exhaustive miss touches iNat 3
    // times. Anything other than 3 means the cascade is short-circuiting or
    // looping — both regressions on this PR's contract.
    expect(calls).toBe(3);
  });

  it('Tier 1 (place_id=40) hit short-circuits the cascade', async () => {
    let calls = 0;
    const placeIds: (string | null)[] = [];
    server.use(
      http.get(INAT_OBSERVATIONS_URL, ({ request }) => {
        calls++;
        const url = new URL(request.url);
        placeIds.push(url.searchParams.get('place_id'));
        return HttpResponse.json({
          total_results: 1,
          page: 1,
          per_page: 1,
          results: [
            {
              photos: [
                {
                  url: 'https://example.org/photos/az/square.jpg',
                  attribution: '(c) AZ Photographer, CC BY',
                  license_code: 'cc-by',
                },
              ],
            },
          ],
        });
      })
    );

    const photo = await fetchInatPhoto('Pyrocephalus rubinus');

    expect(calls).toBe(1);
    expect(placeIds).toEqual(['40']);
    expect(photo?.url).toBe('https://example.org/photos/az/medium.jpg');
    expect(photo?.license).toBe('cc-by');
  });

  it('Tier 2 (place_id=1, US) hit when AZ is empty', async () => {
    let calls = 0;
    const placeIds: (string | null)[] = [];
    server.use(
      http.get(INAT_OBSERVATIONS_URL, ({ request }) => {
        calls++;
        const url = new URL(request.url);
        placeIds.push(url.searchParams.get('place_id'));
        if (calls === 1) {
          // AZ tier — empty
          return HttpResponse.json({
            total_results: 0,
            page: 1,
            per_page: 1,
            results: [],
          });
        }
        // US tier — hit
        return HttpResponse.json({
          total_results: 1,
          page: 1,
          per_page: 1,
          results: [
            {
              photos: [
                {
                  url: 'https://example.org/photos/us/square.jpg',
                  attribution: '(c) US Photographer, CC BY-SA',
                  license_code: 'cc-by-sa',
                },
              ],
            },
          ],
        });
      })
    );

    const photo = await fetchInatPhoto('Anser aegyptiaca');

    expect(calls).toBe(2);
    // Tier order is documented in the cascade — AZ (40) then US (1). place_id=1
    // is iNat's canonical "United States" Place per
    // https://api.inaturalist.org/v1/places/1.
    expect(placeIds).toEqual(['40', '1']);
    expect(photo?.url).toBe('https://example.org/photos/us/medium.jpg');
    expect(photo?.license).toBe('cc-by-sa');
  });

  it('Tier 3 (no place_id, global) hit when AZ and US are empty', async () => {
    let calls = 0;
    const placeIdParams: (string | null)[] = [];
    const hadPlaceIdKey: boolean[] = [];
    server.use(
      http.get(INAT_OBSERVATIONS_URL, ({ request }) => {
        calls++;
        const url = new URL(request.url);
        placeIdParams.push(url.searchParams.get('place_id'));
        hadPlaceIdKey.push(url.searchParams.has('place_id'));
        if (calls < 3) {
          return HttpResponse.json({
            total_results: 0,
            page: 1,
            per_page: 1,
            results: [],
          });
        }
        return HttpResponse.json({
          total_results: 1,
          page: 1,
          per_page: 1,
          results: [
            {
              photos: [
                {
                  url: 'https://example.org/photos/global/square.jpg',
                  attribution: '(c) Global Photographer, CC0',
                  license_code: 'cc0',
                },
              ],
            },
          ],
        });
      })
    );

    const photo = await fetchInatPhoto('Larus occidentalis');

    expect(calls).toBe(3);
    expect(placeIdParams.slice(0, 2)).toEqual(['40', '1']);
    // Tier 3 must omit `place_id` entirely, not pass an empty string. iNat
    // treats `place_id=` as a malformed filter on some routes.
    expect(hadPlaceIdKey[2]).toBe(false);
    expect(photo?.url).toBe('https://example.org/photos/global/medium.jpg');
    expect(photo?.license).toBe('cc0');
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

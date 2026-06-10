import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { fetchInatCandidates } from './candidates.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const INAT_OBSERVATIONS_URL = 'https://api.inaturalist.org/v1/observations';

// Pin the cascade to a single region tier so each test makes exactly one iNat
// call unless it is specifically exercising the cascade. `tiers` is the
// test-only seam (see the Test-seam note in the issue body); production callers
// never pass it.
const SINGLE_TIER = [{ label: 'region' as const, placeId: '40' }];

// Build an iNat observations payload with N photo-bearing results.
function obs(items: Array<{ id: number; photo: string; attr: string; lic: string }>) {
  return {
    total_results: items.length,
    page: 1,
    per_page: items.length,
    results: items.map((it) => ({
      id: it.id,
      photos: [{ url: it.photo, attribution: it.attr, license_code: it.lic }],
    })),
  };
}

describe('fetchInatCandidates — top-N parse', () => {
  it('returns up to `limit` candidates ordered by votes, each as InatCandidate', async () => {
    server.use(
      http.get(INAT_OBSERVATIONS_URL, ({ request }) => {
        const url = new URL(request.url);
        // Query contract: top-N (per_page=limit), votes order, research grade,
        // CC allowlist, photos-only — same constraints as the single-photo path
        // except per_page is the requested N, not 1.
        expect(url.searchParams.get('taxon_name')).toBe('Cardinalis cardinalis');
        expect(url.searchParams.get('quality_grade')).toBe('research');
        expect(url.searchParams.get('photo_license')).toBe('cc-by,cc-by-sa,cc0');
        expect(url.searchParams.get('order_by')).toBe('votes');
        expect(url.searchParams.get('per_page')).toBe('15');
        expect(url.searchParams.get('photos')).toBe('true');
        expect(request.headers.get('User-Agent')).toMatch(/bird-maps\.com/);
        return HttpResponse.json(
          obs([
            { id: 101, photo: 'https://ex.org/photos/101/square.jpg', attr: '(c) A, CC BY', lic: 'cc-by' },
            { id: 102, photo: 'https://ex.org/photos/102/square.jpg', attr: '(c) B, CC BY-SA', lic: 'cc-by-sa' },
            { id: 103, photo: 'https://ex.org/photos/103/square.jpg', attr: '(c) C, CC0', lic: 'cc0' },
          ])
        );
      })
    );

    const out = await fetchInatCandidates('Cardinalis cardinalis', {
      limit: 15,
      tiers: SINGLE_TIER,
    });

    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({
      inatId: 101,
      photoUrl: 'https://ex.org/photos/101/medium.jpg', // square→medium substitution
      attribution: '(c) A, CC BY',
      license: 'cc-by',
    });
    // Votes order is preserved (iNat returns ordered; we don't re-sort without a denyContext).
    expect(out.map((c) => c.inatId)).toEqual([101, 102, 103]);
    // No square thumbnails leak through.
    expect(out.every((c) => c.photoUrl.includes('medium'))).toBe(true);
  });

  it('caps the returned array at `limit` even when iNat returns more', async () => {
    server.use(
      http.get(INAT_OBSERVATIONS_URL, () =>
        HttpResponse.json(
          obs(
            Array.from({ length: 20 }, (_, i) => ({
              id: 200 + i,
              photo: `https://ex.org/photos/${200 + i}/square.jpg`,
              attr: `(c) P${i}, CC0`,
              lic: 'cc0',
            }))
          )
        )
      )
    );

    const out = await fetchInatCandidates('Cardinalis cardinalis', {
      limit: 12,
      tiers: SINGLE_TIER,
    });
    expect(out).toHaveLength(12);
    expect(out.map((c) => c.inatId)).toEqual(
      Array.from({ length: 12 }, (_, i) => 200 + i)
    );
  });
});

describe('fetchInatCandidates — license filtering', () => {
  it('drops candidates whose license is NC/ND or missing in a malformed payload', async () => {
    server.use(
      http.get(INAT_OBSERVATIONS_URL, ({ request }) => {
        // The CC allowlist is always sent to iNat (server-side filter).
        const url = new URL(request.url);
        expect(url.searchParams.get('photo_license')).toBe('cc-by,cc-by-sa,cc0');
        // iNat *should* honor it, but defend against a leaked NC/ND/null row.
        return HttpResponse.json({
          total_results: 4,
          page: 1,
          per_page: 4,
          results: [
            { id: 1, photos: [{ url: 'https://ex.org/photos/1/square.jpg', attribution: '(c) A, CC BY', license_code: 'cc-by' }] },
            { id: 2, photos: [{ url: 'https://ex.org/photos/2/square.jpg', attribution: '(c) B, CC BY-NC', license_code: 'cc-by-nc' }] },
            { id: 3, photos: [{ url: 'https://ex.org/photos/3/square.jpg', attribution: '(c) C, CC BY-ND', license_code: 'cc-by-nd' }] },
            { id: 4, photos: [{ url: 'https://ex.org/photos/4/square.jpg', attribution: '(c) D, ARR', license_code: null }] },
          ],
        });
      })
    );

    const out = await fetchInatCandidates('Cardinalis cardinalis', {
      limit: 10,
      tiers: SINGLE_TIER,
    });

    // Only the cc-by row survives the client-side allowlist backstop.
    expect(out.map((c) => c.inatId)).toEqual([1]);
    expect(out.every((c) => ['cc-by', 'cc-by-sa', 'cc0'].includes(c.license))).toBe(true);
  });

  it('cascades region → US → global, first non-empty tier wins', async () => {
    let calls = 0;
    const placeIds: (string | null)[] = [];
    server.use(
      http.get(INAT_OBSERVATIONS_URL, ({ request }) => {
        calls++;
        placeIds.push(new URL(request.url).searchParams.get('place_id'));
        if (calls < 3) {
          return HttpResponse.json({ total_results: 0, page: 1, per_page: 10, results: [] });
        }
        return HttpResponse.json(
          obs([{ id: 9, photo: 'https://ex.org/photos/9/square.jpg', attr: '(c) G, CC0', lic: 'cc0' }])
        );
      })
    );

    const out = await fetchInatCandidates('Larus occidentalis', {
      limit: 10,
      tiers: [
        { label: 'region', placeId: '40' },
        { label: 'us', placeId: '1' },
        { label: 'global', placeId: null },
      ],
    });

    expect(calls).toBe(3);
    expect(placeIds).toEqual(['40', '1', null]);
    expect(out.map((c) => c.inatId)).toEqual([9]);
  });
});

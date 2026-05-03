import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { fetchInatTaxon, fetchInatTaxonSummary } from './taxon-client.js';
import { InatClientError } from './client.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const INAT_TAXA_URL = 'https://api.inaturalist.org/v1/taxa';

describe('fetchInatTaxon', () => {
  it('returns { inatTaxonId, wikipediaUrl } on exact-match species', async () => {
    server.use(
      http.get(INAT_TAXA_URL, ({ request }) => {
        const url = new URL(request.url);
        // Verify the full query-param contract from the issue spec.
        expect(url.searchParams.get('q')).toBe('Setophaga coronata');
        expect(url.searchParams.get('rank')).toBe('species');
        expect(url.searchParams.get('is_active')).toBe('true');
        expect(url.searchParams.get('per_page')).toBe('1');
        // iNat recommended-practices doc requires a meaningful UA.
        expect(request.headers.get('User-Agent')).toMatch(/bird-maps\.com/);
        return HttpResponse.json({
          total_results: 1,
          page: 1,
          per_page: 1,
          results: [
            {
              id: 9083,
              name: 'Setophaga coronata',
              rank: 'species',
              matched_term: 'Setophaga coronata',
              wikipedia_url:
                'https://en.wikipedia.org/wiki/Yellow-rumped_warbler',
            },
          ],
        });
      })
    );

    const taxon = await fetchInatTaxon('Setophaga coronata');

    expect(taxon).not.toBeNull();
    expect(taxon).toEqual({
      inatTaxonId: 9083,
      wikipediaUrl: 'https://en.wikipedia.org/wiki/Yellow-rumped_warbler',
    });
  });

  it('resolves a trinomial (subspecies) to the canonical species via matched_term', async () => {
    // iNat's `rank=species` filter forces results to species-level; the
    // matched_term echoes "Setophaga coronata coronata" but `id` and `name`
    // belong to the species, not the subspecies. This is what makes the single
    // /v1/taxa call sufficient for both subspecies and synonym lookups.
    server.use(
      http.get(INAT_TAXA_URL, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('q')).toBe('Setophaga coronata coronata');
        expect(url.searchParams.get('rank')).toBe('species');
        return HttpResponse.json({
          total_results: 1,
          page: 1,
          per_page: 1,
          results: [
            {
              id: 9083,
              name: 'Setophaga coronata',
              rank: 'species',
              matched_term: 'Setophaga coronata coronata',
              wikipedia_url:
                'https://en.wikipedia.org/wiki/Yellow-rumped_warbler',
            },
          ],
        });
      })
    );

    const taxon = await fetchInatTaxon('Setophaga coronata coronata');

    // The species-level inatTaxonId is what gets persisted in
    // `species_meta.inat_taxon_id` (child #371) — never the subspecies-level
    // id, which would silently break per-id Wikipedia lookups in #374.
    expect(taxon?.inatTaxonId).toBe(9083);
    expect(taxon?.wikipediaUrl).toBe(
      'https://en.wikipedia.org/wiki/Yellow-rumped_warbler'
    );
  });

  it('resolves a cross-genus synonym (Dendroica → Setophaga) via matched_term', async () => {
    // Dendroica coronata is the obsolete genus name for Setophaga coronata
    // (split formalised by AOU 50th supplement, 2009). iNat's synonym table
    // resolves the obsolete binomial to the current species in a single call.
    server.use(
      http.get(INAT_TAXA_URL, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('q')).toBe('Dendroica coronata');
        return HttpResponse.json({
          total_results: 1,
          page: 1,
          per_page: 1,
          results: [
            {
              id: 9083,
              name: 'Setophaga coronata',
              rank: 'species',
              matched_term: 'Dendroica coronata',
              wikipedia_url:
                'https://en.wikipedia.org/wiki/Yellow-rumped_warbler',
            },
          ],
        });
      })
    );

    const taxon = await fetchInatTaxon('Dendroica coronata');

    expect(taxon?.inatTaxonId).toBe(9083);
    expect(taxon?.wikipediaUrl).toBe(
      'https://en.wikipedia.org/wiki/Yellow-rumped_warbler'
    );
  });

  it('returns null on zero results', async () => {
    server.use(
      http.get(INAT_TAXA_URL, () =>
        HttpResponse.json({
          total_results: 0,
          page: 1,
          per_page: 1,
          results: [],
        })
      )
    );

    const taxon = await fetchInatTaxon('Imaginarius nonexistens');
    expect(taxon).toBeNull();
  });

  it('surfaces wikipedia_url: null in the response as wikipediaUrl: null', async () => {
    // Some species have an iNat taxon record but no Wikipedia cross-reference
    // (rare splits, regional lumps). The helper must not coerce null to "" or
    // a string "null" — child #374's per-id fetch needs to detect the absence
    // and fall back to the iNat-summary path.
    server.use(
      http.get(INAT_TAXA_URL, () =>
        HttpResponse.json({
          total_results: 1,
          page: 1,
          per_page: 1,
          results: [
            {
              id: 12345,
              name: 'Some Species',
              rank: 'species',
              matched_term: 'Some Species',
              wikipedia_url: null,
            },
          ],
        })
      )
    );

    const taxon = await fetchInatTaxon('Some Species');

    expect(taxon).toEqual({ inatTaxonId: 12345, wikipediaUrl: null });
  });

  it('retries once on 429 and succeeds on the second attempt', async () => {
    let calls = 0;
    server.use(
      http.get(INAT_TAXA_URL, () => {
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
              id: 9083,
              name: 'Setophaga coronata',
              rank: 'species',
              matched_term: 'Setophaga coronata',
              wikipedia_url:
                'https://en.wikipedia.org/wiki/Yellow-rumped_warbler',
            },
          ],
        });
      })
    );

    const taxon = await fetchInatTaxon('Setophaga coronata', {
      retryBaseMs: 1,
    });

    expect(calls).toBe(2);
    expect(taxon?.inatTaxonId).toBe(9083);
  });

  it('throws InatClientError on 4xx (non-429) without retry', async () => {
    let calls = 0;
    server.use(
      http.get(INAT_TAXA_URL, () => {
        calls++;
        return new HttpResponse('bad request', { status: 400 });
      })
    );

    await expect(fetchInatTaxon('Bad Query')).rejects.toBeInstanceOf(
      InatClientError
    );
    // 400 is a programming error — retrying would obscure the bug. Confirm we
    // didn't retry.
    expect(calls).toBe(1);
  });
});

describe('fetchInatTaxonSummary', () => {
  // Hits iNat's per-id `/v1/taxa/{id}` endpoint, which is the only iNat
  // endpoint that surfaces `wikipedia_summary` (the search endpoint at
  // `/v1/taxa?q=...` does NOT — confirmed at #369). Used by run-descriptions'
  // Wikipedia-404 fallback branch: when Wikipedia REST returns null for a
  // species page, the orchestrator calls this helper with the cached
  // species_meta.inat_taxon_id and writes the returned summary as a row with
  // source='inat'.
  //
  // Same retry/UA/timeout shape as fetchInatTaxon — both share `getJsonWithRetry`
  // out of `inat/client.ts`.

  it('returns { wikipediaSummary } on a 200 with a non-null wikipedia_summary', async () => {
    server.use(
      http.get(`${INAT_TAXA_URL}/9083`, ({ request }) => {
        // The per-id endpoint is `/v1/taxa/{id}` — no query params required.
        // iNat recommended-practices doc requires a meaningful UA.
        expect(request.headers.get('User-Agent')).toMatch(/bird-maps\.com/);
        return HttpResponse.json({
          total_results: 1,
          page: 1,
          per_page: 1,
          results: [
            {
              id: 9083,
              name: 'Setophaga coronata',
              rank: 'species',
              wikipedia_summary:
                'The yellow-rumped warbler (Setophaga coronata) is a regular North American bird species that can be commonly observed all across the continent.',
              wikipedia_url:
                'https://en.wikipedia.org/wiki/Yellow-rumped_warbler',
            },
          ],
        });
      })
    );

    const result = await fetchInatTaxonSummary(9083);

    expect(result).not.toBeNull();
    expect(result?.wikipediaSummary).toMatch(/yellow-rumped warbler/i);
  });

  it('returns { wikipediaSummary: null } when the taxon record omits or nulls wikipedia_summary', async () => {
    // Some taxa have an iNat record but no Wikipedia article cross-reference
    // (rare splits, regional lumps). The helper must not coerce null to "" or
    // a string "null"; the orchestrator detects null to bail out of the
    // fallback branch entirely (no row written, descriptionsSkipped++).
    server.use(
      http.get(`${INAT_TAXA_URL}/12345`, () =>
        HttpResponse.json({
          total_results: 1,
          page: 1,
          per_page: 1,
          results: [
            {
              id: 12345,
              name: 'Some Species',
              rank: 'species',
              wikipedia_summary: null,
              wikipedia_url: null,
            },
          ],
        })
      )
    );

    const result = await fetchInatTaxonSummary(12345);

    expect(result).toEqual({ wikipediaSummary: null });
  });

  it('returns null when iNat reports zero results for the id', async () => {
    // iNat's per-id endpoint can return a body shaped like
    // `{ total_results: 0, results: [] }` for soft-deleted / merged taxa.
    // Match fetchInatTaxon's null-on-empty contract.
    server.use(
      http.get(`${INAT_TAXA_URL}/99999`, () =>
        HttpResponse.json({
          total_results: 0,
          page: 1,
          per_page: 1,
          results: [],
        })
      )
    );

    const result = await fetchInatTaxonSummary(99999);
    expect(result).toBeNull();
  });

  it('retries once on 429 and succeeds on the second attempt', async () => {
    let calls = 0;
    server.use(
      http.get(`${INAT_TAXA_URL}/9083`, () => {
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
              id: 9083,
              name: 'Setophaga coronata',
              rank: 'species',
              wikipedia_summary: 'A summary that survives the retry path.',
            },
          ],
        });
      })
    );

    const result = await fetchInatTaxonSummary(9083, { retryBaseMs: 1 });

    expect(calls).toBe(2);
    expect(result?.wikipediaSummary).toBe('A summary that survives the retry path.');
  });

  it('throws InatClientError on 4xx (non-429) without retry', async () => {
    let calls = 0;
    server.use(
      http.get(`${INAT_TAXA_URL}/0`, () => {
        calls++;
        return new HttpResponse('bad request', { status: 400 });
      })
    );

    await expect(fetchInatTaxonSummary(0)).rejects.toBeInstanceOf(
      InatClientError
    );
    expect(calls).toBe(1);
  });
});

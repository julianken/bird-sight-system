import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { fetchWikipediaLeadImage } from './lead-image.js';

// MSW v2 (`http.get` + `HttpResponse`). Mirrors the convention in client.test.ts.
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Endpoints used by the lead-image client. The summary endpoint surfaces the
// `originalimage.source` URL; the action API's `imageinfo` query (with
// `iiprop=extmetadata`) surfaces license, artist, and a usable attribution
// URL for the underlying Commons file. Both are documented on Wikipedia and
// stable enough to drift only on major API revisions.
const WIKI_SUMMARY_URL =
  'https://en.wikipedia.org/api/rest_v1/page/summary/:title';
const WIKI_ACTION_URL = 'https://en.wikipedia.org/w/api.php';

describe('fetchWikipediaLeadImage', () => {
  it('returns lead image URL + attribution when summary has originalimage AND action API returns extmetadata', async () => {
    server.use(
      http.get(WIKI_SUMMARY_URL, ({ request, params }) => {
        expect(params.title).toBe('Sulphur-bellied_flycatcher');
        expect(request.headers.get('User-Agent')).toBe(
          'bird-maps.com/1.0 (https://bird-maps.com)'
        );
        return HttpResponse.json(
          {
            originalimage: {
              source:
                'https://upload.wikimedia.org/wikipedia/commons/3/3a/Myiodynastes_luteiventris.jpg',
              width: 1280,
              height: 800,
            },
            content_urls: {
              desktop: {
                page: 'https://en.wikipedia.org/wiki/Sulphur-bellied_flycatcher',
              },
            },
          },
          { status: 200 }
        );
      }),
      http.get(WIKI_ACTION_URL, ({ request }) => {
        const url = new URL(request.url);
        // The action-API path requests imageinfo for the File: page derived
        // from the originalimage URL. The lead-image client must compute the
        // canonical "File:<basename>" title from the upload URL and pass it
        // through `titles=`.
        expect(url.searchParams.get('action')).toBe('query');
        expect(url.searchParams.get('prop')).toBe('imageinfo');
        expect(url.searchParams.get('iiprop')).toBe('extmetadata|url');
        expect(url.searchParams.get('format')).toBe('json');
        expect(url.searchParams.get('titles')).toBe(
          'File:Myiodynastes_luteiventris.jpg'
        );
        return HttpResponse.json({
          query: {
            pages: {
              '12345': {
                title: 'File:Myiodynastes_luteiventris.jpg',
                imageinfo: [
                  {
                    url: 'https://upload.wikimedia.org/wikipedia/commons/3/3a/Myiodynastes_luteiventris.jpg',
                    descriptionurl:
                      'https://commons.wikimedia.org/wiki/File:Myiodynastes_luteiventris.jpg',
                    extmetadata: {
                      LicenseShortName: { value: 'CC BY-SA 4.0' },
                      License: { value: 'cc-by-sa-4.0' },
                      LicenseUrl: {
                        value: 'https://creativecommons.org/licenses/by-sa/4.0',
                      },
                      Artist: { value: '<a href="...">Jane Birder</a>' },
                    },
                  },
                ],
              },
            },
          },
        });
      })
    );

    const result = await fetchWikipediaLeadImage('Sulphur-bellied_flycatcher');

    expect(result).not.toBeNull();
    expect(result!.url).toBe(
      'https://upload.wikimedia.org/wikipedia/commons/3/3a/Myiodynastes_luteiventris.jpg'
    );
    // License normalizes to a lowercase CC code matching the iNat convention
    // (`cc-by`, `cc-by-sa`, `cc0`) so the species_photos.license column has a
    // single vocabulary across both ingest paths.
    expect(result!.license).toBe('cc-by-sa-4.0');
    // Attribution string includes the cleaned artist name (HTML stripped) and
    // a stable Commons file URL so the rendered "Photo: <name>, CC BY-SA 4.0
    // (Wikimedia Commons)" line in the frontend can link back to the source.
    expect(result!.attribution).toContain('Jane Birder');
    expect(result!.attribution).toContain('CC BY-SA 4.0');
    expect(result!.attribution).toContain(
      'https://commons.wikimedia.org/wiki/File:Myiodynastes_luteiventris.jpg'
    );
  });

  it('returns null when the summary endpoint 404s', async () => {
    server.use(
      http.get(WIKI_SUMMARY_URL, () => {
        return new HttpResponse('not found', { status: 404 });
      })
    );

    const result = await fetchWikipediaLeadImage('Imaginarius_nonexistens');
    expect(result).toBeNull();
  });

  it('returns null when the summary has no originalimage field', async () => {
    // Some Wikipedia pages (rare birds with stub articles, taxonomy redirects)
    // have no lead image at all. Treat as "no photo available" rather than
    // throwing — the run-photos cascade will fall through to family silhouette.
    server.use(
      http.get(WIKI_SUMMARY_URL, () => {
        return HttpResponse.json(
          {
            content_urls: {
              desktop: { page: 'https://en.wikipedia.org/wiki/Stub_article' },
            },
            // originalimage intentionally omitted
          },
          { status: 200 }
        );
      })
    );

    const result = await fetchWikipediaLeadImage('Stub_article');
    expect(result).toBeNull();
  });

  it('rejects non-CC images (fair-use, ARR) by returning null', async () => {
    // Wikipedia hosts a long tail of fair-use / "all rights reserved" lead
    // images (sports logos, album covers, rare bird photos uploaded under
    // local fair-use). bird-maps.com only displays Commons-style CC photos,
    // so the lead-image client filters those out via the extmetadata license
    // code. The species falls through to the existing family-silhouette
    // fallback in <SpeciesDetailSurface>.
    server.use(
      http.get(WIKI_SUMMARY_URL, () => {
        return HttpResponse.json(
          {
            originalimage: {
              source: 'https://upload.wikimedia.org/wikipedia/en/4/4f/Fair_use_bird.jpg',
              width: 800,
              height: 600,
            },
          },
          { status: 200 }
        );
      }),
      http.get(WIKI_ACTION_URL, () => {
        return HttpResponse.json({
          query: {
            pages: {
              '99999': {
                title: 'File:Fair_use_bird.jpg',
                imageinfo: [
                  {
                    url: 'https://upload.wikimedia.org/wikipedia/en/4/4f/Fair_use_bird.jpg',
                    descriptionurl:
                      'https://en.wikipedia.org/wiki/File:Fair_use_bird.jpg',
                    extmetadata: {
                      LicenseShortName: { value: 'Fair use' },
                      License: { value: 'fair use' },
                      Artist: { value: 'Some Photographer' },
                    },
                  },
                ],
              },
            },
          },
        });
      })
    );

    const result = await fetchWikipediaLeadImage('Some_bird');
    expect(result).toBeNull();
  });

  it('accepts cc0 / public domain images', async () => {
    // PD-USGov, PD-old, CC0 are all bird-maps-acceptable. The license filter
    // must not be a hard CC-BY whitelist.
    server.use(
      http.get(WIKI_SUMMARY_URL, () => {
        return HttpResponse.json(
          {
            originalimage: {
              source: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Pd_bird.jpg',
              width: 1200,
              height: 800,
            },
          },
          { status: 200 }
        );
      }),
      http.get(WIKI_ACTION_URL, () => {
        return HttpResponse.json({
          query: {
            pages: {
              '11111': {
                title: 'File:Pd_bird.jpg',
                imageinfo: [
                  {
                    url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Pd_bird.jpg',
                    descriptionurl:
                      'https://commons.wikimedia.org/wiki/File:Pd_bird.jpg',
                    extmetadata: {
                      LicenseShortName: { value: 'Public domain' },
                      License: { value: 'pd' },
                      Artist: { value: 'U.S. Fish & Wildlife Service' },
                    },
                  },
                ],
              },
            },
          },
        });
      })
    );

    const result = await fetchWikipediaLeadImage('PD_bird_article');
    expect(result).not.toBeNull();
    expect(result!.license).toBe('pd');
    expect(result!.attribution).toContain('U.S. Fish & Wildlife Service');
  });

  it('encodes title path-segment for spaces', async () => {
    // Parity with fetchWikipediaSummary's encoding contract — a real bird page
    // title with a space (e.g. "Bullock oriole") must round-trip.
    let receivedUrl: string | null = null;
    server.use(
      http.get(WIKI_SUMMARY_URL, ({ request }) => {
        receivedUrl = request.url;
        return HttpResponse.json({}, { status: 200 });
      })
    );

    await fetchWikipediaLeadImage('Bullock oriole');

    expect(receivedUrl).not.toBeNull();
    expect(receivedUrl!).toContain('Bullock%20oriole');
  });

  it('429 on summary retries once then succeeds', async () => {
    // Mirrors the iNat / Wikipedia-summary retry contract: 1 retry => 2
    // attempts. Keeps the three clients in lockstep.
    let calls = 0;
    server.use(
      http.get(WIKI_SUMMARY_URL, () => {
        calls++;
        if (calls === 1) {
          return new HttpResponse('rate limited', { status: 429 });
        }
        return HttpResponse.json(
          {
            originalimage: {
              source: 'https://upload.wikimedia.org/wikipedia/commons/r/rr/Recovered.jpg',
              width: 800,
              height: 600,
            },
          },
          { status: 200 }
        );
      }),
      http.get(WIKI_ACTION_URL, () => {
        return HttpResponse.json({
          query: {
            pages: {
              '22222': {
                imageinfo: [
                  {
                    url: 'https://upload.wikimedia.org/wikipedia/commons/r/rr/Recovered.jpg',
                    descriptionurl:
                      'https://commons.wikimedia.org/wiki/File:Recovered.jpg',
                    extmetadata: {
                      License: { value: 'cc-by-4.0' },
                      Artist: { value: 'Tester' },
                    },
                  },
                ],
              },
            },
          },
        });
      })
    );

    const result = await fetchWikipediaLeadImage('Recovered', { retryBaseMs: 1 });
    expect(calls).toBe(2);
    expect(result).not.toBeNull();
    expect(result!.license).toBe('cc-by-4.0');
  });

  it('returns null when the action API has no imageinfo for the file', async () => {
    // The summary returned an originalimage URL but the action API can't
    // resolve metadata (missing page, redacted file). Without provenance
    // we cannot display the image legally — surface null so the cascade
    // falls through to the family silhouette.
    server.use(
      http.get(WIKI_SUMMARY_URL, () => {
        return HttpResponse.json(
          {
            originalimage: {
              source: 'https://upload.wikimedia.org/wikipedia/commons/x/xx/Ghost.jpg',
              width: 800,
              height: 600,
            },
          },
          { status: 200 }
        );
      }),
      http.get(WIKI_ACTION_URL, () => {
        return HttpResponse.json({
          query: {
            pages: {
              '-1': {
                title: 'File:Ghost.jpg',
                missing: '',
              },
            },
          },
        });
      })
    );

    const result = await fetchWikipediaLeadImage('Ghost_article');
    expect(result).toBeNull();
  });
});

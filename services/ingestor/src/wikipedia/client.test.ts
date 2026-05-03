import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { fetchWikipediaSummary } from './client.js';
import type { WikipediaSummary } from './types.js';

// MSW v2 (`http.get` + `HttpResponse`) — v1's `rest.get` + `res(ctx.json())`
// is gone; we don't use it. See CLAUDE.md drift-prone library table.
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Wikipedia REST summary endpoint per https://en.wikipedia.org/api/rest_v1/.
// The title segment is URI-encoded by the client — assertions below verify
// that contract.
const WIKI_SUMMARY_URL =
  'https://en.wikipedia.org/api/rest_v1/page/summary/:title';

describe('fetchWikipediaSummary', () => {
  it('200 OK returns the parsed summary shape with notModified=false', async () => {
    server.use(
      http.get(WIKI_SUMMARY_URL, ({ request, params }) => {
        // Title path-segment is encoded by the client (encodeURIComponent),
        // so `Vermilion_flycatcher` round-trips intact (no special chars
        // here) and the UA matches the iNat-style contact convention.
        expect(params.title).toBe('Vermilion_flycatcher');
        expect(request.headers.get('User-Agent')).toBe(
          'bird-maps.com/1.0 (https://bird-maps.com)'
        );
        // No prior ETag → no conditional GET header.
        expect(request.headers.get('If-None-Match')).toBeNull();
        return HttpResponse.json(
          {
            extract_html: '<p>The vermilion flycatcher is...</p>',
            revision: '1234567890',
          },
          {
            status: 200,
            headers: {
              etag: '"abc123"',
              'content-type': 'application/json',
            },
          }
        );
      })
    );

    const result = await fetchWikipediaSummary('Vermilion_flycatcher');

    expect(result).not.toBeNull();
    // Compile-time exhaustiveness probe on the discriminated union: the
    // success arm exposes `extractHtml`, the 304 arm doesn't. If a future
    // variant ({ rateLimited: true }) lands without extending this guard,
    // tsc fails the typecheck — child #371's writer will rely on this.
    if (result && !result.notModified) {
      expect(result.extractHtml).toBe('<p>The vermilion flycatcher is...</p>');
      expect(result.revisionId).toBe('1234567890');
      expect(result.license).toBe('CC-BY-SA-4.0');
      expect(result.etag).toBe('"abc123"');
      expect(result.notModified).toBe(false);
    } else {
      throw new Error('Expected a 200-shape result, got null or 304');
    }
  });

  it('404 returns null', async () => {
    server.use(
      http.get(WIKI_SUMMARY_URL, () => {
        return new HttpResponse('not found', { status: 404 });
      })
    );

    const result = await fetchWikipediaSummary('Imaginarius_nonexistens');
    expect(result).toBeNull();
  });

  it('304 with prior ETag returns { notModified: true, etag }', async () => {
    server.use(
      http.get(WIKI_SUMMARY_URL, ({ request }) => {
        // Conditional GET: the helper must forward the prior ETag verbatim.
        expect(request.headers.get('If-None-Match')).toBe('"abc123"');
        return new HttpResponse(null, {
          status: 304,
          headers: { etag: '"abc123"' },
        });
      })
    );

    const result = await fetchWikipediaSummary('Vermilion_flycatcher', {
      priorEtag: '"abc123"',
    });

    expect(result).not.toBeNull();
    // Discriminated-union narrowing — typed test of the writer's guard.
    if (result && result.notModified) {
      expect(result.notModified).toBe(true);
      expect(result.etag).toBe('"abc123"');
    } else {
      throw new Error('Expected a 304 notModified result');
    }
  });

  it('304 falls back to opts.priorEtag when server omits ETag header', async () => {
    // Some Wikipedia 304 responses omit the `etag` echo; the helper must
    // reuse the caller's prior value so the writer can keep its column
    // populated. This pins the `?? opts.priorEtag` invariant in the type
    // contract — callers can rely on `etag` being a string post-conditional.
    server.use(
      http.get(WIKI_SUMMARY_URL, () => {
        return new HttpResponse(null, { status: 304 });
      })
    );

    const result = await fetchWikipediaSummary('Vermilion_flycatcher', {
      priorEtag: '"prior-only"',
    });

    expect(result).not.toBeNull();
    if (result && result.notModified) {
      expect(result.etag).toBe('"prior-only"');
    } else {
      throw new Error('Expected a 304 notModified result');
    }
  });

  it('429 retries once then succeeds (parity with iNat backoff contract)', async () => {
    // Pins observable behavior to the iNat helper's "1 retry => 2 attempts"
    // default (services/ingestor/src/inat/client.ts:69). If the iNat side
    // ever changes its retry budget, both tests fail together — keeps the
    // two clients in lockstep.
    let calls = 0;
    server.use(
      http.get(WIKI_SUMMARY_URL, () => {
        calls++;
        if (calls === 1) {
          return new HttpResponse('rate limited', { status: 429 });
        }
        return HttpResponse.json(
          {
            extract_html: '<p>Recovered.</p>',
            revision: '999',
          },
          {
            status: 200,
            headers: { etag: '"after-retry"' },
          }
        );
      })
    );

    const result = await fetchWikipediaSummary('Vermilion_flycatcher', {
      retryBaseMs: 1,
    });

    expect(calls).toBe(2);
    if (result && !result.notModified) {
      expect(result.extractHtml).toBe('<p>Recovered.</p>');
      expect(result.etag).toBe('"after-retry"');
    } else {
      throw new Error('Expected a 200-shape result after retry');
    }
  });

  it('malformed response (missing extract_html) throws', async () => {
    server.use(
      http.get(WIKI_SUMMARY_URL, () => {
        return HttpResponse.json(
          // Intentionally missing `extract_html`. A live Wikipedia summary
          // always carries this field; its absence indicates either an API
          // contract change or a payload corruption — either way, surface
          // loudly rather than persist a NULL extract.
          { revision: '1' },
          {
            status: 200,
            headers: { etag: '"x"' },
          }
        );
      })
    );

    await expect(
      fetchWikipediaSummary('Vermilion_flycatcher')
    ).rejects.toThrow(/extract_html/);
  });

  it('encodes title path-segment for special characters', async () => {
    // Spaces appear in some Wikipedia page titles when callers don't
    // pre-substitute underscores. Without `encodeURIComponent`, the URL
    // would be malformed. (Apostrophes are in RFC 3986's unreserved set
    // and survive encoding round-trip un-percent-escaped, so we use a
    // space — which is unambiguously encoded — as the canary.)
    let receivedUrl: string | null = null;
    server.use(
      http.get(WIKI_SUMMARY_URL, ({ request }) => {
        receivedUrl = request.url;
        return HttpResponse.json(
          { extract_html: '<p>x</p>', revision: '1' },
          { status: 200, headers: { etag: '"y"' } }
        );
      })
    );

    await fetchWikipediaSummary('Bullock oriole');

    expect(receivedUrl).not.toBeNull();
    // Space encodes to %20.
    expect(receivedUrl!).toContain('Bullock%20oriole');
    expect(receivedUrl!).not.toContain('Bullock oriole');
  });

  it('forwards If-None-Match only when priorEtag is provided', async () => {
    // Belt-and-suspenders: the conditional-GET header must NOT be sent on a
    // first-time fetch. Otherwise Wikipedia would 304 the very first call
    // against a phantom etag.
    let header: string | null = null;
    server.use(
      http.get(WIKI_SUMMARY_URL, ({ request }) => {
        header = request.headers.get('If-None-Match');
        return HttpResponse.json(
          { extract_html: '<p>x</p>', revision: '1' },
          { status: 200, headers: { etag: '"first"' } }
        );
      })
    );

    await fetchWikipediaSummary('Vermilion_flycatcher');
    expect(header).toBeNull();
  });

  it('return shape narrows correctly via the discriminated union', () => {
    // Compile-time-only assertion. If a later change reshapes the union
    // (adds `{ rateLimited: true }`, drops `notModified`, etc.) without
    // extending this guard, tsc fails the typecheck. Cheap insurance for
    // child #371 which uses `if (result.notModified) skipUpdate()` as a
    // type guard. The body never executes — `if (false)` is dead code.
    if (false as boolean) {
      const _result = null as unknown as WikipediaSummary | null;
      if (_result === null) {
        return;
      }
      if (_result.notModified) {
        // 304 arm — only `etag` is reachable.
        const _etag: string = _result.etag;
        void _etag;
      } else {
        // 200 arm — extract/revision/license/etag are reachable.
        const _extractHtml: string = _result.extractHtml;
        const _revisionId: string = _result.revisionId;
        const _license: 'CC-BY-SA-4.0' = _result.license;
        const _etag: string | null = _result.etag;
        void _extractHtml;
        void _revisionId;
        void _license;
        void _etag;
      }
    }
    expect(true).toBe(true);
  });
});

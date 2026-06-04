import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { snapFetchBboxParam, type Bbox } from '@bird-watch/geo';
import { runCacheWarm, buildCacheWarmUrls } from './run-cache-warm.js';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('buildCacheWarmUrls', () => {
  it('builds exactly 77 URLs: 2 CONUS + 25 metros × 3 zooms', () => {
    const urls = buildCacheWarmUrls('https://api.bird-maps.com');
    expect(urls).toHaveLength(77);
  });

  it('builds the two CONUS aggregated z=3 / z=4 queries first, snapped (#866)', () => {
    const urls = buildCacheWarmUrls('https://api.bird-maps.com');
    // #866 — both CONUS entries derive from the frontend's DEFAULT_BBOX_CONUS
    // ([-125,24,-66,50]) snapped through the shared grid, so they are
    // value-identical to the initial-paint fetch in BOTH layouts (mobile opens
    // at z3, desktop at z4 — previously a different, unwarmed bbox). The CONUS
    // default is integer-aligned, so snapping is a no-op on the value; the only
    // change is the canonical .toFixed(2) serialization.
    expect(urls[0]).toBe(
      'https://api.bird-maps.com/api/observations?since=14d&bbox=-125.00,24.00,-66.00,50.00&zoom=3'
    );
    expect(urls[1]).toBe(
      'https://api.bird-maps.com/api/observations?since=14d&bbox=-125.00,24.00,-66.00,50.00&zoom=4'
    );
  });

  it('uses the configured baseUrl verbatim (no trailing slash duplication)', () => {
    const urls = buildCacheWarmUrls('http://localhost:8080');
    expect(urls[0]).toMatch(/^http:\/\/localhost:8080\/api\/observations\?/);
  });

  it('snaps z=5 metro entries; passes z=6/z=7 per-observation entries through (#866)', () => {
    const urls = buildCacheWarmUrls('https://api.bird-maps.com');
    // LA at (-118.24, 34.05); z=5 half-widths (11, 6).
    // raw bbox = (-129.24, 28.05, -107.24, 40.05); snapped OUTWARD to the 0.25°
    // grid = (-129.25, 28.00, -107.00, 40.25) — value-identical to what a
    // client viewing LA at z5 requests (both go through snapFetchBbox).
    expect(urls).toContain(
      'https://api.bird-maps.com/api/observations?since=14d&bbox=-129.25,28.00,-107.00,40.25&zoom=5'
    );
    // z=6 / z=7 are per-observation mode → snapFetchBbox passthrough → raw
    // .toFixed(2) value, UNCHANGED from the pre-#866 contract (these warmed
    // keys stay disjoint from clients until the per-observation follow-up).
    // LA z=6: half-widths (5.5, 3) → bbox = (-123.74, 31.05, -112.74, 37.05)
    expect(urls).toContain(
      'https://api.bird-maps.com/api/observations?since=14d&bbox=-123.74,31.05,-112.74,37.05&zoom=6'
    );
    // LA z=7: half-widths (2.75, 1.5) → bbox = (-120.99, 32.55, -115.49, 35.55)
    expect(urls).toContain(
      'https://api.bird-maps.com/api/observations?since=14d&bbox=-120.99,32.55,-115.49,35.55&zoom=7'
    );
  });

  it('warmer/client agreement: the z=5 metro param-set matches the frontend request (#866)', () => {
    // The AC's core invariant: for a representative metro anchor at z=5, the
    // FULL query param-set the warmer emits must equal what the frontend builds
    // for a viewport centered there under the default scope — bbox (snapped),
    // zoom, AND since=14d, with no filter params. Any missing/extra param forks
    // the cache key.
    //
    // Reconstruct the frontend side independently: ApiClient.getObservations
    // (client.ts) emits `since` (default state.since='14d' is truthy), the
    // snapped bbox via the SAME snapFetchBboxParam, and `zoom`, with no
    // notable/species/family/state params for the default scope.
    const urls = buildCacheWarmUrls('https://api.bird-maps.com');
    const laZ5 = urls.find((u) => u.includes('&zoom=5') && u.includes('-129.25'));
    expect(laZ5).toBeDefined();

    // LA at (-118.24, 34.05) with z=5 half-widths (11, 6) — the viewport a
    // client centered on LA at z5 frames.
    const clientBbox: Bbox = [-118.24 - 11, 34.05 - 6, -118.24 + 11, 34.05 + 6];
    const clientParams = new URLSearchParams();
    clientParams.set('since', '14d');
    clientParams.set('bbox', snapFetchBboxParam(clientBbox, 5));
    clientParams.set('zoom', '5');

    const warmerParams = new URL(laZ5!).searchParams;
    // Same param NAMES (no filters on either side).
    expect([...warmerParams.keys()].sort()).toEqual(['bbox', 'since', 'zoom']);
    // Same VALUE for every param (order-independent — CF normalizes order).
    for (const [k, v] of clientParams) {
      expect(warmerParams.get(k)).toBe(v);
    }
    // Symmetric: warmer has no param the client lacks.
    for (const k of warmerParams.keys()) {
      expect(clientParams.has(k)).toBe(true);
    }
  });
});

describe('runCacheWarm', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it('counts each cf-cache-status bucket from the response headers', async () => {
    let callIdx = 0;
    server.use(
      http.get('https://api.bird-maps.com/api/observations', () => {
        // Rotate through the four buckets + one unknown across the 77 URLs.
        // Order: miss, hit, expired, dynamic, BYPASS (other) — repeating.
        const cycle = ['MISS', 'HIT', 'EXPIRED', 'DYNAMIC', 'BYPASS'];
        const status = cycle[callIdx % cycle.length]!;
        callIdx++;
        return new HttpResponse(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'cf-cache-status': status, 'content-type': 'application/json' },
        });
      })
    );

    const summary = await runCacheWarm({ baseUrl: 'https://api.bird-maps.com', sleepMs: 0 });

    expect(summary.total).toBe(77);
    // 77 / 5 = 15 full cycles + 2 extras. Distribution: MISS=16, HIT=16, EXPIRED=15, DYNAMIC=15, BYPASS=15.
    expect(summary.miss).toBe(16);
    expect(summary.hit).toBe(16);
    expect(summary.expired).toBe(15);
    expect(summary.dynamic).toBe(15);
    expect(summary.other).toBe(15);
    expect(summary.error).toBe(0);
  });

  it('counts fetch failures into the error bucket without throwing', async () => {
    server.use(
      http.get('https://api.bird-maps.com/api/observations', () => {
        return HttpResponse.error();
      })
    );

    const summary = await runCacheWarm({ baseUrl: 'https://api.bird-maps.com', sleepMs: 0 });

    expect(summary.total).toBe(77);
    expect(summary.error).toBe(77);
    expect(summary.miss + summary.hit + summary.expired + summary.dynamic + summary.other).toBe(0);
  });

  it('emits a single compact bird_ingest_cache_warmed log line with the summary', async () => {
    server.use(
      http.get('https://api.bird-maps.com/api/observations', () =>
        new HttpResponse(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'cf-cache-status': 'MISS', 'content-type': 'application/json' },
        })
      )
    );

    await runCacheWarm({ baseUrl: 'https://api.bird-maps.com', sleepMs: 0 });

    const emitted = logSpy.mock.calls
      .map((args: unknown[]): unknown => {
        try { return JSON.parse(args[0] as string); } catch { return null; }
      })
      .filter((o: unknown): o is Record<string, unknown> =>
        typeof o === 'object' && o !== null
          && (o as Record<string, unknown>).message === 'bird_ingest_cache_warmed'
      );
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      severity: 'INFO',
      message: 'bird_ingest_cache_warmed',
      kind: 'cache-warm',
      total: 77,
      miss: 77,
      hit: 0,
      expired: 0,
      dynamic: 0,
      other: 0,
      error: 0,
      p50ms: expect.any(Number),
      p95ms: expect.any(Number),
    });
    // Single compact line — must not contain a newline (Cloud Logging
    // splits multi-line stdout into separate textPayload entries, which
    // would lose the jsonPayload extraction the dashboard depends on).
    const rawLine = logSpy.mock.calls.find(
      (args: unknown[]) =>
        typeof args[0] === 'string' && args[0].includes('bird_ingest_cache_warmed')
    )?.[0] as string;
    expect(rawLine).not.toContain('\n');
  });

  it('sleeps between requests by the configured sleepMs', async () => {
    // Use sleepMs > 0 with a spied sleep injection so we don't actually wait.
    // The injectable sleep keeps the test fast (zero wall-clock) while still
    // proving the runner pauses between every fetch.
    const sleepSpy = vi.fn().mockResolvedValue(undefined);
    server.use(
      http.get('https://api.bird-maps.com/api/observations', () =>
        new HttpResponse(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'cf-cache-status': 'MISS' },
        })
      )
    );

    await runCacheWarm({ baseUrl: 'https://api.bird-maps.com', sleepMs: 200, sleep: sleepSpy });

    // 77 URLs → 77 sleeps (one after each request). Concurrency=1 + 200ms
    // sleep is load-bearing — it keeps the warm job inside the
    // Layer-1 ratelimit's 10 req/10s ceiling. See run-cache-warm.ts header.
    expect(sleepSpy).toHaveBeenCalledTimes(77);
    expect(sleepSpy).toHaveBeenCalledWith(200);
  });

  it('treats lowercase / mixed-case cf-cache-status headers as the same bucket', async () => {
    let callIdx = 0;
    server.use(
      http.get('https://api.bird-maps.com/api/observations', () => {
        // CF normally returns uppercase, but ANY proxy in front of CF (or a
        // test fixture) might lowercase it — the runner must not double-count.
        const variants = ['miss', 'Miss', 'MISS'];
        const status = variants[callIdx % variants.length]!;
        callIdx++;
        return new HttpResponse(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'cf-cache-status': status },
        });
      })
    );

    const summary = await runCacheWarm({ baseUrl: 'https://api.bird-maps.com', sleepMs: 0 });
    expect(summary.miss).toBe(77);
  });

  it('counts responses with no cf-cache-status header into the other bucket', async () => {
    server.use(
      http.get('https://api.bird-maps.com/api/observations', () =>
        new HttpResponse(JSON.stringify({ items: [] }), { status: 200 })
      )
    );

    const summary = await runCacheWarm({ baseUrl: 'https://api.bird-maps.com', sleepMs: 0 });
    expect(summary.other).toBe(77);
    expect(summary.miss).toBe(0);
  });
});

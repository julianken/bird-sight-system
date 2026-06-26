import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ApiClient } from './client.js';

describe('ApiClient', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('encodes filter query params for /api/observations', async () => {
    const envelope = JSON.stringify({ data: [], meta: { freshestObservationAt: null } });
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(envelope, { status: 200 }));
    const client = new ApiClient({ baseUrl: '' });
    await client.getObservations({ since: '14d', notable: true, speciesCode: 'vermfly' });
    const call = (fetch as unknown as { mock: { calls: [string, unknown][] } }).mock.calls[0]!;
    const url = call[0];
    expect(url).toContain('since=14d');
    expect(url).toContain('notable=true');
    expect(url).toContain('species=vermfly');
  });

  it('serializes bbox as comma-separated west,south,east,north on /api/observations', async () => {
    const envelope = JSON.stringify({ data: [], meta: { freshestObservationAt: null } });
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(envelope, { status: 200 }));
    const client = new ApiClient({ baseUrl: '' });
    // No zoom ⇒ per-observation mode ⇒ no snapping, but the canonical
    // serializer still emits .toFixed(2) values (#866). The integer-aligned
    // CONUS default serializes to its 2-decimal form.
    await client.getObservations({ bbox: [-125, 24, -66, 50] });
    const call = (fetch as unknown as { mock: { calls: [string, unknown][] } }).mock.calls[0]!;
    const url = call[0];
    // URLSearchParams encodes "," as "%2C"; either form is acceptable.
    expect(url).toMatch(/bbox=-125\.00(?:%2C|,)24\.00(?:%2C|,)-66\.00(?:%2C|,)50\.00/);
  });

  it('reconstructs a CANONICAL fetch bbox from (snapped-midpoint, zoom) at zoom < 6 (#868)', async () => {
    // #868 — at zoom < 6 the fetch bbox is no longer the viewport edges snapped
    // outward (#866 scheme b); it is RECONSTRUCTED from the bbox midpoint snapped
    // to the grid + a fixed per-zoom half-extent, then clamped to CONUS. Every
    // device at the same view collapses to ONE cache key. This happens at FETCH
    // time (not App.tsx state) so it covers both the #847 scope-reseed path and
    // the idle path. Displayed counts stay correct because they derive from
    // filterBucketsByBounds(buckets, viewportBounds) against the RAW map bounds.
    const envelope = JSON.stringify({ data: [], meta: { freshestObservationAt: null } });
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(envelope, { status: 200 }));
    const client = new ApiClient({ baseUrl: '' });
    // raw midpoint (-112.74, 37.02) → snap z5 (0.25°) → (-112.75, 37.00) →
    // ±[22.25, 12.25] = [-135.00, 24.75, -90.50, 49.25] → west clamps to
    // CONUS_BOUNDS → [-130.00, 24.75, -90.50, 49.25].
    await client.getObservations({ bbox: [-118.241, 33.998, -107.237, 40.051], zoom: 5 });
    const call = (fetch as unknown as { mock: { calls: [string, unknown][] } }).mock.calls[0]!;
    const url = call[0];
    expect(url).toMatch(
      /bbox=-130\.00(?:%2C|,)24\.75(?:%2C|,)-90\.50(?:%2C|,)49\.25/,
    );
  });

  it('collapses every wide CONUS default view to the SAME canonical key at z4 (#868)', async () => {
    // Two very different device viewports framing the CONUS default center must
    // mint ONE key at z4 — the core device-independence guarantee. Both
    // serialize to CONUS_BOUNDS.
    const envelope = JSON.stringify({ data: [], meta: { freshestObservationAt: null } });
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(envelope, { status: 200 }))
      .mockResolvedValueOnce(new Response(envelope, { status: 200 }));
    const client = new ApiClient({ baseUrl: '' });
    // A narrow phone bbox and a wide desktop bbox, same CONUS center.
    await client.getObservations({ bbox: [-138, 14, -59, 65], zoom: 4 });
    await client.getObservations({ bbox: [-128, 30, -69, 49], zoom: 4 });
    const calls = (fetch as unknown as { mock: { calls: [string, unknown][] } }).mock.calls;
    const bbox = (u: string) => new URL(u, 'http://x').searchParams.get('bbox');
    expect(bbox(calls[0]![0])).toBe('-130.00,20.00,-65.00,52.00');
    expect(bbox(calls[1]![0])).toBe('-130.00,20.00,-65.00,52.00');
  });

  it('serializes the bbox non-degenerately at zoom >= 6 (per-observation mode, #868/#1292)', async () => {
    const envelope = JSON.stringify({
      mode: 'observations', data: [], meta: { freshestObservationAt: null },
    });
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(envelope, { status: 200 }));
    const client = new ApiClient({ baseUrl: '' });
    await client.getObservations({ bbox: [-118.241, 33.998, -107.237, 40.051], zoom: 7 });
    const call = (fetch as unknown as { mock: { calls: [string, unknown][] } }).mock.calls[0]!;
    const url = call[0];
    // #1292 — the z>=6 path now snaps edges OUTWARD to the 0.0025° grid and
    // serializes at .toFixed(4) (was the aggregated .toFixed(2) passthrough,
    // which degenerated to a zero-area box below ~0.01° span ≈ z17). The box
    // remains a tight superset of the viewport.
    expect(url).toMatch(
      /bbox=-118\.2425(?:%2C|,)33\.9975(?:%2C|,)-107\.2350(?:%2C|,)40\.0525/,
    );
  });

  it('NEVER serializes a degenerate (zero-area) bbox at high zoom — markers do not vanish (#1292)', async () => {
    const envelope = JSON.stringify({
      mode: 'observations', data: [], meta: { freshestObservationAt: null },
    });
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(envelope, { status: 200 }));
    const client = new ApiClient({ baseUrl: '' });
    // A z17-tight viewport over Central Park: span ~0.0002° per axis. The legacy
    // .toFixed(2) path flattened this to `-73.97,40.78,-73.97,40.78` (W==E,
    // S==N) → server returns 0 rows → "No recent sightings".
    await client.getObservations({
      bbox: [-73.9698, 40.7779, -73.9696, 40.7781],
      zoom: 17,
    });
    const call = (fetch as unknown as { mock: { calls: [string, unknown][] } }).mock.calls[0]!;
    const got = new URL(call[0], 'http://x').searchParams.get('bbox')!;
    const [w, s, e, n] = got.split(',').map(Number);
    expect(w).toBeLessThan(e);
    expect(s).toBeLessThan(n);
  });

  it('maps stateCode to ?state= on /api/observations (#735)', async () => {
    const envelope = JSON.stringify({ data: [], meta: { freshestObservationAt: null } });
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(envelope, { status: 200 }));
    const client = new ApiClient({ baseUrl: '' });
    await client.getObservations({ stateCode: 'US-AZ' });
    const call = (fetch as unknown as { mock: { calls: [string, unknown][] } }).mock.calls[0]!;
    expect(call[0]).toContain('state=US-AZ');
  });

  // ── #873 — state-scope FIXED-ENVELOPE cache key (aggregated path) ──────────
  //
  // Before #873 a state-scoped aggregated request transmitted the canonical
  // CONUS-centered box reconstructed from the *viewport* midpoint, so every
  // state and every pan minted a NEW Cloudflare key (100% MISS, 12-14s CONUS
  // scans). After #873, when a fixed state envelope is known we send THAT
  // envelope (snapped outward to the cache grid) as the bbox in aggregated mode
  // — so all viewports of a state collapse to ONE key per (state, zoom, filters)
  // and the origin query is state-tight. The ST_Intersects state clip makes the
  // response viewport-independent, so the frontend's viewport bucket-clip keeps
  // render byte-identical. Scoped to zoom < 6 ONLY (the zoom >= 6 10k-truncation
  // brake stays untouched, exactly as #868/#869).

  it('sends the FIXED state envelope (snapped) as bbox when state-scoped at zoom < 6 (#873)', async () => {
    const envelope = JSON.stringify({ data: [], meta: { freshestObservationAt: null } });
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(envelope, { status: 200 }));
    const client = new ApiClient({ baseUrl: '' });
    // California's fixed envelope (StateSummary.bbox). The VIEWPORT bbox below is
    // an off-center pan inside CA — pre-#873 it would canonicalize to a
    // CONUS-centered box; post-#873 the bbox === the snapped CA envelope.
    await client.getObservations({
      stateCode: 'US-CA',
      stateBbox: [-124.41, 32.53, -114.13, 42.01],
      bbox: [-122.5, 36.8, -120.1, 38.9],
      zoom: 5,
    });
    const call = (fetch as unknown as { mock: { calls: [string, unknown][] } }).mock.calls[0]!;
    const got = new URL(call[0], 'http://x').searchParams.get('bbox');
    // snapFetchBbox at z5 (0.25° step): floor W/S, ceil E/N →
    // [-124.50, 32.50, -114.00, 42.25].
    expect(got).toBe('-124.50,32.50,-114.00,42.25');
    expect(call[0]).toContain('state=US-CA');
  });

  it('collapses two different viewport pans of the SAME state to ONE bbox key at zoom < 6 (#873)', async () => {
    const envelope = JSON.stringify({ data: [], meta: { freshestObservationAt: null } });
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(envelope, { status: 200 }))
      .mockResolvedValueOnce(new Response(envelope, { status: 200 }));
    const client = new ApiClient({ baseUrl: '' });
    const stateBbox: [number, number, number, number] = [-106.65, 25.84, -93.51, 36.5]; // TX
    // Two genuinely different viewport pans within Texas at z5.
    await client.getObservations({ stateCode: 'US-TX', stateBbox, bbox: [-100, 30, -97, 32], zoom: 5 });
    await client.getObservations({ stateCode: 'US-TX', stateBbox, bbox: [-103, 28, -99, 31], zoom: 5 });
    const calls = (fetch as unknown as { mock: { calls: [string, unknown][] } }).mock.calls;
    const bbox = (u: string) => new URL(u, 'http://x').searchParams.get('bbox');
    expect(bbox(calls[0]![0])).toBe(bbox(calls[1]![0]));
  });

  it('does NOT apply the fixed envelope at zoom >= 6 — viewport bbox passes through (state-scoped, #873)', async () => {
    const envelope = JSON.stringify({
      mode: 'observations', data: [], meta: { freshestObservationAt: null },
    });
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(envelope, { status: 200 }));
    const client = new ApiClient({ baseUrl: '' });
    // zoom >= 6: the 10k-truncation brake (observations.ts:241) relies on the
    // viewport bbox narrowing a dense state — the fixed envelope must NOT apply.
    await client.getObservations({
      stateCode: 'US-CA',
      stateBbox: [-124.41, 32.53, -114.13, 42.01],
      bbox: [-118.241, 33.998, -117.237, 34.5],
      zoom: 7,
    });
    const call = (fetch as unknown as { mock: { calls: [string, unknown][] } }).mock.calls[0]!;
    const got = new URL(call[0], 'http://x').searchParams.get('bbox');
    // Per-observation serialization of the VIEWPORT bbox (no envelope): edges
    // snapped outward to 0.0025° at .toFixed(4) (#1292), NOT the fixed envelope.
    expect(got).toBe('-118.2425,33.9975,-117.2350,34.5000');
  });

  it('falls back to the canonical viewport key when state-scoped but no stateBbox is known (#873)', async () => {
    // The states table may not be loaded yet on the very first scoped paint;
    // without a fixed envelope we keep the prior canonical-viewport behavior
    // rather than dropping the bbox (correctness floor).
    const envelope = JSON.stringify({ data: [], meta: { freshestObservationAt: null } });
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(envelope, { status: 200 }));
    const client = new ApiClient({ baseUrl: '' });
    await client.getObservations({
      stateCode: 'US-CA',
      bbox: [-118.241, 33.998, -107.237, 40.051],
      zoom: 5,
    });
    const call = (fetch as unknown as { mock: { calls: [string, unknown][] } }).mock.calls[0]!;
    const got = new URL(call[0], 'http://x').searchParams.get('bbox');
    // Same canonical box the pre-#873 path produced for this viewport at z5.
    expect(got).toBe('-130.00,24.75,-90.50,49.25');
  });

  it('sends NO ?state= for unscoped/whole-US queries (data invariant, #735)', async () => {
    // Both the unscoped landing and the explicit ?scope=us escape hatch leave
    // ObservationFilters.stateCode unset, so the backend stays byte-for-byte
    // untouched (locked decision #4 — no ?state= ⇒ unclipped national query).
    const envelope = JSON.stringify({ data: [], meta: { freshestObservationAt: null } });
    // Fresh Response per call — a Response body can only be read once.
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(envelope, { status: 200 }))
      .mockResolvedValueOnce(new Response(envelope, { status: 200 }));
    const client = new ApiClient({ baseUrl: '' });
    await client.getObservations({});
    await client.getObservations({ since: '14d', bbox: [-125, 24, -66, 50], zoom: 4 });
    const calls = (fetch as unknown as { mock: { calls: [string, unknown][] } }).mock.calls;
    expect(calls[0]![0]).not.toContain('state=');
    expect(calls[1]![0]).not.toContain('state=');
  });

  it('serializes zoom as ?zoom=N on /api/observations (#627)', async () => {
    const envelope = JSON.stringify({
      mode: 'observations', data: [], meta: { freshestObservationAt: null },
    });
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(envelope, { status: 200 }));
    const client = new ApiClient({ baseUrl: '' });
    await client.getObservations({ bbox: [-125, 24, -66, 50], zoom: 4 });
    const call = (fetch as unknown as { mock: { calls: [string, unknown][] } }).mock.calls[0]!;
    expect(call[0]).toMatch(/zoom=4/);
  });

  it('normalizes legacy envelope (no `mode` field) into mode=observations (#627)', async () => {
    const legacy = JSON.stringify({ data: [], meta: { freshestObservationAt: null } });
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(legacy, { status: 200 }));
    const client = new ApiClient({ baseUrl: '' });
    const res = await client.getObservations({});
    expect(res.mode).toBe('observations');
    if (res.mode === 'observations') expect(res.data).toEqual([]);
  });

  // #830 item B (licensing invariant — Remedy 1): the dead `Array.isArray(raw)`
  // branch that fabricated `meta.freshestObservationAt: null` for a non-empty
  // bare array was deleted. The live read-api always emits the discriminated
  // envelope; the only path that could ever produce non-empty `data` with a
  // null freshness (breaking "eBird credit visible ⟺ ≥1 marker") was that dead
  // branch. Assert the envelope's freshestObservationAt is preserved verbatim
  // (non-null carries through — never silently nulled).
  it('preserves a non-null meta.freshestObservationAt from the discriminated envelope (#830 B)', async () => {
    const ts = '2026-05-31T12:00:00.000Z';
    const envelope = JSON.stringify({
      mode: 'observations',
      data: [
        {
          subId: 'S1', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
          lat: 32.22, lng: -110.97, obsDt: ts, locId: 'L1', locName: 'Tucson',
          howMany: 1, isNotable: false, silhouetteId: 'tyrannidae', familyCode: 'tyrannidae',
        },
      ],
      meta: { freshestObservationAt: ts },
    });
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(envelope, { status: 200 }));
    const client = new ApiClient({ baseUrl: '' });
    const res = await client.getObservations({});
    expect(res.mode).toBe('observations');
    if (res.mode === 'observations') {
      expect(res.data).toHaveLength(1);
      // The non-null timestamp survives — the deleted bare-array branch would
      // have forced this to null on a non-empty payload.
      expect(res.meta.freshestObservationAt).toBe(ts);
    }
  });

  it('passes through aggregated envelope unchanged (#627)', async () => {
    const agg = JSON.stringify({
      mode: 'aggregated',
      buckets: [{
        lat: 31.75, lng: -111, count: 5, speciesCount: 2,
        families: [{
          code: 'tyrannidae', count: 5, speciesCount: 2,
          species: [{ code: 'vermfly', count: 3 }, { code: 'wesfly', count: 2 }],
        }],
      }],
      meta: { freshestObservationAt: null },
    });
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(agg, { status: 200 }));
    const client = new ApiClient({ baseUrl: '' });
    const res = await client.getObservations({ bbox: [-125, 24, -66, 50], zoom: 3 });
    expect(res.mode).toBe('aggregated');
    if (res.mode === 'aggregated') {
      expect(res.buckets).toHaveLength(1);
      expect(res.buckets[0]?.count).toBe(5);
    }
  });

  it('fetches the species dictionary from GET /api/species (#859)', async () => {
    const dict = JSON.stringify([
      { code: 'norcar', comName: 'Northern Cardinal', familyCode: 'cardinalidae' },
      { code: 'vermfly', comName: 'Vermilion Flycatcher', familyCode: 'tyrannidae' },
    ]);
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(dict, { status: 200 }));
    const client = new ApiClient({ baseUrl: '' });
    const rows = await client.getSpeciesDictionary();
    const call = (fetch as unknown as { mock: { calls: [string, unknown][] } }).mock.calls[0]!;
    expect(call[0]).toContain('/api/species');
    // Must hit the dictionary route, NOT the per-species detail route.
    expect(call[0]).not.toMatch(/\/api\/species\/[^/]/);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ code: 'norcar', comName: 'Northern Cardinal', familyCode: 'cardinalidae' });
  });

  it('fetches represented species from GET /api/species-in-scope with the non-species filters only', async () => {
    const rows = JSON.stringify([
      { code: 'norcar', comName: 'Northern Cardinal', familyCode: 'cardinalidae' },
    ]);
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(rows, { status: 200 }));
    const client = new ApiClient({ baseUrl: '' });
    const out = await client.getSpeciesInScope({
      since: '14d', notable: true, familyCode: 'cardinalidae', stateCode: 'US-AZ',
      // speciesCode/bbox/zoom MUST be ignored even if a caller passes them.
      speciesCode: 'norcar', bbox: [-112, 31, -110, 33], zoom: 3,
    });
    const call = (fetch as unknown as { mock: { calls: [string, unknown][] } }).mock.calls[0]!;
    const url = call[0];
    expect(url).toContain('/api/species-in-scope');
    expect(url).toContain('since=14d');
    expect(url).toContain('notable=true');
    expect(url).toContain('family=cardinalidae');
    expect(url).toContain('state=US-AZ');
    // The combobox source must be species/bbox/zoom-INDEPENDENT.
    expect(url).not.toContain('species=');
    expect(url).not.toContain('bbox=');
    expect(url).not.toContain('zoom=');
    expect(out).toEqual([{ code: 'norcar', comName: 'Northern Cardinal', familyCode: 'cardinalidae' }]);
  });

  it('omits absent filters from the /api/species-in-scope query', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('[]', { status: 200 }));
    const client = new ApiClient({ baseUrl: '' });
    await client.getSpeciesInScope({ since: '14d' });
    const url = (fetch as unknown as { mock: { calls: [string, unknown][] } }).mock.calls[0]![0];
    expect(url).toContain('since=14d');
    expect(url).not.toContain('notable=');
    expect(url).not.toContain('family=');
    expect(url).not.toContain('state=');
  });

  it('throws on non-2xx response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
    const client = new ApiClient({ baseUrl: '' });
    await expect(client.getHotspots()).rejects.toThrow('Something went wrong');
  });

  it('ApiError exposes status and body but uses a friendly user-facing message', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('internal database pool exhausted', { status: 503 })
    );
    const client = new ApiClient({ baseUrl: '' });
    try {
      await client.getHotspots();
      expect.fail('should have thrown');
    } catch (err) {
      const apiErr = err as import('./client.js').ApiError;
      // Friendly message for UI consumption — no raw body
      expect(apiErr.message).toBe('Something went wrong — please try again');
      // Structured fields preserved for logging / debugging
      expect(apiErr.status).toBe(503);
      expect(apiErr.body).toBe('internal database pool exhausted');
    }
  });

  // ── #874 — in-flight /api/observations dedup + cancellation ────────────────
  //
  // `getObservations` is the single network boundary every caller funnels
  // through. During a rapid scope/pan change (CA→NV→TX) several fetches fire in
  // quick succession; without dedup all of them hit the network and the late
  // (settle) one can resolve AFTER an earlier one, racing the rendered state.
  // #874 adds (1) supersede-cancel — a new /api/observations aborts the prior
  // in-flight one (passing an AbortSignal to fetch); and (2) concurrent-key
  // coalesce — a byte-identical request already in flight returns the SHARED
  // promise instead of issuing a second network call. The #849 reseed is NOT
  // touched.

  /** A fetch mock whose Responses resolve only when we say so. */
  function deferredFetch() {
    const resolvers: Array<(r: Response) => void> = [];
    const calls: { url: string; signal: AbortSignal | undefined }[] = [];
    const fn = vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, signal: init?.signal ?? undefined });
      return new Promise<Response>((resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener('abort', () =>
            reject(signal.reason ?? new DOMException('Aborted', 'AbortError')),
          );
        }
        resolvers.push(resolve);
      });
    });
    return { fn, resolvers, calls };
  }
  const okBody = () =>
    new Response(JSON.stringify({ data: [], meta: { freshestObservationAt: null } }), { status: 200 });

  it('passes an AbortSignal to fetch for /api/observations (#874)', async () => {
    const d = deferredFetch();
    vi.spyOn(global, 'fetch').mockImplementation(d.fn as unknown as typeof fetch);
    const client = new ApiClient({ baseUrl: '' });
    const p = client.getObservations({ stateCode: 'US-AZ' });
    expect(d.calls[0]!.signal).toBeInstanceOf(AbortSignal);
    d.resolvers[0]!(okBody());
    await p;
  });

  it('aborts the prior in-flight /api/observations when a new one supersedes it (#874)', async () => {
    const d = deferredFetch();
    vi.spyOn(global, 'fetch').mockImplementation(d.fn as unknown as typeof fetch);
    const client = new ApiClient({ baseUrl: '' });
    // Three rapid scope changes (CA → NV → TX), none resolved yet.
    const pCA = client.getObservations({ stateCode: 'US-CA' });
    const pNV = client.getObservations({ stateCode: 'US-NV' });
    const pTX = client.getObservations({ stateCode: 'US-TX' });
    // The two superseded promises reject with AbortError.
    await expect(pCA).rejects.toMatchObject({ name: 'AbortError' });
    await expect(pNV).rejects.toMatchObject({ name: 'AbortError' });
    // Their underlying fetch signals are aborted; only the latest stays live.
    expect(d.calls[0]!.signal!.aborted).toBe(true);
    expect(d.calls[1]!.signal!.aborted).toBe(true);
    expect(d.calls[2]!.signal!.aborted).toBe(false);
    // The latest resolves normally.
    d.resolvers[2]!(okBody());
    await expect(pTX).resolves.toMatchObject({ mode: 'observations' });
  });

  it('coalesces a concurrent byte-identical /api/observations into ONE network call (#874)', async () => {
    const d = deferredFetch();
    vi.spyOn(global, 'fetch').mockImplementation(d.fn as unknown as typeof fetch);
    const client = new ApiClient({ baseUrl: '' });
    const f = { stateCode: 'US-AZ', bbox: [-114.82, 31.33, -109.05, 37.0] as [number, number, number, number], zoom: 5 };
    const p1 = client.getObservations(f);
    const p2 = client.getObservations({ ...f });
    // Only ONE underlying network call despite two getObservations() invocations.
    expect(d.fn).toHaveBeenCalledTimes(1);
    d.resolvers[0]!(okBody());
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual(r2);
  });

  it('does NOT abort a different concurrent endpoint (getHotspots) (#874)', async () => {
    const d = deferredFetch();
    vi.spyOn(global, 'fetch').mockImplementation(d.fn as unknown as typeof fetch);
    const client = new ApiClient({ baseUrl: '' });
    const pHot = client.getHotspots();
    // A superseding observations fetch must not abort the unrelated hotspots one.
    const pObs1 = client.getObservations({ stateCode: 'US-CA' });
    const pObs2 = client.getObservations({ stateCode: 'US-NV' });
    await expect(pObs1).rejects.toMatchObject({ name: 'AbortError' });
    // hotspots call (index 0) was never aborted.
    expect(d.calls[0]!.url).toContain('/api/hotspots');
    expect(d.calls[0]!.signal?.aborted ?? false).toBe(false);
    d.resolvers[0]!(new Response(JSON.stringify([]), { status: 200 }));
    d.resolvers[2]!(okBody());
    await Promise.all([pHot, pObs2]);
  });

});

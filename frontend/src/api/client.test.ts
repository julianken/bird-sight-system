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

  it('snaps the fetch bbox to the shared cache grid at zoom < 6 (#866)', async () => {
    // A jittered z5 metro viewport snaps OUTWARD to the 0.25° grid and
    // serializes via the canonical .toFixed(2) form — the cache-key lever.
    // Snapping happens at FETCH time (not App.tsx state) so it covers both the
    // #847 scope-reseed path and the idle path. Displayed counts stay correct
    // because they derive from filterBucketsByBounds(buckets, viewportBounds)
    // against the RAW map bounds, not this snapped fetch bbox.
    const envelope = JSON.stringify({ data: [], meta: { freshestObservationAt: null } });
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(envelope, { status: 200 }));
    const client = new ApiClient({ baseUrl: '' });
    await client.getObservations({ bbox: [-118.241, 33.998, -107.237, 40.051], zoom: 5 });
    const call = (fetch as unknown as { mock: { calls: [string, unknown][] } }).mock.calls[0]!;
    const url = call[0];
    // raw → snap(z5) → [-118.25, 33.75, -107.00, 40.25] → .toFixed(2)
    expect(url).toMatch(
      /bbox=-118\.25(?:%2C|,)33\.75(?:%2C|,)-107\.00(?:%2C|,)40\.25/,
    );
  });

  it('passes the bbox through unchanged at zoom >= 6 (per-observation mode, #866)', async () => {
    const envelope = JSON.stringify({
      mode: 'observations', data: [], meta: { freshestObservationAt: null },
    });
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(envelope, { status: 200 }));
    const client = new ApiClient({ baseUrl: '' });
    await client.getObservations({ bbox: [-118.241, 33.998, -107.237, 40.051], zoom: 7 });
    const call = (fetch as unknown as { mock: { calls: [string, unknown][] } }).mock.calls[0]!;
    const url = call[0];
    // Passthrough: only the canonical serializer applies, no grid snap.
    expect(url).toMatch(
      /bbox=-118\.24(?:%2C|,)34\.00(?:%2C|,)-107\.24(?:%2C|,)40\.05/,
    );
  });

  it('maps stateCode to ?state= on /api/observations (#735)', async () => {
    const envelope = JSON.stringify({ data: [], meta: { freshestObservationAt: null } });
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(envelope, { status: 200 }));
    const client = new ApiClient({ baseUrl: '' });
    await client.getObservations({ stateCode: 'US-AZ' });
    const call = (fetch as unknown as { mock: { calls: [string, unknown][] } }).mock.calls[0]!;
    expect(call[0]).toContain('state=US-AZ');
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

});

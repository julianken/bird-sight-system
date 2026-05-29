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
    await client.getObservations({ bbox: [-125, 24, -66, 50] });
    const call = (fetch as unknown as { mock: { calls: [string, unknown][] } }).mock.calls[0]!;
    const url = call[0];
    // URLSearchParams encodes "," as "%2C"; either form is acceptable.
    expect(url).toMatch(/bbox=-125(?:%2C|,)24(?:%2C|,)-66(?:%2C|,)50/);
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

  it('passes through aggregated envelope unchanged (#627)', async () => {
    const agg = JSON.stringify({
      mode: 'aggregated',
      buckets: [{ lat: 31.75, lng: -111, count: 5, speciesCount: 2, families: ['tyrannidae'] }],
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

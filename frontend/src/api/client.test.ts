import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ApiClient } from './client.js';

describe('ApiClient', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GETs /api/regions and returns the parsed JSON', async () => {
    const data = [{ id: 'colorado-plateau', name: 'Colorado Plateau' }];
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
    );
    const client = new ApiClient({ baseUrl: '' });
    const out = await client.getRegions();
    expect(out).toEqual(data);
    expect(fetch).toHaveBeenCalledWith('/api/regions', expect.objectContaining({ method: 'GET' }));
  });

  it('encodes filter query params for /api/observations', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('[]', { status: 200 }));
    const client = new ApiClient({ baseUrl: '' });
    await client.getObservations({ since: '14d', notable: true, speciesCode: 'vermfly' });
    const call = (fetch as unknown as { mock: { calls: [string, unknown][] } }).mock.calls[0]!;
    const url = call[0];
    expect(url).toContain('since=14d');
    expect(url).toContain('notable=true');
    expect(url).toContain('species=vermfly');
  });

  it('throws on non-2xx response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
    const client = new ApiClient({ baseUrl: '' });
    await expect(client.getRegions()).rejects.toThrow('Something went wrong');
  });

  it('ApiError exposes status and body but uses a friendly user-facing message', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('internal database pool exhausted', { status: 503 })
    );
    const client = new ApiClient({ baseUrl: '' });
    try {
      await client.getRegions();
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

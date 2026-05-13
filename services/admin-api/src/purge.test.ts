import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { purgeSilhouettesJson } from './purge.js';

describe('purgeSilhouettesJson', () => {
  beforeEach(() => {
    process.env.CLOUDFLARE_ZONE_ID = 'zone';
    process.env.CLOUDFLARE_API_TOKEN = 'token';
    process.env.API_HOST = 'api.bird-maps.com';
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs to the Cloudflare purge endpoint with the silhouettes URL', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    await purgeSilhouettesJson();
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://api.cloudflare.com/client/v4/zones/zone/purge_cache');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer token');
    expect(JSON.parse(init?.body as string)).toEqual({
      files: ['https://api.bird-maps.com/api/silhouettes'],
    });
  });

  it('returns { ok: false } on non-200 (does not throw)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
    const result = await purgeSilhouettesJson();
    expect(result.ok).toBe(false);
  });

  it('returns { ok: false } on network error (does not throw)', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('nope'));
    const result = await purgeSilhouettesJson();
    expect(result.ok).toBe(false);
  });

  it('respects a 5 second timeout', async () => {
    const slow = new Promise<Response>(() => {}); // never resolves
    vi.spyOn(global, 'fetch').mockReturnValue(slow);
    const t0 = Date.now();
    const result = await purgeSilhouettesJson({ timeoutMs: 50 });
    expect(Date.now() - t0).toBeLessThan(500);
    expect(result.ok).toBe(false);
  });
});

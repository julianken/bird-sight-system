import { describe, it, expect, vi, afterEach } from 'vitest';
import { purgeSpeciesJson } from './purge.js';

describe('purgeSpeciesJson', () => {
  afterEach(() => vi.restoreAllMocks());

  it('POSTs a purge for https://<API_HOST>/api/species/<code> and returns ok on 200', async () => {
    process.env.CLOUDFLARE_ZONE_ID = 'zone';
    process.env.CLOUDFLARE_API_TOKEN = 'cftoken';
    process.env.API_HOST = 'api.bird-maps.com';
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));

    const res = await purgeSpeciesJson('norcar');
    expect(res.ok).toBe(true);

    const [, init] = fetchSpy.mock.calls[0]!;
    const sentBody = JSON.parse(String(init!.body));
    // Must match the read-api detail route confirmed in Step 3.0: /api/species/:code
    expect(sentBody.files).toEqual(['https://api.bird-maps.com/api/species/norcar']);
  });

  it('returns not-ok when CF env is missing', async () => {
    delete process.env.CLOUDFLARE_ZONE_ID;
    const res = await purgeSpeciesJson('norcar');
    expect(res.ok).toBe(false);
  });

  it('returns not-ok on a non-2xx cloudflare status', async () => {
    process.env.CLOUDFLARE_ZONE_ID = 'zone';
    process.env.CLOUDFLARE_API_TOKEN = 'cftoken';
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
    const res = await purgeSpeciesJson('norcar');
    expect(res.ok).toBe(false);
  });
});

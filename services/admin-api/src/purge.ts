export interface PurgeResult {
  ok: boolean;
  error?: string;
}

export async function purgeSilhouettesJson(opts: { timeoutMs?: number } = {}): Promise<PurgeResult> {
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const apiHost = process.env.API_HOST ?? 'api.bird-maps.com';
  if (!zoneId || !apiToken) {
    return { ok: false, error: 'CLOUDFLARE_ZONE_ID or CLOUDFLARE_API_TOKEN missing' };
  }
  const url = `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`;
  const body = JSON.stringify({ files: [`https://${apiHost}/api/silhouettes`] });
  const timeoutMs = opts.timeoutMs ?? 5000;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`purge timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    const res = await Promise.race([
      fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: controller.signal,
      }),
      timeoutPromise,
    ]);
    if (!res.ok) return { ok: false, error: `cloudflare status ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Purge the per-species detail JSON (`GET /api/species/<code>`) from the
 * Cloudflare edge so a freshly-swapped photo URL is served immediately.
 * Mirrors purgeSilhouettesJson; non-fatal on failure (DB is authoritative —
 * spec §8). The species detail route is short-cached (no `immutable`), so the
 * purge plus the route's own max-age expiry both converge the edge.
 *
 * The `/api/species/<code>` path is confirmed against the read-api detail
 * route `app.get('/api/species/:code', ...)` (services/read-api/src/app.ts).
 */
export async function purgeSpeciesJson(
  speciesCode: string,
  opts: { timeoutMs?: number } = {},
): Promise<PurgeResult> {
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const apiHost = process.env.API_HOST ?? 'api.bird-maps.com';
  if (!zoneId || !apiToken) {
    return { ok: false, error: 'CLOUDFLARE_ZONE_ID or CLOUDFLARE_API_TOKEN missing' };
  }
  const url = `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`;
  const body = JSON.stringify({ files: [`https://${apiHost}/api/species/${speciesCode}`] });
  const timeoutMs = opts.timeoutMs ?? 5000;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`purge timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    const res = await Promise.race([
      fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      }),
      timeoutPromise,
    ]);
    if (!res.ok) return { ok: false, error: `cloudflare status ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

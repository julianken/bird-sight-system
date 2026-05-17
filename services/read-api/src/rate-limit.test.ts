import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { rateLimit, type RateLimitOptions } from './rate-limit.js';

// Wire the middleware the way `app.ts` does: applied broadly with internal
// path-prefix gating that limits `/api/*` and explicitly skips `/health` and
// `/api/admin/*`. Tests assert that contract directly against a minimal Hono
// app, so they exercise the same code path as production without booting the
// DB-backed `createApp`.
function buildApp(opts: Partial<RateLimitOptions> = {}): Hono {
  const app = new Hono();
  app.use('*', rateLimit({ burst: 3, refillPerSec: 0, ...opts }));
  app.get('/health', c => c.json({ ok: true }));
  app.get('/api/admin/silhouettes', c => c.json({ admin: true }));
  app.get('/api/observations', c => c.json({ ok: true }));
  return app;
}

// Stable client IP for all in-test requests. The middleware reads
// `CF-Connecting-IP` (Cloudflare's real-client header) first and falls back
// to `X-Forwarded-For`'s leftmost entry, then to the connection remote.
const HEADERS = { 'CF-Connecting-IP': '203.0.113.7' };

describe('rateLimit middleware', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-05-17T00:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('passes requests under the burst limit', async () => {
    const app = buildApp();
    for (let i = 0; i < 3; i++) {
      const res = await app.request('/api/observations', { headers: HEADERS });
      expect(res.status).toBe(200);
    }
  });

  it('returns 429 with Retry-After once the burst is exhausted', async () => {
    const app = buildApp({ burst: 2, refillPerSec: 1 });
    expect((await app.request('/api/observations', { headers: HEADERS })).status).toBe(200);
    expect((await app.request('/api/observations', { headers: HEADERS })).status).toBe(200);
    const res = await app.request('/api/observations', { headers: HEADERS });
    expect(res.status).toBe(429);
    const retry = res.headers.get('Retry-After');
    expect(retry).not.toBeNull();
    // refillPerSec=1 → next token in <=1s → Retry-After "1"
    expect(Number(retry)).toBeGreaterThanOrEqual(1);
  });

  it('refills tokens over time', async () => {
    const app = buildApp({ burst: 1, refillPerSec: 1 });
    expect((await app.request('/api/observations', { headers: HEADERS })).status).toBe(200);
    expect((await app.request('/api/observations', { headers: HEADERS })).status).toBe(429);
    vi.advanceTimersByTime(1100);
    expect((await app.request('/api/observations', { headers: HEADERS })).status).toBe(200);
  });

  it('does not rate-limit /health even when the bucket is exhausted', async () => {
    const app = buildApp({ burst: 1, refillPerSec: 0 });
    expect((await app.request('/api/observations', { headers: HEADERS })).status).toBe(200);
    expect((await app.request('/api/observations', { headers: HEADERS })).status).toBe(429);
    // /health must still respond — uptime probes can't be limited
    for (let i = 0; i < 5; i++) {
      expect((await app.request('/health', { headers: HEADERS })).status).toBe(200);
    }
  });

  it('does not rate-limit /api/admin/* even when the bucket is exhausted', async () => {
    const app = buildApp({ burst: 1, refillPerSec: 0 });
    expect((await app.request('/api/observations', { headers: HEADERS })).status).toBe(200);
    expect((await app.request('/api/observations', { headers: HEADERS })).status).toBe(429);
    // Admin routes carry their own auth + are separately rate-limited at the
    // application layer if/when an admin API is mounted here.
    for (let i = 0; i < 5; i++) {
      expect((await app.request('/api/admin/silhouettes', { headers: HEADERS })).status).toBe(200);
    }
  });

  it('tracks buckets per client IP', async () => {
    const app = buildApp({ burst: 1, refillPerSec: 0 });
    const ipA = { 'CF-Connecting-IP': '203.0.113.7' };
    const ipB = { 'CF-Connecting-IP': '203.0.113.8' };
    expect((await app.request('/api/observations', { headers: ipA })).status).toBe(200);
    expect((await app.request('/api/observations', { headers: ipA })).status).toBe(429);
    // Different IP gets its own fresh bucket
    expect((await app.request('/api/observations', { headers: ipB })).status).toBe(200);
  });

  // SECURITY (PR #597 review): On the bypass path (direct *.a.run.app hits),
  // X-Forwarded-For and CF-Connecting-IP are attacker-controlled. The
  // middleware MUST NOT key buckets off them when an unspoofable connection
  // remote is available, and MUST NOT trust XFF at all. These two tests
  // codify that contract.
  it('never trusts X-Forwarded-For for bucket keying', async () => {
    const app = buildApp({ burst: 1, refillPerSec: 0 });
    // Two requests with different XFF values but no CF-Connecting-IP and no
    // connection remote (Hono's in-memory request has no socket). Under the
    // old code, each spoofed XFF got its own bucket → attacker bypasses the
    // limit by rotating XFF. Under the fix, both requests fall back to the
    // same "unknown" key and the second request is rate-limited.
    const headers1 = { 'X-Forwarded-For': '198.51.100.4' };
    const headers2 = { 'X-Forwarded-For': '198.51.100.99' };
    expect((await app.request('/api/observations', { headers: headers1 })).status).toBe(200);
    expect((await app.request('/api/observations', { headers: headers2 })).status).toBe(429);
  });

  it('uses connection remote address over spoofable headers when available', async () => {
    const app = buildApp({ burst: 1, refillPerSec: 0 });
    // Simulate the bypass path: an attacker hits run.app directly, sets
    // CF-Connecting-IP to rotate values, but TCP peer address is the same.
    // We inject the Node-server-style `incoming.socket.remoteAddress` via
    // Hono's third `env` arg to `app.request`.
    const env1 = { incoming: { socket: { remoteAddress: '203.0.113.42' } } };
    const env2 = { incoming: { socket: { remoteAddress: '203.0.113.42' } } };
    const spoof1 = { 'CF-Connecting-IP': '198.51.100.1' };
    const spoof2 = { 'CF-Connecting-IP': '198.51.100.2' };
    expect((await app.request('/api/observations', { headers: spoof1 }, env1)).status).toBe(200);
    // Same connection remote → same bucket → second request blocked despite
    // a rotated CF-Connecting-IP value.
    expect((await app.request('/api/observations', { headers: spoof2 }, env2)).status).toBe(429);
  });
});

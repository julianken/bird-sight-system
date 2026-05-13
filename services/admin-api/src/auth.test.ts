import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { bearerAuth } from './auth.js';

describe('bearerAuth middleware', () => {
  let app: Hono;
  const TOKEN = 'test-token-do-not-leak';

  beforeEach(() => {
    app = new Hono();
    app.use('/admin/*', bearerAuth(TOKEN));
    app.get('/admin/ping', c => c.json({ ok: true }));
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await app.request('/admin/ping');
    expect(res.status).toBe(401);
  });

  it('returns 401 when scheme is not Bearer', async () => {
    const res = await app.request('/admin/ping', {
      headers: { Authorization: `Basic ${TOKEN}` },
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 when token is wrong', async () => {
    const res = await app.request('/admin/ping', {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 when token length differs (timing-safe-equal guard)', async () => {
    const res = await app.request('/admin/ping', {
      headers: { Authorization: 'Bearer x' },
    });
    expect(res.status).toBe(401);
  });

  it('returns 200 when token matches', async () => {
    const res = await app.request('/admin/ping', {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('throws at construction time if token is empty', () => {
    expect(() => bearerAuth('')).toThrow(/ADMIN_API_TOKEN/);
  });
});

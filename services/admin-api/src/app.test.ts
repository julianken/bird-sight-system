import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { startTestDb, type TestDb } from '@bird-watch/db-client/dist/test-helpers.js';
import { createApp } from './app.js';
import { createStorage } from './storage.js';

const TOKEN = 'integration-token';
const s3Mock = mockClient(S3Client);

describe('admin-api app', () => {
  let db: TestDb;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    db = await startTestDb();
    process.env.R2_ENDPOINT = 'https://acct.r2.cloudflarestorage.com';
    process.env.R2_BUCKET_NAME = 'bird-maps-silhouettes';
    process.env.R2_ACCESS_KEY_ID = 'akid';
    process.env.R2_SECRET_ACCESS_KEY = 'sak';
    process.env.SILHOUETTES_PUBLIC_PREFIX = 'https://silhouettes.bird-maps.com';
    process.env.CLOUDFLARE_ZONE_ID = 'zone';
    process.env.CLOUDFLARE_API_TOKEN = 'cftoken';
    process.env.API_HOST = 'api.bird-maps.com';
    app = createApp({
      pool: db.pool,
      storage: createStorage(),
      token: TOKEN,
    });
  }, 120_000);

  afterAll(async () => {
    await db.stop();
  });

  beforeEach(() => {
    s3Mock.reset();
    s3Mock.on(PutObjectCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).resolves({});
    // Stub fetch so purgeSilhouettesJson returns success silently.
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
  });

  function multipart(filename: string, body: Buffer): FormData {
    const fd = new FormData();
    const blob = new Blob([body], { type: 'image/svg+xml' });
    fd.set('file', blob, filename);
    return fd;
  }

  const VALID_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2 L20 22 L4 22 Z"/></svg>`;

  it('GET /health returns ok', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('PUT /admin/silhouettes/family/:code without token returns 401', async () => {
    const res = await app.request('/admin/silhouettes/family/cuculidae', {
      method: 'PUT',
      body: multipart('cuculidae.svg', Buffer.from(VALID_SVG, 'utf8')),
    });
    expect(res.status).toBe(401);
  });

  it('PUT with valid token + valid SVG returns 200, updates DB, calls R2 PUT', async () => {
    const res = await app.request('/admin/silhouettes/family/cuculidae', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: multipart('cuculidae.svg', Buffer.from(VALID_SVG, 'utf8')),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; pathD: string };
    expect(body.url).toMatch(/^https:\/\/silhouettes\.bird-maps\.com\/family\/cuculidae\.[0-9a-f]{8}\.svg$/);
    expect(body.pathD).toBe('M12 2 L20 22 L4 22 Z');

    const { rows } = await db.pool.query<{ svg_url: string; svg_data: string }>(
      `SELECT svg_url, svg_data FROM family_silhouettes WHERE family_code = 'cuculidae'`,
    );
    expect(rows[0]!.svg_url).toBe(body.url);
    expect(rows[0]!.svg_data).toBe('M12 2 L20 22 L4 22 Z');

    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(1);
  });

  it('PUT with malicious SVG (<script>) returns 400 and does NOT touch DB or R2', async () => {
    const malicious = `<svg><script>alert(1)</script><path d="M1 1"/></svg>`;
    const res = await app.request('/admin/silhouettes/family/cuculidae', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: multipart('cuculidae.svg', Buffer.from(malicious, 'utf8')),
    });
    expect(res.status).toBe(400);
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it('PUT for unknown family code returns 404', async () => {
    const res = await app.request('/admin/silhouettes/family/notarealfamily', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: multipart('x.svg', Buffer.from(VALID_SVG, 'utf8')),
    });
    expect(res.status).toBe(404);
  });

  it('DELETE with valid token nulls both svg_url and svg_data, calls R2 DELETE when svg_url was set', async () => {
    // seed via PUT first
    await app.request('/admin/silhouettes/family/cuculidae', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: multipart('cuculidae.svg', Buffer.from(VALID_SVG, 'utf8')),
    });
    s3Mock.resetHistory();

    const res = await app.request('/admin/silhouettes/family/cuculidae', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);

    const { rows } = await db.pool.query<{ svg_url: string | null; svg_data: string | null }>(
      `SELECT svg_url, svg_data FROM family_silhouettes WHERE family_code = 'cuculidae'`,
    );
    expect(rows[0]!.svg_url).toBeNull();
    expect(rows[0]!.svg_data).toBeNull();
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(1);
  });

  it('DELETE on a row that was never overridden is idempotent (200, no R2 DELETE call)', async () => {
    const res = await app.request('/admin/silhouettes/family/turdidae', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(0);
  });

  it('PUT over an existing svg_url deletes the prior R2 object before responding', async () => {
    // Seed: first PUT establishes a prior svg_url + R2 key.
    const firstSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2 L20 22 L4 22 Z"/></svg>`;
    const seedRes = await app.request('/admin/silhouettes/family/cuculidae', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: multipart('cuculidae.svg', Buffer.from(firstSvg, 'utf8')),
    });
    expect(seedRes.status).toBe(200);
    const seedBody = (await seedRes.json()) as { key: string };
    const priorKey = seedBody.key;

    s3Mock.resetHistory();

    // Second PUT with different SVG bytes → different sha → different key.
    const secondSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M1 1 L2 2 L3 3 Z"/></svg>`;
    const overwriteRes = await app.request('/admin/silhouettes/family/cuculidae', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: multipart('cuculidae.svg', Buffer.from(secondSvg, 'utf8')),
    });
    expect(overwriteRes.status).toBe(200);
    const overwriteBody = (await overwriteRes.json()) as { key: string };
    expect(overwriteBody.key).not.toBe(priorKey);

    // The prior R2 object must have been deleted as part of the overwrite.
    const deletes = s3Mock.commandCalls(DeleteObjectCommand);
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.args[0].input.Key).toBe(priorKey);
  });

  it('PUT logs but does not fail when purge fails', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
    const res = await app.request('/admin/silhouettes/family/cuculidae', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: multipart('cuculidae.svg', Buffer.from(VALID_SVG, 'utf8')),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Purge-Status')).toBe('failed');
  });
});

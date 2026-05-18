import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { startTestDb, type TestDb } from '@bird-watch/db-client/dist/test-helpers.js';
import type { Pool } from '@bird-watch/db-client';
import { createApp } from './app.js';
import { createStorage } from './storage.js';
import { createDualWritePool } from './dual-pool.js';

/**
 * End-to-end-ish coverage of dual-write through the admin-api Hono app.
 *
 * - Primary + secondary are real PostGIS testcontainers; both run the full
 *   migration set.
 * - PUT and DELETE silhouette routes should write to BOTH DBs.
 * - When secondary fails (we substitute a throwing fake-pool), the request
 *   still succeeds, the primary row is mutated, and the failure is logged
 *   with the `dual_write_secondary_failed surface=silhouette` marker.
 */

const TOKEN = 'integration-token';
const s3Mock = mockClient(S3Client);

const VALID_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2 L20 22 L4 22 Z"/></svg>`;

function multipart(filename: string, body: Buffer): FormData {
  const fd = new FormData();
  const blob = new Blob([body], { type: 'image/svg+xml' });
  fd.set('file', blob, filename);
  return fd;
}

describe('admin-api dual-write', () => {
  let primary: TestDb;
  let secondary: TestDb;

  beforeAll(async () => {
    process.env.R2_ENDPOINT = 'https://acct.r2.cloudflarestorage.com';
    process.env.R2_BUCKET_NAME = 'bird-maps-silhouettes';
    process.env.R2_ACCESS_KEY_ID = 'akid';
    process.env.R2_SECRET_ACCESS_KEY = 'sak';
    process.env.SILHOUETTES_PUBLIC_PREFIX = 'https://silhouettes.bird-maps.com';
    process.env.CLOUDFLARE_ZONE_ID = 'zone';
    process.env.CLOUDFLARE_API_TOKEN = 'cftoken';
    process.env.API_HOST = 'api.bird-maps.com';
    [primary, secondary] = await Promise.all([startTestDb(), startTestDb()]);
  }, 240_000);

  afterAll(async () => {
    await Promise.all([primary.stop(), secondary.stop()]);
  });

  beforeEach(() => {
    s3Mock.reset();
    s3Mock.on(PutObjectCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).resolves({});
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
  });

  it('PUT writes svg_url + svg_data to BOTH primary and secondary', async () => {
    const pool = createDualWritePool({ primary: primary.pool, secondary: secondary.pool, surface: 'silhouette' });
    const app = createApp({ pool, storage: createStorage(), token: TOKEN });

    const res = await app.request('/admin/silhouettes/family/cuculidae', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: multipart('cuculidae.svg', Buffer.from(VALID_SVG, 'utf8')),
    });
    expect(res.status).toBe(200);

    const pRow = await primary.pool.query<{ svg_url: string; svg_data: string }>(
      `SELECT svg_url, svg_data FROM family_silhouettes WHERE family_code = 'cuculidae'`,
    );
    const sRow = await secondary.pool.query<{ svg_url: string; svg_data: string }>(
      `SELECT svg_url, svg_data FROM family_silhouettes WHERE family_code = 'cuculidae'`,
    );
    expect(pRow.rows[0]!.svg_url).toBeTruthy();
    expect(sRow.rows[0]!.svg_url).toBe(pRow.rows[0]!.svg_url);
    expect(sRow.rows[0]!.svg_data).toBe(pRow.rows[0]!.svg_data);
  });

  it('DELETE nulls svg_url/svg_data in BOTH primary and secondary', async () => {
    const pool = createDualWritePool({ primary: primary.pool, secondary: secondary.pool, surface: 'silhouette' });
    const app = createApp({ pool, storage: createStorage(), token: TOKEN });

    // Seed via PUT first.
    const seed = await app.request('/admin/silhouettes/family/trochilidae', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: multipart('trochilidae.svg', Buffer.from(VALID_SVG, 'utf8')),
    });
    expect(seed.status).toBe(200);

    const res = await app.request('/admin/silhouettes/family/trochilidae', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);

    const pRow = await primary.pool.query<{ svg_url: string | null }>(
      `SELECT svg_url FROM family_silhouettes WHERE family_code = 'trochilidae'`,
    );
    const sRow = await secondary.pool.query<{ svg_url: string | null }>(
      `SELECT svg_url FROM family_silhouettes WHERE family_code = 'trochilidae'`,
    );
    expect(pRow.rows[0]!.svg_url).toBeNull();
    expect(sRow.rows[0]!.svg_url).toBeNull();
  });

  it('secondary failure: primary write commits, request 200s, log emits dual_write_secondary_failed', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Synthetic broken secondary — query() always throws.
    const brokenSecondary = {
      query: vi.fn(async () => {
        throw new Error('secondary connection refused');
      }),
      end: vi.fn(async () => {}),
    } as unknown as Pool;

    const pool = createDualWritePool({ primary: primary.pool, secondary: brokenSecondary, surface: 'silhouette' });
    const app = createApp({ pool, storage: createStorage(), token: TOKEN });

    const res = await app.request('/admin/silhouettes/family/corvidae', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: multipart('corvidae.svg', Buffer.from(VALID_SVG, 'utf8')),
    });
    expect(res.status).toBe(200);

    // Primary still committed.
    const pRow = await primary.pool.query<{ svg_url: string | null }>(
      `SELECT svg_url FROM family_silhouettes WHERE family_code = 'corvidae'`,
    );
    expect(pRow.rows[0]!.svg_url).toBeTruthy();

    // dual_write_secondary_failed log was emitted at least once.
    const messages = errSpy.mock.calls.map(c => String(c[0]));
    expect(messages.some(m => m.includes('dual_write_secondary_failed') && m.includes('surface=silhouette'))).toBe(true);
    errSpy.mockRestore();
  });
});

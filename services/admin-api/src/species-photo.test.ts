import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { startTestDb, type TestDb } from '@bird-watch/db-client/dist/test-helpers.js';
import { createApp } from './app.js';
import { createStorage } from './storage.js';

const TOKEN = 'integration-token';
const s3Mock = mockClient(S3Client);

// Minimal valid JPEG body: SOI/APP0 magic + padding to clear MIN_PHOTO_BYTES.
const JPEG_BODY = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(4096, 0x11)]);
const SOURCE_URL = 'https://static.inaturalist.org/photos/12345/medium.jpg';

// Default SSRF-guard DNS stub: every allowlisted host resolves to one public
// (unicast) IPv4. Tests that need a private/loopback resolution override it.
// Using an injected lookup keeps the whole suite off real DNS.
const PUBLIC_IP = [{ address: '151.101.0.1', family: 4 }];
const publicLookup = async () => PUBLIC_IP;

describe('admin-api PUT /admin/species-photos/:speciesCode', () => {
  let db: TestDb;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    db = await startTestDb();
    // species_photos.species_code FKs species_meta — seed a parent row.
    await db.pool.query(
      `INSERT INTO species_meta (species_code, com_name, sci_name, family_code, family_name, taxon_order)
       VALUES ('norcar', 'Northern Cardinal', 'Cardinalis cardinalis', 'cardinalidae', 'Cardinals', 100)`,
    );
    process.env.R2_ENDPOINT = 'https://acct.r2.cloudflarestorage.com';
    process.env.R2_PHOTOS_BUCKET = 'birdwatch-photos';
    process.env.R2_ACCESS_KEY_ID = 'akid';
    process.env.R2_SECRET_ACCESS_KEY = 'sak';
    process.env.SPECIES_PHOTOS_PUBLIC_PREFIX = 'https://photos.bird-maps.com';
    process.env.CLOUDFLARE_ZONE_ID = 'zone';
    process.env.CLOUDFLARE_API_TOKEN = 'cftoken';
    process.env.API_HOST = 'api.bird-maps.com';
    app = createApp({ pool: db.pool, storage: createStorage(), token: TOKEN, dnsLookup: publicLookup });
  }, 120_000);

  afterAll(async () => {
    await db.stop();
  });

  // fetch is used for BOTH the source-image download and the CF purge POST.
  // Discriminate by URL: cloudflare → purge success; everything else → image.
  function stubFetch(opts: { imageBody?: Buffer; imageMime?: string; imageStatus?: number } = {}) {
    const { imageBody = JPEG_BODY, imageMime = 'image/jpeg', imageStatus = 200 } = opts;
    vi.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
      const u = typeof input === 'string' ? input : input.url;
      if (u.includes('api.cloudflare.com')) {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      return new Response(imageBody, {
        status: imageStatus,
        headers: { 'Content-Type': imageMime },
      });
    });
  }

  beforeEach(async () => {
    s3Mock.reset();
    s3Mock.on(PutObjectCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).resolves({});
    await db.pool.query(`DELETE FROM species_photos WHERE species_code = 'norcar'`);
  });

  function put(code: string, headers: Record<string, string>, json?: unknown, targetApp = app) {
    return targetApp.request(`/admin/species-photos/${code}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
  }

  const VALID_BODY = { sourceUrl: SOURCE_URL, attribution: '(c) someone, CC-BY', license: 'cc-by' };

  it('without token returns 401 and does NOT call R2', async () => {
    stubFetch();
    const res = await put('norcar', {}, VALID_BODY);
    expect(res.status).toBe(401);
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it('with a bad token returns 401', async () => {
    stubFetch();
    const res = await put('norcar', { Authorization: 'Bearer wrong-token' }, VALID_BODY);
    expect(res.status).toBe(401);
  });

  it('valid request uploads to R2, upserts species_photos, purges, returns 200 with the public URL', async () => {
    stubFetch();
    const res = await put('norcar', { Authorization: `Bearer ${TOKEN}` }, VALID_BODY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; key: string };
    expect(body.url).toMatch(/^https:\/\/photos\.bird-maps\.com\/species\/norcar\.[0-9a-f]{8}\.jpg$/);

    // R2 PUT happened exactly once with the photos bucket.
    const puts = s3Mock.commandCalls(PutObjectCommand);
    expect(puts).toHaveLength(1);
    expect(puts[0]!.args[0].input.Bucket).toBe('birdwatch-photos');

    // DB upserted to the new URL.
    const { rows } = await db.pool.query<{ url: string; attribution: string; license: string }>(
      `SELECT url, attribution, license FROM species_photos
        WHERE species_code = 'norcar' AND purpose = 'detail-panel'`,
    );
    expect(rows[0]!.url).toBe(body.url);
    expect(rows[0]!.attribution).toBe('(c) someone, CC-BY');
    expect(rows[0]!.license).toBe('cc-by');
  });

  it('re-applying upserts in place (no duplicate row)', async () => {
    stubFetch();
    await put('norcar', { Authorization: `Bearer ${TOKEN}` }, VALID_BODY);
    await put('norcar', { Authorization: `Bearer ${TOKEN}` }, { ...VALID_BODY, attribution: 'updated' });
    const { rows } = await db.pool.query(
      `SELECT id, attribution FROM species_photos WHERE species_code = 'norcar' AND purpose = 'detail-panel'`,
    );
    expect(rows).toHaveLength(1);
    expect((rows[0] as any).attribution).toBe('updated');
  });

  it('an NC/ND license is denied (400) before any R2 upload or DB write', async () => {
    stubFetch();
    const res = await put('norcar', { Authorization: `Bearer ${TOKEN}` }, { ...VALID_BODY, license: 'cc-by-nc' });
    expect(res.status).toBe(400);
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    const { rows } = await db.pool.query(`SELECT 1 FROM species_photos WHERE species_code = 'norcar'`);
    expect(rows).toHaveLength(0);
  });

  it('a non-image source body is rejected (400), no R2, no DB', async () => {
    stubFetch({ imageBody: Buffer.from('<html>not found</html>'), imageMime: 'text/html' });
    const res = await put('norcar', { Authorization: `Bearer ${TOKEN}` }, VALID_BODY);
    expect(res.status).toBe(400);
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it('a non-200 source fetch is a 400, no R2, no DB', async () => {
    stubFetch({ imageStatus: 404 });
    const res = await put('norcar', { Authorization: `Bearer ${TOKEN}` }, VALID_BODY);
    expect(res.status).toBe(400);
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it('unknown species code returns 404, no R2', async () => {
    stubFetch();
    const res = await put('notareal', { Authorization: `Bearer ${TOKEN}` }, VALID_BODY);
    expect(res.status).toBe(404);
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it('R2-before-DB: a DB write that FAILS after a successful R2 upload returns 5xx, leaves exactly one PutObject and zero live rows', async () => {
    stubFetch();

    // Build an app whose pool rejects the species_photos INSERT but otherwise
    // delegates to the real pool (so the existence-check SELECT still passes).
    // This forces the DB write to fail AFTER the R2 PutObject has resolved —
    // exercising the real ordering, not a tautology.
    const realPool = db.pool;
    const failingPool: typeof realPool = {
      ...realPool,
      query: ((text: any, params?: any) => {
        const sql = typeof text === 'string' ? text : text?.text ?? '';
        if (/insert\s+into\s+species_photos/i.test(sql)) {
          return Promise.reject(new Error('injected DB failure on species_photos insert'));
        }
        return (realPool.query as any)(text, params);
      }) as typeof realPool.query,
    } as typeof realPool;

    const failingApp = createApp({ pool: failingPool, storage: createStorage(), token: TOKEN, dnsLookup: publicLookup });
    const res = await put('norcar', { Authorization: `Bearer ${TOKEN}` }, VALID_BODY, failingApp);

    // Handler surfaces the DB failure as a 5xx (onError default).
    expect(res.status).toBeGreaterThanOrEqual(500);

    // R2 upload ran exactly once — it MUST precede the (failed) DB write.
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(1);

    // No live row: the failed insert left species_photos empty for this code.
    const { rows } = await realPool.query(`SELECT * FROM species_photos WHERE species_code = 'norcar'`);
    expect(rows).toHaveLength(0);
  });

  it('purge failure is non-fatal: still 200, X-Purge-Status: failed', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
      const u = typeof input === 'string' ? input : input.url;
      if (u.includes('api.cloudflare.com')) return new Response('boom', { status: 500 });
      return new Response(JPEG_BODY, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
    });
    const res = await put('norcar', { Authorization: `Bearer ${TOKEN}` }, VALID_BODY);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Purge-Status')).toBe('failed');
  });

  // ── SSRF guard (issue #966 security addendum) ───────────────────────────────
  // The handler fetches `sourceUrl` server-side; assertSafePhotoSource must run
  // BEFORE any fetch. Each case must return 4xx AND perform zero R2 writes. DNS
  // is always stubbed (publicLookup by default, overridden per-case) — no real
  // DNS hits the network.
  describe('SSRF guard', () => {
    it('rejects an http:// (non-https) sourceUrl: 400, no R2, no fetch', async () => {
      // Fresh spy with no implementation; assert it is never invoked — the
      // guard rejects before any fetch (source download or CF purge).
      vi.restoreAllMocks();
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null));
      const res = await put('norcar', { Authorization: `Bearer ${TOKEN}` }, {
        ...VALID_BODY,
        sourceUrl: 'http://static.inaturalist.org/photos/1/medium.jpg',
      });
      expect(res.status).toBe(400);
      expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
      // Guard runs before fetch — the source fetch never happens.
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('rejects a non-allowlisted host: 400, no R2', async () => {
      stubFetch();
      const res = await put('norcar', { Authorization: `Bearer ${TOKEN}` }, {
        ...VALID_BODY,
        sourceUrl: 'https://evil.example.com/x.jpg',
      });
      expect(res.status).toBe(400);
      expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    });

    it('rejects the IMDS host http://169.254.169.254/latest/meta-data/: 400, no R2', async () => {
      stubFetch();
      const res = await put('norcar', { Authorization: `Bearer ${TOKEN}` }, {
        ...VALID_BODY,
        sourceUrl: 'http://169.254.169.254/latest/meta-data/',
      });
      expect(res.status).toBe(400);
      expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    });

    it('rejects an allowlisted host whose DNS resolves to a private/loopback IP: 400, no R2', async () => {
      stubFetch();
      // Build an app whose injected DNS resolves the allowlisted host to a
      // loopback address — the DNS-rebinding / repointed-host case.
      const loopbackApp = createApp({
        pool: db.pool,
        storage: createStorage(),
        token: TOKEN,
        dnsLookup: async () => [{ address: '127.0.0.1', family: 4 }],
      });
      const res = await put(
        'norcar',
        { Authorization: `Bearer ${TOKEN}` },
        VALID_BODY,
        loopbackApp,
      );
      expect(res.status).toBe(400);
      expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    });

    it('rejects a 3xx whose Location points at an internal host: 400, no R2', async () => {
      // First fetch: an allowlisted host that 302-redirects to an internal IP.
      // The guard must re-run on the Location before re-issuing and reject it,
      // so the second (image) fetch never returns bytes to R2.
      vi.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
        const u = typeof input === 'string' ? input : input.url;
        if (u.includes('api.cloudflare.com')) {
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
        if (u.startsWith('https://static.inaturalist.org')) {
          return new Response(null, {
            status: 302,
            headers: { Location: 'http://169.254.169.254/latest/meta-data/' },
          });
        }
        // Should never be reached — the redirect target is rejected first.
        return new Response(JPEG_BODY, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
      });
      const res = await put('norcar', { Authorization: `Bearer ${TOKEN}` }, VALID_BODY);
      expect(res.status).toBe(400);
      expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    });

    it('an IMDS HTML/JSON body that somehow reaches validatePhotoImage is rejected by MIME (no R2)', async () => {
      // Defense-in-depth: even if a body reaches validation, a non-image MIME
      // (what IMDS returns) is rejected before R2 — asserting the MIME floor.
      stubFetch({ imageBody: Buffer.from('{"AccessKeyId":"x"}'), imageMime: 'application/json' });
      const res = await put('norcar', { Authorization: `Bearer ${TOKEN}` }, VALID_BODY);
      expect(res.status).toBe(400);
      expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    });
  });

  // ── Body-size cap (OOM hardening) ───────────────────────────────────────────
  // The handler buffers the fetched body with response.arrayBuffer(); a
  // multi-GB body from a trusted-but-compromised or buggy allowlisted host
  // would OOM the 256Mi admin service. MAX_PHOTO_BYTES (15 MB) caps it, enforced
  // both on the advertised content-length (cheap, pre-read) and on the realized
  // byteLength (backstop for a missing or lying header). Each case must return a
  // 4xx AND perform zero R2 writes.
  describe('body-size cap', () => {
    const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

    it('an over-cap content-length header is rejected (4xx) BEFORE reading, no R2 write', async () => {
      // Advertise a 20 MB content-length on a (valid-magic) JPEG body. The
      // handler must reject on the header alone — it never reaches validation
      // or R2. The body itself is small so this is purely the header check.
      vi.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
        const u = typeof input === 'string' ? input : input.url;
        if (u.includes('api.cloudflare.com')) {
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
        return new Response(JPEG_BODY, {
          status: 200,
          headers: {
            'Content-Type': 'image/jpeg',
            'Content-Length': String(MAX_PHOTO_BYTES + 5 * 1024 * 1024),
          },
        });
      });
      const res = await put('norcar', { Authorization: `Bearer ${TOKEN}` }, VALID_BODY);
      expect(res.status).toBe(413);
      expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
      const { rows } = await db.pool.query(`SELECT 1 FROM species_photos WHERE species_code = 'norcar'`);
      expect(rows).toHaveLength(0);
    });

    it('a realized body over the cap with no/understated content-length is rejected (4xx), no R2 write', async () => {
      // No Content-Length header (the lying/absent case): the realized body is
      // > MAX_PHOTO_BYTES, so the post-read byteLength backstop must reject it
      // before any R2 upload. Body carries valid JPEG magic so the only thing
      // that can stop it is the size cap.
      const oversizedJpeg = Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        Buffer.alloc(MAX_PHOTO_BYTES + 1024, 0x11),
      ]);
      vi.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
        const u = typeof input === 'string' ? input : input.url;
        if (u.includes('api.cloudflare.com')) {
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
        // Construct a Response WITHOUT a Content-Length header (the Response
        // ctor would otherwise set one for a Buffer) by streaming the body.
        return new Response(oversizedJpeg, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
      });
      const res = await put('norcar', { Authorization: `Bearer ${TOKEN}` }, VALID_BODY);
      expect(res.status).toBe(413);
      expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
      const { rows } = await db.pool.query(`SELECT 1 FROM species_photos WHERE species_code = 'norcar'`);
      expect(rows).toHaveLength(0);
    });

    it('a body exactly at the cap is accepted (200) — boundary is inclusive', async () => {
      // The cap is a strict "greater than" — a body == MAX_PHOTO_BYTES still
      // uploads. Guards against an off-by-one that would reject legitimate
      // large-but-allowed photos.
      const atCapJpeg = Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        Buffer.alloc(MAX_PHOTO_BYTES - 4, 0x11),
      ]);
      expect(atCapJpeg.byteLength).toBe(MAX_PHOTO_BYTES);
      vi.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
        const u = typeof input === 'string' ? input : input.url;
        if (u.includes('api.cloudflare.com')) {
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
        return new Response(atCapJpeg, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
      });
      const res = await put('norcar', { Authorization: `Bearer ${TOKEN}` }, VALID_BODY);
      expect(res.status).toBe(200);
      expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(1);
    });
  });
});

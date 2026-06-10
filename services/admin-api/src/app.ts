import { Hono } from 'hono';
import type { Pool } from '@bird-watch/db-client';
import { insertSpeciesPhoto, getSpeciesPhotos } from '@bird-watch/db-client';
import { bearerAuth } from './auth.js';
import { validateSvg, validatePhotoImage, validateLicense, ValidationError } from './validate.js';
import type { Storage } from './storage.js';
import { purgeSilhouettesJson, purgeSpeciesJson } from './purge.js';
import { assertSafePhotoSource, SsrfError, type DnsLookupAll } from './ssrf-guard.js';

export interface AppDeps {
  pool: Pool;
  storage: Storage;
  token: string;
  /**
   * Override for the SSRF guard's `dns.lookup(host, { all: true })`. Injectable
   * so tests drive the resolved-to-private-IP cases without real DNS; defaults
   * to node:dns inside `assertSafePhotoSource`.
   */
  dnsLookup?: DnsLookupAll;
}

/** Max 3xx hops the species-photo fetch follows (each re-validated). */
const MAX_PHOTO_REDIRECTS = 2;

/**
 * Upper bound on the fetched photo body (15 MB — generous for a species photo;
 * the largest real iNat/Wikimedia originals sit well under this). The admin
 * service runs on a 256Mi container, so an uncapped `response.arrayBuffer()`
 * against a trusted-but-compromised or buggy allowlisted host could buffer a
 * multi-GB body and OOM the process. Enforced twice: against the advertised
 * `content-length` (cheap reject BEFORE reading), and against the realized
 * `byteLength` after the read (a missing or lying content-length still can't
 * exceed the cap). Both rejections happen before any R2 write.
 */
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

const FAMILY_CODE = /^[a-z]+$/;
// eBird species codes are lowercase alphanumerics (e.g. norcar, x00013).
const SPECIES_CODE = /^[a-z0-9]+$/;

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.get('/health', c => c.json({ ok: true }));

  app.use('/admin/*', bearerAuth(deps.token));

  app.put('/admin/silhouettes/family/:code', async c => {
    const code = c.req.param('code');
    if (!FAMILY_CODE.test(code)) {
      return c.json({ error: 'invalid family code' }, 400);
    }
    const form = await c.req.formData();
    const file = form.get('file');
    if (!(file instanceof Blob)) {
      return c.json({ error: 'file field missing' }, 400);
    }
    const body = Buffer.from(await file.arrayBuffer());

    let validated;
    try {
      validated = validateSvg(body);
    } catch (err) {
      if (err instanceof ValidationError) {
        return c.json({ error: err.message }, 400);
      }
      throw err;
    }

    // Confirm the family row exists before any side effect.
    const existing = await deps.pool.query<{ svg_url: string | null }>(
      `SELECT svg_url FROM family_silhouettes WHERE family_code = $1`,
      [code],
    );
    if (existing.rows.length === 0) {
      return c.json({ error: `unknown family_code: ${code}` }, 404);
    }

    // Upload first; only update DB if R2 succeeded. Order matters: a DB write
    // pointing at a non-existent key would render broken images.
    const put = await deps.storage.putSilhouette(code, validated.source);

    // If a prior silhouette object exists in R2, delete it before swapping the
    // DB pointer. Keys are content-addressed (sha-suffixed) so the new PUT will
    // never collide with the prior key — leaving the old object behind would
    // leak an immutable R2 object on every overwrite. Mirror the DELETE
    // handler's cleanup pattern; non-fatal on failure (DB UPDATE is the
    // load-bearing part, R2 cleanup is hygiene).
    const priorUrl = existing.rows[0]!.svg_url;
    if (priorUrl) {
      try {
        const priorKey = new URL(priorUrl).pathname.replace(/^\//, '');
        if (priorKey !== put.key) {
          await deps.storage.deleteSilhouette(priorKey);
        }
      } catch (err) {
        console.warn(`[admin-api] R2 cleanup of prior object failed: ${err}`);
      }
    }

    await deps.pool.query(
      `UPDATE family_silhouettes SET svg_url = $1, svg_data = $2 WHERE family_code = $3`,
      [put.url, validated.pathD, code],
    );

    const purge = await purgeSilhouettesJson();
    if (!purge.ok) {
      c.header('X-Purge-Status', 'failed');
      console.warn(`[admin-api] purge failed: ${purge.error}`);
    }

    return c.json({ url: put.url, key: put.key, pathD: validated.pathD });
  });

  app.delete('/admin/silhouettes/family/:code', async c => {
    const code = c.req.param('code');
    if (!FAMILY_CODE.test(code)) {
      return c.json({ error: 'invalid family code' }, 400);
    }
    const existing = await deps.pool.query<{ svg_url: string | null }>(
      `SELECT svg_url FROM family_silhouettes WHERE family_code = $1`,
      [code],
    );
    if (existing.rows.length === 0) {
      return c.json({ error: `unknown family_code: ${code}` }, 404);
    }
    const prevUrl = existing.rows[0]!.svg_url;

    if (prevUrl) {
      // Derive key from URL: prefix-strip "https://silhouettes.bird-maps.com/"
      // The public prefix is configurable; recover the key from the URL by
      // splitting on the bucket-path boundary.
      const url = new URL(prevUrl);
      const key = url.pathname.replace(/^\//, '');
      try {
        await deps.storage.deleteSilhouette(key);
      } catch (err) {
        console.warn(`[admin-api] R2 delete failed for ${key}: ${err}`);
        // Continue — DB null-out is still the right outcome from the
        // operator's perspective. The R2 object becomes orphaned at worst.
      }
    }

    await deps.pool.query(
      `UPDATE family_silhouettes SET svg_url = NULL, svg_data = NULL WHERE family_code = $1`,
      [code],
    );

    const purge = await purgeSilhouettesJson();
    if (!purge.ok) {
      c.header('X-Purge-Status', 'failed');
      console.warn(`[admin-api] purge failed: ${purge.error}`);
    }

    return c.json({ ok: true });
  });

  app.put('/admin/species-photos/:speciesCode', async c => {
    const speciesCode = c.req.param('speciesCode');
    if (!SPECIES_CODE.test(speciesCode)) {
      return c.json({ error: 'invalid species code' }, 400);
    }

    let payload: { sourceUrl?: unknown; attribution?: unknown; license?: unknown };
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: 'body must be JSON' }, 400);
    }
    const { sourceUrl, attribution, license } = payload;
    if (typeof sourceUrl !== 'string' || typeof attribution !== 'string' || typeof license !== 'string') {
      return c.json({ error: 'sourceUrl, attribution, license are required strings' }, 400);
    }

    // License backstop FIRST — cheapest deny, before any network fetch.
    let normalizedLicense: string;
    try {
      normalizedLicense = validateLicense(license);
    } catch (err) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
      throw err;
    }

    // Confirm the species row exists before any side effect (mirrors the
    // silhouette 404-existence check — a photo for an unknown species would
    // FK-fail on insert and leave an orphaned R2 object).
    const existing = await deps.pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM species_meta WHERE species_code = $1`,
      [speciesCode],
    );
    if (existing.rows[0]!.count === '0') {
      return c.json({ error: `unknown species_code: ${speciesCode}` }, 404);
    }

    // Fetch the source image server-side (the local tool ships a URL, not
    // bytes). Must 200 and be image/*.
    //
    // SSRF GUARD (issue #966 security addendum): validate the URL BEFORE every
    // fetch — https-only, host allowlist, and reject any host that DNS-resolves
    // to an internal range. Redirects are followed manually (redirect:
    // 'manual') so a 3xx Location pointing at internal space is re-validated
    // before we re-issue, capped at MAX_PHOTO_REDIRECTS hops.
    let body: Buffer;
    let mime: string;
    try {
      let currentUrl = sourceUrl;
      let response: Response | undefined;
      for (let hop = 0; hop <= MAX_PHOTO_REDIRECTS; hop++) {
        await assertSafePhotoSource(currentUrl, { lookup: deps.dnsLookup });
        const fetched = await fetch(currentUrl, {
          redirect: 'manual',
          signal: AbortSignal.timeout(15_000),
        });
        if (fetched.status >= 300 && fetched.status < 400) {
          const location = fetched.headers.get('location');
          if (!location) {
            return c.json({ error: `source fetch redirect (${fetched.status}) without Location` }, 400);
          }
          // Resolve relative redirects against the current URL, then re-guard
          // on the next loop iteration.
          currentUrl = new URL(location, currentUrl).toString();
          continue;
        }
        response = fetched;
        break;
      }
      if (!response) {
        return c.json({ error: `source fetch exceeded ${MAX_PHOTO_REDIRECTS} redirects` }, 400);
      }
      if (!response.ok) {
        return c.json({ error: `source fetch failed: status ${response.status}` }, 400);
      }
      // Size cap, pass 1: reject on the advertised content-length BEFORE
      // reading the body, so an honestly-large response never allocates. A
      // multi-GB body against the 256Mi admin service would otherwise OOM.
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_PHOTO_BYTES) {
        return c.json(
          { error: `source body too large (${declaredLength} bytes; max ${MAX_PHOTO_BYTES})` },
          413,
        );
      }
      mime = (response.headers.get('content-type') ?? '').split(';')[0]!.trim();
      body = Buffer.from(await response.arrayBuffer());
      // Size cap, pass 2: a missing or understated content-length can't slip a
      // larger body past pass 1 — re-check the realized size before any R2
      // write. (arrayBuffer() has already buffered the bytes; this is the
      // backstop for a lying header, not the primary defense.)
      if (body.byteLength > MAX_PHOTO_BYTES) {
        return c.json(
          { error: `source body too large (${body.byteLength} bytes; max ${MAX_PHOTO_BYTES})` },
          413,
        );
      }
    } catch (err) {
      if (err instanceof SsrfError) {
        return c.json({ error: `source URL rejected: ${err.message}` }, 400);
      }
      return c.json({ error: `source fetch error: ${err instanceof Error ? err.message : String(err)}` }, 400);
    }

    let validated;
    try {
      validated = validatePhotoImage(body, mime);
    } catch (err) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
      throw err;
    }

    // ── R2 BEFORE DB ──────────────────────────────────────────────────────
    // Upload first; only write the DB url if R2 succeeded. A DB row pointing
    // at a not-yet-uploaded key would render a broken image; a failed DB write
    // after upload only leaks an unreferenced R2 object (hygiene). The
    // species-photo.test.ts ordering case asserts this directly: a forced
    // insert failure leaves exactly one PutObject and zero live rows.
    const put = await deps.storage.putSpeciesPhoto(speciesCode, validated.source, mime, validated.ext);

    // Read the prior object key BEFORE the upsert overwrites the url, so we can
    // best-effort delete it after (content-hashed keys never collide, so the
    // old immutable object would otherwise leak on every swap).
    const prior = await getSpeciesPhotos(deps.pool, speciesCode);
    const priorDetail = prior.find(p => p.purpose === 'detail-panel');

    await insertSpeciesPhoto(deps.pool, {
      speciesCode,
      purpose: 'detail-panel',
      url: put.url,
      attribution,
      license: normalizedLicense,
    });

    if (priorDetail) {
      try {
        const priorUrl = new URL(priorDetail.url);
        const priorKey = priorUrl.pathname.replace(/^\//, '');
        if (priorKey !== put.key && priorKey.startsWith('species/')) {
          await deps.storage.deleteSpeciesPhoto(priorKey);
        }
      } catch (err) {
        console.warn(`[admin-api] R2 cleanup of prior photo failed: ${err}`);
      }
    }

    const purge = await purgeSpeciesJson(speciesCode);
    if (!purge.ok) {
      c.header('X-Purge-Status', 'failed');
      console.warn(`[admin-api] species purge failed: ${purge.error}`);
    }

    return c.json({ url: put.url, key: put.key });
  });

  app.onError((err, c) => {
    console.error('Unhandled error', err);
    return c.json({ error: 'internal' }, 500);
  });

  return app;
}

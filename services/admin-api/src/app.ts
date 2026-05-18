import { Hono } from 'hono';
import { bearerAuth } from './auth.js';
import { validateSvg, ValidationError } from './validate.js';
import type { Storage } from './storage.js';
import { purgeSilhouettesJson } from './purge.js';

/**
 * The app only uses `.query<R>(sql, params)` on its pool. Both the raw
 * pg.Pool from @bird-watch/db-client AND the DualPool wrapper in
 * `./dual-pool.js` satisfy this shape, so we accept either —
 * `local.ts` decides which one to construct based on whether
 * SECONDARY_DATABASE_URL is set.
 */
export interface AppPool {
  query<R = unknown>(sql: string, params?: readonly unknown[]): Promise<{ rows: R[]; rowCount: number }>;
}

export interface AppDeps {
  pool: AppPool;
  storage: Storage;
  token: string;
}

const FAMILY_CODE = /^[a-z]+$/;

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

  app.onError((err, c) => {
    console.error('Unhandled error', err);
    return c.json({ error: 'internal' }, 500);
  });

  return app;
}

import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

/**
 * Bearer-token middleware. Compares the request's `Authorization: Bearer
 * <token>` header against `expected` in constant time (Node's
 * `timingSafeEqual`). The constant-time compare requires equal-length
 * buffers; we guard the length check before calling so a length-mismatch
 * is a fast 401 rather than a thrown range-check error from the crypto
 * module.
 *
 * Throws at construction time if `expected` is empty — empty token would
 * silently accept all requests carrying any non-empty Bearer header.
 * Cloud Run's env-from-secret wiring delivers a non-empty string when the
 * secret version exists, so an empty string here means the secret is
 * unbound (deploy misconfiguration); fail fast at boot rather than ship
 * an open endpoint.
 */
export function bearerAuth(expected: string): MiddlewareHandler {
  if (expected.length === 0) {
    throw new Error('ADMIN_API_TOKEN is empty; refusing to bind admin routes');
  }
  const expectedBuf = Buffer.from(expected, 'utf8');
  return async (c, next) => {
    const header = c.req.header('Authorization') ?? '';
    if (!header.startsWith('Bearer ')) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    const got = header.slice('Bearer '.length);
    const gotBuf = Buffer.from(got, 'utf8');
    if (gotBuf.length !== expectedBuf.length) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    if (!timingSafeEqual(gotBuf, expectedBuf)) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    await next();
    return;
  };
}

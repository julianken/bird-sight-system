import type { MiddlewareHandler } from 'hono';

/**
 * Token-bucket rate limit (Layer 3 — defense in depth).
 *
 * Three-layer design:
 *   1. Cloudflare rate-limit rule on /api/* (60 req/min/IP)        — actual ceiling
 *   2. Cloudflare WAF managed challenge for scraper signatures      — broad bot defense
 *   3. This middleware: token bucket per Cloud Run instance         — origin safety net
 *      if a client hits the run.app URL or *.a.run.app directly, bypassing CF.
 *
 * State is in-memory per Cloud Run instance. That's intentional:
 *   - No Redis dependency / no extra connection-pool pressure on Neon
 *   - CF rate-limit is the global ceiling; per-instance budgets only need to
 *     prevent a single instance from exhausting its DB pool when CF is bypassed
 *   - Across N instances, an attacker gets up to N × burst tokens — that's a
 *     known, bounded surplus, and Cloud Run autoscale is the more expensive
 *     failure mode this is sized to prevent
 *
 * Bucket eviction: LRU-by-last-touch, capped at MAX_BUCKETS entries to bound
 * memory under IP-rotation attacks. A bucket that hasn't been touched in
 * >EVICTION_AGE_MS is considered stale; under pressure we drop the oldest.
 */

export interface RateLimitOptions {
  /** Maximum tokens the bucket holds (also: initial fill). */
  burst: number;
  /** Tokens added back per second. 0 = no refill (test only). */
  refillPerSec: number;
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

const MAX_BUCKETS = 10_000;
const EVICTION_AGE_MS = 10 * 60 * 1000;

function extractClientIp(headers: Headers): string {
  // CF-Connecting-IP is the only header CF guarantees against spoofing for
  // traffic that actually transited Cloudflare. For bypass traffic (direct
  // run.app hits) we fall back to X-Forwarded-For's leftmost entry, then to
  // a constant — better to share a bucket among unknown clients than to
  // skip rate-limiting entirely.
  const cf = headers.get('cf-connecting-ip');
  if (cf) return cf;
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return 'unknown';
}

function shouldLimitPath(path: string): boolean {
  // Apply to /api/* only. Explicitly skip /health (uptime probes must always
  // respond) and /api/admin/* (separate auth, separate rate budget if needed).
  if (!path.startsWith('/api/')) return false;
  if (path.startsWith('/api/admin/')) return false;
  return true;
}

export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  const { burst, refillPerSec } = options;
  const buckets = new Map<string, Bucket>();

  function take(key: string, nowMs: number): { allowed: true } | { allowed: false; retryAfterSec: number } {
    let bucket = buckets.get(key);
    if (!bucket) {
      // Evict oldest if we're at the cap. Map iteration order is insertion
      // order; we delete-and-reinsert on every hit below so the oldest entry
      // is genuinely the least-recently-used.
      if (buckets.size >= MAX_BUCKETS) {
        const oldest = buckets.keys().next().value;
        if (oldest !== undefined) buckets.delete(oldest);
      }
      bucket = { tokens: burst, lastRefillMs: nowMs };
    } else {
      const elapsedMs = nowMs - bucket.lastRefillMs;
      if (elapsedMs > 0 && refillPerSec > 0) {
        const refill = (elapsedMs / 1000) * refillPerSec;
        bucket.tokens = Math.min(burst, bucket.tokens + refill);
        bucket.lastRefillMs = nowMs;
      } else if (elapsedMs > 0) {
        // refillPerSec === 0: just advance the clock so LRU eviction stays accurate
        bucket.lastRefillMs = nowMs;
      }
      // LRU bookkeeping: re-insert to move to most-recently-used end
      buckets.delete(key);
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      buckets.set(key, bucket);
      return { allowed: true };
    }

    buckets.set(key, bucket);
    // Seconds until 1 full token is available. Ceil so Retry-After is never
    // 0 (an over-the-limit response with Retry-After: 0 invites instant retry
    // that will also fail — defeats the purpose of the header).
    const deficit = 1 - bucket.tokens;
    const retryAfterSec = refillPerSec > 0
      ? Math.max(1, Math.ceil(deficit / refillPerSec))
      : 60; // No refill configured → suggest a minute (test-only path)
    return { allowed: false, retryAfterSec };
  }

  // Opportunistic stale-bucket sweep. Runs at most once per N calls so the
  // hot path stays O(1); the cost amortizes to roughly one full Map scan per
  // MAX_BUCKETS / 64 requests, which is negligible.
  let sweepCounter = 0;
  function maybeSweep(nowMs: number): void {
    sweepCounter = (sweepCounter + 1) & 63;
    if (sweepCounter !== 0) return;
    for (const [key, bucket] of buckets) {
      if (nowMs - bucket.lastRefillMs > EVICTION_AGE_MS) buckets.delete(key);
      else break; // insertion-order Map → first non-stale entry means rest are fresher
    }
  }

  return async (c, next) => {
    if (!shouldLimitPath(c.req.path)) return next();

    const nowMs = Date.now();
    maybeSweep(nowMs);
    const key = extractClientIp(c.req.raw.headers);
    const result = take(key, nowMs);

    if (result.allowed) return next();

    c.header('Retry-After', String(result.retryAfterSec));
    return c.json({ error: 'rate limit exceeded' }, 429);
  };
}

/** Read burst/refill from env with the defaults documented in CLAUDE.md. */
export function rateLimitFromEnv(): MiddlewareHandler {
  const burst = Number(process.env.READ_API_RATE_BURST ?? '60');
  const refillPerSec = Number(process.env.READ_API_RATE_REFILL_PER_SEC ?? '1');
  return rateLimit({ burst, refillPerSec });
}

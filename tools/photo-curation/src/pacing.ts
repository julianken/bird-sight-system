// ─────────────────────────────────────────────────────────────────────────────
// Conservative external-API pacing (ADDENDUM, #992).
//
// Every external call the curation tool makes must be deliberately gentle:
//
//   • iNaturalist (third-party)        — ≤ 1 req/sec sustained (pace ≥ 1100 ms).
//   • bird-maps.com edge (Cloudflare)  — ≥ 1.1 s between image downloads, serial,
//                                         because CF rate-limits 60 req/min/IP.
//
// The pacing is injectable so the fast unit tests assert spacing deterministically
// via a fake clock — they NEVER incur a real wall-clock wait. Production callers
// default to `realClock`.
// ─────────────────────────────────────────────────────────────────────────────

/** Canonical inter-call pacing constants (ms). */
export const INAT_PACE_MS = 1_100; // ≤1 req/sec to iNat, with margin (≥1000).
export const EDGE_PACE_MS = 1_100; // ≥1.1 s between bird-maps.com edge requests.

/**
 * Injected clock seam. `now()` returns monotonic-ish ms (Date.now in prod);
 * `sleep(ms)` resolves after `ms`. Tests pass a fake clock that advances a
 * virtual `now` and records every requested sleep WITHOUT a real timer, so a
 * suite asserting ≥1.1 s spacing runs in microseconds.
 */
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

/** The production clock: real `Date.now` + a real `setTimeout`-backed sleep. */
export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
};

/**
 * Enforces a minimum interval between successive external calls. Call `gate()`
 * immediately BEFORE each request: the first call returns without waiting, and
 * every later call sleeps just enough that consecutive calls are ≥ `minIntervalMs`
 * apart (measured from the prior call's start). This gives a steady ≤ 1/interval
 * request rate without sitting idle for `interval * N` on an N-item run.
 */
export class Pacer {
  private lastStart: number | null = null;
  constructor(
    private readonly minIntervalMs: number,
    private readonly clock: Clock = realClock,
  ) {}

  /** Wait (if needed) so this call starts ≥ minIntervalMs after the previous one. */
  async gate(): Promise<void> {
    const now = this.clock.now();
    if (this.lastStart !== null) {
      const elapsed = now - this.lastStart;
      const wait = this.minIntervalMs - elapsed;
      if (wait > 0) {
        await this.clock.sleep(wait);
      }
    }
    // Stamp the *post-wait* time so back-to-back gates chain correctly.
    this.lastStart = this.clock.now();
  }
}

/** A transient (retryable) upstream failure — 429 or 5xx. */
export interface RetryableError {
  status?: number;
  /**
   * Explicit non-retryable marker, checked BEFORE any status/message heuristic.
   * Callers set it when they KNOW retrying is pointless (e.g. the Gemini judge
   * marks a daily-quota 429 — the cap won't un-drain inside any backoff window).
   * Keeps domain knowledge on the error, not in this generic module (#1036).
   */
  nonTransient?: boolean;
  /**
   * Server-provided minimum delay before the next attempt, in ms (e.g. Google's
   * `RetryInfo.retryDelay`). `withBackoff` sleeps at least this long.
   */
  retryDelayMs?: number;
}

/** Whether an error is a transient upstream failure worth retrying (429 / 5xx). */
export function isTransient(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  if ((err as RetryableError).nonTransient === true) return false;
  const status = (err as RetryableError).status;
  if (typeof status === 'number') {
    return status === 429 || status >= 500;
  }
  // Plain Error from `download` helpers carries the status in its message
  // (`download 429 for …`, `read-api 503 for …`). Treat 429/5xx text as transient.
  if (err instanceof Error) {
    return /\b(429|5\d\d)\b/.test(err.message);
  }
  return false;
}

export interface BackoffOptions {
  /** Bounded retry count on transient failures (default 3 → 4 attempts total). */
  maxRetries?: number;
  /** Base backoff in ms; doubles each attempt, full-jitter applied (default 500). */
  baseMs?: number;
  clock?: Clock;
  /** Injectable randomness for the jitter (default Math.random) — test seam. */
  random?: () => number;
}

/**
 * Run `fn` with jittered exponential backoff on transient (429/5xx) failures.
 * Non-transient errors throw immediately (a 404 is a bug, not flakiness). After
 * `maxRetries` transient failures the last error is rethrown so the CALLER can
 * abort the species (not the whole batch). Full-jitter variant (AWS write-up):
 * `sleep(random() * base * 2^attempt)`. When the error carries a server retry
 * hint (`retryDelayMs`), the sleep is `max(hint, jittered)` — a jittered 0.5–2 s
 * wait inside a 13–38 s drained-quota window is guaranteed to fail again.
 */
export async function withBackoff<T>(
  fn: () => Promise<T>,
  opts: BackoffOptions = {},
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 3;
  const baseMs = opts.baseMs ?? 500;
  const clock = opts.clock ?? realClock;
  const random = opts.random ?? Math.random;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isTransient(err) || attempt === maxRetries) break;
      const ceiling = baseMs * Math.pow(2, attempt);
      const withJitter = Math.floor(random() * ceiling);
      const hint = (err as RetryableError).retryDelayMs;
      await clock.sleep(typeof hint === 'number' ? Math.max(hint, withJitter) : withJitter);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** The candidate-pool cap per species (top-N) — bound the iNat fetch + downloads. */
export const CANDIDATE_POOL_CAP = 12;

/** Clamp a requested candidate pool into [1, CANDIDATE_POOL_CAP]. */
export function clampPool(n: number): number {
  return Math.max(1, Math.min(CANDIDATE_POOL_CAP, Math.trunc(n) || 1));
}

import type { WikipediaSummary } from './types.js';

// User-Agent header value identifying the app to Wikipedia. Wikimedia's REST
// API etiquette page (https://en.wikipedia.org/api/rest_v1/) asks for a
// contactable UA string so they can reach the maintainer if a problem is
// observed. Anonymous UAs get throttled or blocked. Matches the iNat
// convention at services/ingestor/src/inat/client.ts:10 — same ownership,
// same contact surface.
const USER_AGENT = 'bird-maps.com/1.0 (https://bird-maps.com)';

// All Wikipedia text extracts are licensed under CC-BY-SA-4.0 per
// https://en.wikipedia.org/wiki/Wikipedia:Copyrights. The REST summary
// payload doesn't echo this back, so we hard-code it here. A future change
// in Wikipedia's licensing would ripple across thousands of consumers and
// we'd notice — re-verify at the next quarterly drift sweep.
const WIKIPEDIA_LICENSE = 'CC-BY-SA-4.0' as const;

const WIKIPEDIA_BASE_URL = 'https://en.wikipedia.org/api/rest_v1';

/** Options for `fetchWikipediaSummary`. */
export interface FetchWikipediaOptions {
  baseUrl?: string;
  /**
   * Prior `ETag` from a previous fetch. When provided, the helper sends
   * `If-None-Match: <priorEtag>` and Wikipedia returns 304 Not Modified
   * when the page is unchanged. The writer (child #371) uses 304 to skip
   * DOMPurify + DB-write — that's the whole point of conditional GET here.
   */
  priorEtag?: string;
  /** Total attempts on transient failures (429 / 5xx). Default 1 retry => 2 total attempts. */
  maxRetries?: number;
  retryBaseMs?: number;
  requestTimeoutMs?: number;
}

/**
 * Raw subset of Wikipedia's `/api/rest_v1/page/summary/{title}` response
 * we care about. The full payload includes ~30 fields (thumbnail,
 * coordinates, descriptions, etc.); we only project what the writer needs.
 */
interface RawWikipediaSummary {
  extract_html?: string;
  revision?: string;
}

/**
 * Fetches the Wikipedia REST summary for `title`. Returns:
 * - `{ notModified: false, extractHtml, revisionId, license, etag }` on 200
 * - `{ notModified: true, etag }` on 304 (when `opts.priorEtag` was provided)
 * - `null` on 404 (deleted/renamed pages — caller skips)
 *
 * Throws on:
 * - 4xx other than 404 / 429 (programming error — bad title encoding, etc.)
 * - 5xx after retry exhaustion (Wikipedia-side outage)
 * - 429 after retry exhaustion (rate-limited even after backoff)
 * - Malformed 200 payload (missing `extract_html`)
 *
 * Mirrors the iNat helper at `inat/client.ts:fetchInatPhoto` for retry
 * semantics (1 retry default, full-jitter exponential backoff). Both share
 * the same maintainer contact via the matching User-Agent.
 */
export async function fetchWikipediaSummary(
  title: string,
  opts: FetchWikipediaOptions = {}
): Promise<WikipediaSummary | null> {
  const baseUrl = opts.baseUrl ?? WIKIPEDIA_BASE_URL;
  const maxRetries = opts.maxRetries ?? 1;
  const retryBaseMs = opts.retryBaseMs ?? 250;
  const requestTimeoutMs = opts.requestTimeoutMs ?? 30_000;

  // encodeURIComponent handles spaces (becoming %20), apostrophes (%27),
  // and other reserved characters that appear in real bird page titles
  // (e.g. "Bullock's_oriole"). Wikipedia accepts both `_` and `%20` in
  // path segments — we don't normalize to either; we pass the title
  // through verbatim and let URL encoding handle the rest.
  const url = `${baseUrl}/page/summary/${encodeURIComponent(title)}`;

  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    accept: 'application/json',
  };
  if (opts.priorEtag !== undefined) {
    headers['If-None-Match'] = opts.priorEtag;
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(requestTimeoutMs),
      });

      // 404: page doesn't exist (deleted, renamed, never created). Caller
      // treats null as "skip this species, log, continue" — matches the
      // iNat client's null-on-empty contract.
      if (res.status === 404) {
        return null;
      }

      // 304: page unchanged since priorEtag. Echo etag so caller can keep
      // its column populated; fall back to opts.priorEtag when Wikipedia
      // omits the header (rare but observed). Typed as `string` because
      // reaching 304 implies opts.priorEtag was set (see types.ts).
      if (res.status === 304) {
        const echoedEtag = res.headers.get('etag');
        // opts.priorEtag is non-undefined here by construction — 304 only
        // fires when If-None-Match was sent. Non-null assertion would also
        // work; the `?? ''` is a belt-and-suspenders against a future where
        // a caller hand-crafts a 304 path without priorEtag.
        const etag = echoedEtag ?? opts.priorEtag ?? '';
        return { notModified: true, etag };
      }

      // 429 / 5xx: transient — retry. 4xx (other than 404 / 429) is a
      // programming error and surfaces immediately.
      if (res.status === 429 || res.status >= 500) {
        throw new WikipediaTransientError(res.status, await res.text());
      }
      if (!res.ok) {
        throw new WikipediaClientError(res.status, await res.text());
      }

      // 200 OK: parse and project. Missing `extract_html` is treated as a
      // contract violation — surface loudly rather than persist a NULL or
      // empty-string extract.
      const body = (await res.json()) as RawWikipediaSummary;
      if (typeof body.extract_html !== 'string') {
        throw new Error(
          `Wikipedia summary response missing extract_html (title=${title})`
        );
      }
      const revision = typeof body.revision === 'string' ? body.revision : '';
      return {
        notModified: false,
        extractHtml: body.extract_html,
        revisionId: revision,
        license: WIKIPEDIA_LICENSE,
        etag: res.headers.get('etag'),
      };
    } catch (err) {
      lastError = err;
      // 4xx (non-429, non-404) is a programming error — don't retry.
      if (err instanceof WikipediaClientError) throw err;
      // Malformed-payload error from above — don't retry; the next attempt
      // would just re-throw the same shape.
      if (
        err instanceof Error &&
        err.message.startsWith('Wikipedia summary response missing extract_html')
      ) {
        throw err;
      }
      if (attempt === maxRetries) break;
      // Full-jitter exponential backoff (AWS write-up variant) — same shape
      // as the iNat helper. retryBaseMs * 2^attempt is the upper bound;
      // the jitter randomizes inside [0, upper).
      const backoff = retryBaseMs * Math.pow(2, attempt);
      const withJitter = Math.floor(Math.random() * backoff);
      await sleep(withJitter);
    }
  }
  if (isAbortError(lastError)) {
    throw new WikipediaTransientError(
      0,
      `Request timed out after ${requestTimeoutMs}ms`
    );
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export class WikipediaClientError extends Error {
  constructor(public status: number, public body: string) {
    super(`Wikipedia client error ${status}: ${body}`);
    this.name = 'WikipediaClientError';
  }
}

export class WikipediaTransientError extends Error {
  constructor(public status: number, public body: string) {
    super(`Wikipedia transient error ${status}: ${body}`);
    this.name = 'WikipediaTransientError';
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** True for both manual AbortController aborts and AbortSignal.timeout() expirations. */
function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'AbortError' || err.name === 'TimeoutError')
  );
}

import type {
  InatObservationsResponse,
  InatPhoto,
} from './types.js';
import {
  INAT_USER_AGENT,
  INAT_BASE_URL,
  CC_LICENSES,
  buildTiers,
  toMediumUrl,
  type Tier,
} from './inat-shared.js';

// Re-exported for backward compatibility: taxon-client.ts and the existing
// client.test.ts import these from './client.js'. The definitions now live in
// inat-shared.ts (Slice 3 extraction); re-exporting keeps every existing
// import path valid.
export { INAT_USER_AGENT, type Tier };

export interface FetchInatPhotoOptions {
  baseUrl?: string;
  /** Total attempts on transient failures (429 / 5xx). Default 1 retry => 2 total attempts. */
  maxRetries?: number;
  retryBaseMs?: number;
  requestTimeoutMs?: number;
  /**
   * Test-only override of the tier cascade. Production callers pass nothing —
   * the cascade is built from `INAT_PLACE_ID` at call time. Tests use this to
   * pin a deterministic tier list without touching process.env (which can
   * leak between vitest workers).
   */
  tiers?: readonly Tier[];
}

/**
 * Fetches a single best-quality, CC-licensed, research-grade observation
 * photo from iNaturalist for the given binomial taxonomic name. Returns null
 * when iNat reports zero hits — callers (run-photos.ts) treat null as "skip
 * this species, log, continue".
 *
 * Retries once on transient failures (429, 5xx, network/timeout). 4xx other
 * than 429 throws immediately — those represent malformed requests, not
 * iNat-side flakiness, and retrying would only obscure the bug.
 */
export async function fetchInatPhoto(
  taxonName: string,
  opts: FetchInatPhotoOptions = {}
): Promise<InatPhoto | null> {
  const baseUrl = opts.baseUrl ?? INAT_BASE_URL;
  const maxRetries = opts.maxRetries ?? 1;
  const retryBaseMs = opts.retryBaseMs ?? 250;
  const requestTimeoutMs = opts.requestTimeoutMs ?? 30_000;

  const tiers = opts.tiers ?? buildTiers();
  for (const tier of tiers) {
    const url = new URL(`${baseUrl}/observations`);
    url.searchParams.set('taxon_name', taxonName);
    if (tier.placeId !== null) {
      url.searchParams.set('place_id', tier.placeId);
    }
    url.searchParams.set('quality_grade', 'research');
    url.searchParams.set('photo_license', CC_LICENSES);
    url.searchParams.set('order_by', 'votes'); // best-rated first
    url.searchParams.set('per_page', '1');
    url.searchParams.set('photos', 'true'); // only observations that include photos

    const body = await getJsonWithRetry<InatObservationsResponse>(
      url,
      maxRetries,
      retryBaseMs,
      requestTimeoutMs
    );

    const firstResult = body.results[0];
    if (!firstResult) continue;

    const firstPhoto = firstResult.photos[0];
    if (!firstPhoto) continue;

    // iNat's `photo.url` returns a 75px square thumbnail by convention; the
    // shared toMediumUrl helper substitutes 'medium' to get the ~500-800px
    // variant suitable for a detail panel (see inat-shared.ts).
    const mediumUrl = toMediumUrl(firstPhoto.url);

    // photo_license filtering at the API level guarantees a non-null code,
    // but defend against a malformed payload by falling back to an empty
    // string — upstream consumers store the license in a NOT NULL column, so
    // an empty string surfaces "schema violation" loudly rather than crashing
    // here.
    const license = firstPhoto.license_code ?? '';

    // Surface the tier on Tier 2/3 hits so a future "why is this photo
    // showing a Maine bird?" investigation can grep the logs. Silent on
    // Tier 1 (the common case — most species photographed within the
    // configured region).
    if (tier.label !== 'region') {
      // eslint-disable-next-line no-console
      console.log(
        `[fetchInatPhoto] ${taxonName}: matched at tier=${tier.label}`
      );
    }

    return {
      url: mediumUrl,
      attribution: firstPhoto.attribution,
      license,
    };
  }

  return null;
}

/**
 * Shared fetch + retry helper for any iNat /v1/* JSON endpoint. Exported so
 * sibling clients (taxon-client.ts) can use the same retry/UA/timeout
 * semantics without duplicating the loop. 429 and 5xx are transient and
 * trigger the configured retry; other 4xx are programmer errors and surface
 * immediately.
 */
export async function getJsonWithRetry<T>(
  url: URL,
  maxRetries: number,
  retryBaseMs: number,
  requestTimeoutMs: number
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': INAT_USER_AGENT,
          accept: 'application/json',
        },
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      // 429 is treated as transient (rate-limited) — retry. 5xx is also
      // transient — retry. Other 4xx is a programming error and surfaces
      // immediately; retrying would just delay the failure.
      if (res.status === 429 || res.status >= 500) {
        throw new InatTransientError(res.status, await res.text());
      }
      if (!res.ok) {
        throw new InatClientError(res.status, await res.text());
      }
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
      if (err instanceof InatClientError) throw err; // 4xx (non-429) — don't retry
      if (attempt === maxRetries) break;
      // Full-jitter exponential backoff (AWS write-up variant).
      const backoff = retryBaseMs * Math.pow(2, attempt);
      const withJitter = Math.floor(Math.random() * backoff);
      await sleep(withJitter);
    }
  }
  if (isAbortError(lastError)) {
    throw new InatTransientError(
      0,
      `Request timed out after ${requestTimeoutMs}ms`
    );
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export class InatClientError extends Error {
  constructor(public status: number, public body: string) {
    super(`iNat client error ${status}: ${body}`);
    this.name = 'InatClientError';
  }
}

export class InatTransientError extends Error {
  constructor(public status: number, public body: string) {
    super(`iNat transient error ${status}: ${body}`);
    this.name = 'InatTransientError';
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

import type {
  InatObservationsResponse,
  InatPhoto,
} from './types.js';

// User-Agent header value identifying the app to iNaturalist's API. iNat's
// API recommended-practices doc (https://www.inaturalist.org/pages/api+recommended+practices)
// asks for meaningful UA strings so they can contact the app maintainer if a
// problem is observed. Anonymous UAs may be throttled or blocked outright.
const USER_AGENT = 'bird-maps.com/1.0 (https://bird-maps.com)';

// place_id=40 is iNaturalist's canonical "Arizona" Place. Confirmed via
// `GET https://api.inaturalist.org/v1/places/40` returning `name='Arizona'`,
// `place_type=8` (state), `admin_level=10`. Source of truth — do not change
// without re-verifying. Other AZ-shaped places (county, NWR, etc.) have
// different IDs and would silently narrow or skew the photo pool.
const ARIZONA_PLACE_ID = '40';

// place_id=1 is iNaturalist's canonical "United States" Place. Confirmed via
// `GET https://api.inaturalist.org/v1/places/1` returning `name='United States'`,
// `place_type=12` (country), `admin_level=0`. Used as Tier 2 in the photo
// fallback cascade for AZ-rare/vagrant species (e.g. Cave Swallow, Glossy
// Ibis) that have plenty of US research-grade observations elsewhere but no
// AZ hits.
const UNITED_STATES_PLACE_ID = '1';

// Tier cascade for the photo lookup. Tier 1 is the historical AZ-only filter;
// Tier 2 widens to the US; Tier 3 drops the place filter entirely. Each tier
// keeps the same quality_grade/license/order_by constraints — only the
// geographic filter relaxes.
type Tier = { label: 'az' | 'us' | 'global'; placeId: string | null };
const TIERS: readonly Tier[] = [
  { label: 'az', placeId: ARIZONA_PLACE_ID },
  { label: 'us', placeId: UNITED_STATES_PLACE_ID },
  { label: 'global', placeId: null },
];

// CC license codes accepted by `photo_license`. CC-BY-NC* variants are
// excluded because they forbid commercial use; while bird-maps.com is
// non-commercial today, a future donations/grants tier could change that
// classification, and re-licensing every backfilled photo would be painful.
const CC_LICENSES = 'cc-by,cc-by-sa,cc0';

const INAT_BASE_URL = 'https://api.inaturalist.org/v1';

export interface FetchInatPhotoOptions {
  baseUrl?: string;
  /** Total attempts on transient failures (429 / 5xx). Default 1 retry => 2 total attempts. */
  maxRetries?: number;
  retryBaseMs?: number;
  requestTimeoutMs?: number;
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

  for (const tier of TIERS) {
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

    // iNat's `photo.url` returns a 75px square thumbnail by convention. The
    // URL contains the literal segment 'square' (e.g.
    // .../photos/12345/square.jpg); substituting 'medium' yields the
    // ~500-800px variant suitable for a detail panel. iNat publishes the size
    // token convention at https://www.inaturalist.org/pages/help#photos —
    // supported values are square, small, medium, large, original.
    const mediumUrl = firstPhoto.url.replace('square', 'medium');

    // photo_license filtering at the API level guarantees a non-null code,
    // but defend against a malformed payload by falling back to an empty
    // string — upstream consumers store the license in a NOT NULL column, so
    // an empty string surfaces "schema violation" loudly rather than crashing
    // here.
    const license = firstPhoto.license_code ?? '';

    // Surface the tier on Tier 2/3 hits so a future "why is this photo
    // showing a Maine bird?" investigation can grep the logs. Silent on
    // Tier 1 (the common case — most species are AZ-photographed).
    if (tier.label !== 'az') {
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

async function getJsonWithRetry<T>(
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
          'User-Agent': USER_AGENT,
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

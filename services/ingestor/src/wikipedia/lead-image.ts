// Wikipedia lead-image client. Second-tier photo source for the photos
// orchestrator (services/ingestor/src/run-photos.ts) after the iNat cascade
// (AZ -> US -> global) exhausts. Closes issue #483 — the ~6% of AZ-observed
// species (warblers, vagrants, recent migrants) where iNat has zero
// CC-licensed research-grade photos at any tier.
//
// Two-call shape:
//   1. GET /api/rest_v1/page/summary/{title}  -> originalimage.source URL
//   2. GET /w/api.php?action=query&prop=imageinfo&iiprop=extmetadata|url
//        -> license + artist + Commons file URL for attribution
//
// Step 2 is mandatory: bird-maps.com only displays CC / PD images, and the
// summary endpoint does not echo license. Without step 2 we can't filter
// out the long tail of fair-use lead images Wikipedia hosts in `wikipedia/en/`
// rather than `wikipedia/commons/`.
//
// Returns null on any of: summary 404, summary missing originalimage,
// imageinfo missing, license is fair-use / unknown. The orchestrator treats
// null as "skip — fall through to the existing family-silhouette fallback".

const USER_AGENT = 'bird-maps.com/1.0 (https://bird-maps.com)';
const WIKIPEDIA_REST_BASE = 'https://en.wikipedia.org/api/rest_v1';
const WIKIPEDIA_ACTION_BASE = 'https://en.wikipedia.org/w/api.php';

/** Public projection of a Wikipedia lead image — matches `InatPhoto` field shape so the orchestrator can swap sources without conditional branching downstream. */
export interface WikipediaLeadImage {
  /** Direct `upload.wikimedia.org` URL of the lead image. Typically the highest-resolution variant the article links to. */
  url: string;
  /** Human-readable attribution suitable for the `species_photos.attribution` column. Includes artist + license short name + Commons file URL. */
  attribution: string;
  /**
   * Normalized lowercase license code (e.g. `cc-by-4.0`, `cc-by-sa-4.0`,
   * `cc0`, `pd`). Matches the iNat client's `cc-by` / `cc-by-sa` / `cc0`
   * convention with finer-grained version suffixes preserved where the
   * extmetadata supplies them.
   */
  license: string;
}

export interface FetchWikipediaLeadImageOptions {
  baseUrl?: string;
  actionBaseUrl?: string;
  /** Total attempts on transient failures (429 / 5xx). Default 1 retry => 2 total attempts. Mirrors fetchWikipediaSummary / fetchInatPhoto. */
  maxRetries?: number;
  retryBaseMs?: number;
  requestTimeoutMs?: number;
}

/**
 * License codes that bird-maps.com is licensed to display. Anything not on
 * this whitelist (fair-use, ARR, "non-commercial", unknown) returns null
 * from the lead-image client. The list intentionally mirrors the iNat
 * client's `cc-by`, `cc-by-sa`, `cc0` set, plus public-domain variants
 * (PD-USGov, PD-old) that Wikipedia surfaces but iNat doesn't expose.
 *
 * The match is a prefix check on a lowercased license code stripped of
 * whitespace — so `cc-by-4.0`, `cc-by-sa-4.0`, `cc-by-sa-3.0` all match.
 * `cc-by-nc` and `cc-by-nc-sa` are deliberately excluded (NC = no
 * commercial; future donations/grants tiers could reclassify).
 */
const ACCEPTED_LICENSE_PREFIXES = ['cc-by-', 'cc-by-sa-', 'cc0', 'cc-zero', 'pd', 'public domain'] as const;

interface SummaryPayload {
  originalimage?: {
    source: string;
    width?: number;
    height?: number;
  };
  content_urls?: {
    desktop?: { page?: string };
  };
}

interface ImageInfoExtMetadataValue {
  value: string;
}

interface ImageInfoItem {
  url?: string;
  descriptionurl?: string;
  extmetadata?: {
    License?: ImageInfoExtMetadataValue;
    LicenseShortName?: ImageInfoExtMetadataValue;
    LicenseUrl?: ImageInfoExtMetadataValue;
    Artist?: ImageInfoExtMetadataValue;
  };
}

interface ImageInfoPage {
  title?: string;
  missing?: string;
  imageinfo?: ImageInfoItem[];
}

interface ImageInfoResponse {
  query?: {
    pages?: Record<string, ImageInfoPage>;
  };
}

/**
 * Fetches a CC-licensed lead image for the given Wikipedia article title.
 * Returns null when any of:
 *   - summary endpoint 404s
 *   - summary has no originalimage field
 *   - action API returns no imageinfo (missing file, redacted)
 *   - license isn't on ACCEPTED_LICENSE_PREFIXES (fair-use, ARR, NC)
 *
 * Throws on 5xx after retry exhaustion (same retry contract as
 * fetchWikipediaSummary). 4xx other than 404 / 429 throws immediately —
 * those are programmer errors and retrying would only obscure the bug.
 */
export async function fetchWikipediaLeadImage(
  title: string,
  opts: FetchWikipediaLeadImageOptions = {}
): Promise<WikipediaLeadImage | null> {
  const baseUrl = opts.baseUrl ?? WIKIPEDIA_REST_BASE;
  const actionBaseUrl = opts.actionBaseUrl ?? WIKIPEDIA_ACTION_BASE;
  const maxRetries = opts.maxRetries ?? 1;
  const retryBaseMs = opts.retryBaseMs ?? 250;
  const requestTimeoutMs = opts.requestTimeoutMs ?? 30_000;

  // Step 1: summary endpoint. Returns originalimage.source plus the
  // canonical page URL. encodeURIComponent matches the encoding contract of
  // fetchWikipediaSummary at services/ingestor/src/wikipedia/client.ts:76.
  const summaryUrl = `${baseUrl}/page/summary/${encodeURIComponent(title)}`;
  const summary = await getJsonWithRetry<SummaryPayload>(
    summaryUrl,
    maxRetries,
    retryBaseMs,
    requestTimeoutMs,
    { return404AsNull: true }
  );
  if (summary === null) return null;
  if (!summary.originalimage || !summary.originalimage.source) return null;

  // Step 2: derive the File: title from the originalimage URL. Wikipedia's
  // upload URL shape is
  //   https://upload.wikimedia.org/wikipedia/<project>/<a>/<ab>/<filename>
  // ...where <filename> is what we pass to titles=File:<filename>. The
  // segments before <filename> are sharded by the MD5 of the filename and
  // don't matter for lookup.
  const fileTitle = deriveFileTitle(summary.originalimage.source);
  if (fileTitle === null) return null;

  const actionUrl = new URL(actionBaseUrl);
  actionUrl.searchParams.set('action', 'query');
  actionUrl.searchParams.set('prop', 'imageinfo');
  actionUrl.searchParams.set('iiprop', 'extmetadata|url');
  actionUrl.searchParams.set('titles', fileTitle);
  actionUrl.searchParams.set('format', 'json');
  // The action API's format=json defaults to formatversion=1, which nests
  // pages under numeric keys (what our test fixtures assume). Pinning
  // explicitly so a future formatversion=2 default doesn't silently reshape
  // the response.
  actionUrl.searchParams.set('formatversion', '1');

  const action = await getJsonWithRetry<ImageInfoResponse>(
    actionUrl.toString(),
    maxRetries,
    retryBaseMs,
    requestTimeoutMs,
    { return404AsNull: false }
  );
  if (action === null) return null;
  const pages = action.query?.pages;
  if (!pages) return null;

  // Pages is keyed by pageid (positive) or "-1" (missing). Pick the first
  // page that has imageinfo populated. Missing pages have `missing: ""`
  // and no imageinfo — we treat them as null.
  let info: ImageInfoItem | undefined;
  for (const page of Object.values(pages)) {
    if (page.missing !== undefined) continue;
    const first = page.imageinfo?.[0];
    if (first) {
      info = first;
      break;
    }
  }
  if (!info) return null;

  const ext = info.extmetadata ?? {};
  const rawLicense = (ext.License?.value ?? '').trim().toLowerCase();
  const licenseShortName = (ext.LicenseShortName?.value ?? '').trim();
  const artist = stripHtml(ext.Artist?.value ?? '').trim();
  const descriptionUrl = info.descriptionurl ?? '';

  // License whitelist. The action API normalizes most licenses to a
  // lowercase code in the License field (e.g. `cc-by-sa-4.0`, `cc0`, `pd`),
  // but some uploads have only the LicenseShortName populated (e.g. "Public
  // domain"). Check both. `Fair use` and unknown licenses fail the check.
  const licenseHaystack = `${rawLicense} ${licenseShortName.toLowerCase()}`;
  const passes = ACCEPTED_LICENSE_PREFIXES.some((prefix) =>
    licenseHaystack.includes(prefix)
  );
  if (!passes) return null;

  // Normalize the license code we persist. Prefer the machine-readable
  // License field; fall back to a slug of LicenseShortName when only the
  // short name is populated (PD-USGov uploads frequently look this way).
  let license = rawLicense;
  if (!license) {
    license = slugifyLicenseShortName(licenseShortName);
  }

  // Attribution string. Format mirrors what the iNat client returns:
  //   "(c) <Artist>, <LicenseShortName> (Wikimedia Commons - <descriptionUrl>)"
  // The descriptionUrl is the file's page on Commons (or en.wikipedia for
  // local uploads); the frontend renders it as a hyperlink to satisfy the
  // CC-BY/CC-BY-SA attribution requirement.
  const shortName = licenseShortName || license.toUpperCase();
  const artistDisplay = artist || 'Unknown';
  const sourceDisplay = descriptionUrl || 'Wikimedia';
  const attribution = `(c) ${artistDisplay}, ${shortName} (${sourceDisplay})`;

  return {
    url: summary.originalimage.source,
    attribution,
    license,
  };
}

/**
 * Derives the `File:<basename>` title from an `upload.wikimedia.org` URL.
 * Wikipedia upload URLs are shaped like:
 *   https://upload.wikimedia.org/wikipedia/<project>/<x>/<xy>/<filename>
 * The hash-sharded directory segments are an internal CDN detail; only the
 * filename matters for the action API's `titles=` lookup.
 */
function deriveFileTitle(uploadUrl: string): string | null {
  try {
    const u = new URL(uploadUrl);
    const segs = u.pathname.split('/').filter(Boolean);
    const last = segs[segs.length - 1];
    if (!last) return null;
    // The URL is %-encoded; the action API expects the title in unencoded
    // form (the URL constructor handles encoding when we round-trip).
    return `File:${decodeURIComponent(last)}`;
  } catch {
    return null;
  }
}

/**
 * Slugify a LicenseShortName fallback (e.g. "Public domain" -> "pd-public-domain").
 * Used only when the machine-readable License field is empty.
 */
function slugifyLicenseShortName(shortName: string): string {
  const slug = shortName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'unknown';
}

/**
 * Crude HTML stripper for the Artist field. Wikipedia's extmetadata Artist
 * value often contains anchor tags or template artifacts (e.g.
 * `<a href="...">Jane Birder</a>`). We only need the visible text for the
 * attribution string — full HTML parsing would be overkill and would pull
 * in a heavier dep than the rest of the ingestor wants.
 *
 * Mirrors the sanitizer convention in wikipedia/sanitize.ts but inlined
 * here to avoid coupling — the artist string is one line, not a sanitized
 * extract body.
 */
function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ');
}

interface RetryOptions {
  /** When true, a 404 response resolves to null instead of throwing. */
  return404AsNull: boolean;
}

/**
 * Local copy of the retry helper used by the summary and iNat clients,
 * specialized for the lead-image client's two-endpoint shape. Returns null
 * on 404 when `return404AsNull` is true (used for the summary endpoint
 * where a missing article is a normal outcome). 429 / 5xx retry with
 * full-jitter exponential backoff; other 4xx throws immediately.
 */
async function getJsonWithRetry<T>(
  urlOrString: string,
  maxRetries: number,
  retryBaseMs: number,
  requestTimeoutMs: number,
  retryOpts: RetryOptions
): Promise<T | null> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(urlOrString, {
        headers: {
          'User-Agent': USER_AGENT,
          accept: 'application/json',
        },
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (res.status === 404 && retryOpts.return404AsNull) return null;
      if (res.status === 429 || res.status >= 500) {
        throw new WikipediaLeadImageTransientError(res.status, await res.text());
      }
      if (!res.ok) {
        throw new WikipediaLeadImageClientError(res.status, await res.text());
      }
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
      if (err instanceof WikipediaLeadImageClientError) throw err;
      if (attempt === maxRetries) break;
      const backoff = retryBaseMs * Math.pow(2, attempt);
      const withJitter = Math.floor(Math.random() * backoff);
      await sleep(withJitter);
    }
  }
  if (isAbortError(lastError)) {
    throw new WikipediaLeadImageTransientError(
      0,
      `Request timed out after ${requestTimeoutMs}ms`
    );
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export class WikipediaLeadImageClientError extends Error {
  constructor(public status: number, public body: string) {
    super(`Wikipedia lead-image client error ${status}: ${body}`);
    this.name = 'WikipediaLeadImageClientError';
  }
}

export class WikipediaLeadImageTransientError extends Error {
  constructor(public status: number, public body: string) {
    super(`Wikipedia lead-image transient error ${status}: ${body}`);
    this.name = 'WikipediaLeadImageTransientError';
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'AbortError' || err.name === 'TimeoutError')
  );
}

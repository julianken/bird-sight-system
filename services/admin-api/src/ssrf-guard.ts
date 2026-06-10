import { lookup as dnsLookupCb } from 'node:dns';
import { promisify } from 'node:util';
import ipaddr from 'ipaddr.js';

/**
 * SSRF guard for the operator-supplied `sourceUrl` the species-photo handler
 * fetches server-side and mirrors to R2 (issue #966 security addendum).
 *
 * Without this, the handler is a Server-Side Request Forgery sink: an attacker
 * (or a confused-deputy with a compromised admin token) could point `sourceUrl`
 * at cloud-metadata (`http://169.254.169.254/…`) or an internal host and have
 * the server fetch it. Authentication does NOT remove the risk. The guard runs
 * BEFORE any `fetch`, and again on every redirect target.
 */

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

/**
 * Exact host allowlist — the trusted photo origins the ingestor already pulls
 * from. Lowercased, no trailing dot. Aligned with:
 *   - iNaturalist photo CDNs (`services/ingestor/src/inat/client.ts`):
 *     `static.inaturalist.org` (legacy) and
 *     `inaturalist-open-data.s3.amazonaws.com` (open-data bucket).
 *   - Wikimedia (`services/ingestor/src/wikipedia/lead-image.ts`):
 *     `upload.wikimedia.org`.
 *   - `photos.bird-maps.com` — our own served-photos origin (re-mirror case).
 */
export const PHOTO_HOST_ALLOWLIST: ReadonlySet<string> = new Set([
  'static.inaturalist.org',
  'inaturalist-open-data.s3.amazonaws.com',
  'upload.wikimedia.org',
  'photos.bird-maps.com',
]);

/** ipaddr.js `range()` values that designate a non-public / internal target. */
const BLOCKED_RANGES: ReadonlySet<string> = new Set([
  'loopback',
  'private',
  'linkLocal',
  'uniqueLocal',
  'unspecified',
]);

/** `dns.lookup(host, { all: true })` shape — injectable so tests stub DNS. */
export type DnsLookupAll = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>;

const defaultLookup: DnsLookupAll = (() => {
  const promisified = promisify(dnsLookupCb);
  return (hostname: string) =>
    promisified(hostname, { all: true }) as Promise<Array<{ address: string; family: number }>>;
})();

export interface AssertSafePhotoSourceOptions {
  /** Override for `dns.lookup(host, { all: true })`; defaults to node:dns.
   *  Accepts `undefined` so callers can forward an optional dep directly under
   *  `exactOptionalPropertyTypes`. */
  lookup?: DnsLookupAll | undefined;
}

/**
 * Throw `SsrfError` unless `sourceUrl` is safe to fetch server-side:
 *   1. parses as a URL with `protocol === 'https:'`;
 *   2. host (lowercased, trailing-dot-stripped) is on `PHOTO_HOST_ALLOWLIST`;
 *   3. EVERY DNS-resolved address is a public unicast range — rejects if ANY
 *      is loopback/private/link-local/unique-local/unspecified. Resolving and
 *      checking ALL addresses defeats DNS-rebinding and an allowlisted host
 *      repointed at internal space.
 *
 * Resolves to `void` on success. Cheapest denials (scheme, host) short-circuit
 * before the DNS lookup.
 */
export async function assertSafePhotoSource(
  sourceUrl: string,
  opts: AssertSafePhotoSourceOptions = {},
): Promise<void> {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw new SsrfError(`sourceUrl is not a valid URL: ${sourceUrl}`);
  }

  if (url.protocol !== 'https:') {
    throw new SsrfError(`sourceUrl must be https (got ${url.protocol})`);
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!PHOTO_HOST_ALLOWLIST.has(host)) {
    throw new SsrfError(`sourceUrl host not on allowlist: ${host}`);
  }

  const lookup = opts.lookup ?? defaultLookup;
  const resolved = await lookup(host);
  if (resolved.length === 0) {
    throw new SsrfError(`sourceUrl host resolved to no addresses: ${host}`);
  }

  for (const { address } of resolved) {
    let range: string;
    try {
      range = ipaddr.parse(address).range();
    } catch {
      // Unparseable address from DNS — fail closed.
      throw new SsrfError(`sourceUrl host resolved to an unparseable address: ${address}`);
    }
    if (BLOCKED_RANGES.has(range)) {
      throw new SsrfError(
        `sourceUrl host ${host} resolves to a ${range} address (${address}); refusing to fetch`,
      );
    }
  }
}

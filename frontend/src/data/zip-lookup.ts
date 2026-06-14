import type { ZipResolution } from '../state/scope-types.js';

/**
 * Lazy, memoized loader + lookup for the precomputed CONUS ZIP→state index.
 *
 * Why a static asset, not an API proxy: the index is build-time-stable
 * (~1 MB, regenerated only when the ETL re-runs), so it ships as a flat file
 * in `public/` and is CDN-cached. A read-api proxy would add a route, a Cloud
 * SQL round-trip, and a rate-limit surface for zero benefit — rejected. See
 * `docs/notes/zip-delivery.md`.
 *
 * Delivery mechanics (load-bearing):
 *   - The asset is fetched at RUNTIME, never `import`ed — so Vite never inlines
 *     the dataset into the entry chunk (the zip-lookup.test.ts "bundle hygiene"
 *     case guards this). It stays in `public/` and downloads on demand.
 *   - Vite does NOT content-hash `public/` files, so the browser/edge cache
 *     would serve a stale index after the ETL regenerates it. We append a
 *     `?v=<datasetVersion>` cache-bust param. The version is hardcoded to `1`
 *     to match the `v: 1` field in the index schema (D2). INCREMENT BOTH IN
 *     LOCK-STEP whenever the ETL regenerates `frontend/public/zip-index.json`.
 *   - The memo is single-flight: concurrent callers share one in-flight
 *     fetch. On rejection the memo is cleared so a later call (e.g. a second
 *     input focus) retries instead of latching onto the rejected promise.
 */

/** Columnar on-disk shape of `frontend/public/zip-index.json` (D2). */
export interface ZipIndex {
  /** Schema version — kept in lock-step with the ?v= cache-bust param. */
  v: number;
  /** State codes; each ZIP entry's third element indexes into this array. */
  states: string[];
  /** ZIP5 → [lat, lng, stateIdx]. NOTE: [lat, lng], NOT MapLibre order. */
  zips: Record<string, [number, number, number]>;
}

/**
 * Dataset version. Must equal the `v` field emitted by the ZIP ETL into
 * `zip-index.json`. Bump on every regeneration to bust the edge/browser cache.
 */
const ZIP_INDEX_VERSION = 1;

/**
 * The cache-busted URL the index is fetched from. `public/zip-index.json` is
 * served at the site root; the `?v=` param forces a fresh fetch when the
 * dataset version changes (Vite doesn't hash `public/`).
 */
export const ZIP_INDEX_URL = `/zip-index.json?v=${ZIP_INDEX_VERSION}`;

let inflight: Promise<ZipIndex> | null = null;

/**
 * Test-only: clear the module-level memo so suites don't leak a resolved (or
 * rejected) index into one another.
 */
export function __resetZipIndexCache(): void {
  inflight = null;
}

/**
 * Fetch the ZIP index, memoized single-flight. Concurrent callers share one
 * fetch; a rejection clears the memo so a later call retries.
 */
export function loadZipIndex(): Promise<ZipIndex> {
  if (inflight) return inflight;

  const promise = fetch(ZIP_INDEX_URL)
    .then((res) => {
      if (!res.ok) {
        throw new Error(`zip-index fetch failed: ${res.status}`);
      }
      return res.json() as Promise<ZipIndex>;
    })
    .catch((err: unknown) => {
      // Clear the memo so a later focus retries rather than re-resolving the
      // rejected promise.
      if (inflight === promise) inflight = null;
      throw err;
    });

  inflight = promise;
  return promise;
}

/**
 * Normalize and resolve a ZIP. Trims, strips a `-####` ZIP+4 suffix, and
 * requires exactly 5 digits — malformed input returns `null` WITHOUT
 * fetching (the regex gate runs before `loadZipIndex`). A well-formed but
 * unknown ZIP returns `null` AFTER consulting the index. Resolved ZIPs return
 * `center` in `[lng, lat]` (MapLibre) order — the index stores `[lat, lng]`,
 * so the first two elements are swapped here.
 */
export async function lookupZip(raw: string): Promise<ZipResolution | null> {
  const zip5 = raw.trim().replace(/-\d{4}$/, '');
  if (!/^\d{5}$/.test(zip5)) return null;

  const index = await loadZipIndex();
  const entry = index.zips[zip5];
  if (!entry) return null;

  const [lat, lng, stateIdx] = entry;
  const stateCode = index.states[stateIdx];
  if (stateCode === undefined) return null;

  return {
    zip: zip5,
    center: [lng, lat],
    // The ETL only emits CONUS `US-XX` codes into `states`, so this is a
    // StateCode at runtime; the index is typed `string[]` on disk.
    stateCode: stateCode as ZipResolution['stateCode'],
  };
}

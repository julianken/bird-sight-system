import { useEffect, useState } from 'react';
import type { MultiPolygon } from 'geojson';

/**
 * Client state-mask polygons (#760).
 *
 * Lazy-fetches `frontend/public/state-polygons.json` (the `code → MultiPolygon
 * geometry` asset emitted by `scripts/generate-state-boundaries.mjs` — the same
 * run that emits the boundaries migration + `data/us-state-polygons.geojson`,
 * so the client mask edge matches the server's ST_Intersects data-clip edge)
 * and resolves the geometry for the active state scope, so MapCanvas can paint
 * the artboard inverse mask. The payload is static per deploy (regenerated only
 * when the canonical `data/us-state-polygons.geojson` changes), so this module
 * keeps a single in-memory cache shared across consumers — the fetch fires at
 * most once per tab lifetime. Mirrors the module-cache discipline of
 * `use-states.ts` / `use-silhouettes.ts` (#246) and the `zip-lookup.ts`
 * single-flight memo (#730).
 *
 * Failure semantics: a rejected fetch leaves the cache empty (a later mount
 * retries) and the hook surfaces `null` — the mask simply does not render, which
 * degrades to the plain (unmasked) state view rather than throwing.
 *
 * GeoJSON `MultiPolygon` is imported from `geojson` (the @types/geojson module),
 * NOT from `maplibre-gl` — see `components/map/mask.ts` for why. `import type`,
 * erased at build.
 */

/** On-disk shape of `state-polygons.json`: state code → MultiPolygon geometry. */
export type StatePolygonMap = Record<string, MultiPolygon>;

/**
 * Dataset version. Bump when `state-polygons.json` is regenerated to bust the
 * edge/browser cache (Vite doesn't hash `public/`). Mirrors `ZIP_INDEX_VERSION`.
 */
const STATE_POLYGONS_VERSION = 1;

/** Cache-busted URL the asset is fetched from (served at the site root). */
export const STATE_POLYGONS_URL = `/state-polygons.json?v=${STATE_POLYGONS_VERSION}`;

let cache: StatePolygonMap | null = null;
let inflight: Promise<StatePolygonMap> | null = null;

/**
 * Test-only: clear the module-level memo so suites don't leak a resolved (or
 * rejected) map into one another.
 */
export function __resetStatePolygonsCache(): void {
  cache = null;
  inflight = null;
}

/**
 * Fetch the polygon map, memoized single-flight. Concurrent callers share one
 * fetch; a rejection clears the memo so a later call retries.
 */
function loadStatePolygons(): Promise<StatePolygonMap> {
  if (cache !== null) return Promise.resolve(cache);
  if (inflight) return inflight;

  const promise = fetch(STATE_POLYGONS_URL)
    .then((res) => {
      if (!res.ok) {
        throw new Error(`state-polygons fetch failed: ${res.status}`);
      }
      return res.json() as Promise<StatePolygonMap>;
    })
    .then((map) => {
      cache = map;
      return map;
    })
    .catch((err: unknown) => {
      // Clear the memo so a later mount retries rather than re-resolving the
      // rejected promise.
      if (inflight === promise) inflight = null;
      throw err;
    });

  inflight = promise;
  return promise;
}

/**
 * Resolve the MultiPolygon geometry for `code` (the active state scope), or
 * `null` while the asset is loading, for a `null` code (us / chooser scope), or
 * for an unknown code. Never throws — a fetch failure surfaces as `null`.
 */
export function useStatePolygon(code: string | null): MultiPolygon | null {
  const [geometry, setGeometry] = useState<MultiPolygon | null>(() =>
    code !== null && cache !== null ? (cache[code] ?? null) : null,
  );

  useEffect(() => {
    if (code === null) {
      setGeometry(null);
      return;
    }
    // Synchronous cache hit — resolve immediately, no fetch.
    if (cache !== null) {
      setGeometry(cache[code] ?? null);
      return;
    }
    let cancelled = false;
    loadStatePolygons()
      .then((map) => {
        if (!cancelled) setGeometry(map[code] ?? null);
      })
      .catch(() => {
        // Leave the mask unrendered on failure (no throw — degrade gracefully).
        if (!cancelled) setGeometry(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  return geometry;
}

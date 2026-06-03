import { useEffect, useState } from 'react';
import type { ApiClient } from '../api/client.js';
import type { SpeciesDictEntry } from '@bird-watch/shared-types';

/**
 * Species-dictionary hook (#859). Loads the `GET /api/species` payload once
 * and exposes it as a `Map<code, { comName, familyCode }>` so any surface that
 * holds a bare species `code` (the codes carried in aggregated low-zoom buckets,
 * cluster popovers, deep-link hydration) can resolve a display name WITHOUT a
 * per-species fetch.
 *
 * The payload is static per deploy and served with an immutable Cache-Control
 * (the 'species-dict' tier in cache-headers.ts), so this module keeps an
 * in-memory cache shared across all consumers: the fetch fires at most once per
 * tab lifetime regardless of how many components mount the hook (mirrors
 * `useSilhouettes`).
 *
 * Tolerate-not-loaded contract: the returned `dictionary` is ALWAYS a Map
 * (empty until resolved), never undefined, and `.get(unknownCode)` returns
 * `undefined` rather than throwing. Consumers render the bare `code` (or a
 * skeleton) until the name resolves — they MUST NOT crash on a cold dictionary.
 */

export type SpeciesDictionary = ReadonlyMap<string, { comName: string; familyCode: string }>;

let cache: SpeciesDictionary | null = null;
let inflight: Promise<SpeciesDictEntry[]> | null = null;

function buildMap(rows: SpeciesDictEntry[]): SpeciesDictionary {
  const m = new Map<string, { comName: string; familyCode: string }>();
  for (const r of rows) m.set(r.code, { comName: r.comName, familyCode: r.familyCode });
  return m;
}

// Reset helper for tests — module-level caches survive vitest module reloads
// within a single suite otherwise, which would leak state between tests.
export function __resetSpeciesDictionaryCache(): void {
  cache = null;
  inflight = null;
}

export interface SpeciesDictionaryState {
  dictionary: SpeciesDictionary;
  loading: boolean;
  error: Error | null;
}

const EMPTY: SpeciesDictionary = new Map();

export function useSpeciesDictionary(client: ApiClient): SpeciesDictionaryState {
  const [dictionary, setDictionary] = useState<SpeciesDictionary>(cache ?? EMPTY);
  const [loading, setLoading] = useState<boolean>(cache === null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (cache !== null) {
      // Synchronous cache hit: initial state is already correct.
      return;
    }
    let cancelled = false;
    const promise = inflight ?? (inflight = client.getSpeciesDictionary());
    promise
      .then(rows => {
        cache = buildMap(rows);
        if (!cancelled) {
          setDictionary(cache);
          setError(null);
        }
      })
      .catch(err => {
        // Leave cache null so a subsequent mount retries; clear inflight so the
        // retry doesn't latch onto the rejected promise.
        inflight = null;
        if (!cancelled) setError(err as Error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [client]);

  return { dictionary, loading, error };
}

import { useEffect, useState } from 'react';
import type { ApiClient } from '../api/client.js';
import type { FamilySilhouette } from '@bird-watch/shared-types';

/**
 * Family-silhouettes hook. The payload is static per deploy (rows only
 * change via seed migrations, and the Read API returns it with a 1-week
 * `Cache-Control: public, immutable` header — see cache-headers.ts
 * entry 'silhouettes'), so this module keeps an in-memory cache shared
 * across all consumers: the fetch fires at most once per tab lifetime,
 * regardless of how many components mount the hook.
 *
 * Fallback semantics (issue #55 option (a)): components rendering a
 * family-color surface must not throw if the response is mid-flight or a
 * given family code is absent from the response. Compose this hook with
 * `buildFamilyColorResolver` from `./family-color.js` — the resolver
 * returns a neutral `--color-text-muted` token value when there's no
 * match, and never throws.
 */

let cache: FamilySilhouette[] | null = null;
let inflight: Promise<FamilySilhouette[]> | null = null;

// Reset helper for tests — module-level caches survive vitest module
// reloads within a single suite otherwise, which would make tests leak
// into each other.
export function __resetSilhouettesCache(): void {
  cache = null;
  inflight = null;
}

export interface SilhouettesState {
  silhouettes: FamilySilhouette[];
  loading: boolean;
  error: Error | null;
}

export function useSilhouettes(client: ApiClient): SilhouettesState {
  const [silhouettes, setSilhouettes] = useState<FamilySilhouette[]>(cache ?? []);
  const [loading, setLoading] = useState<boolean>(cache === null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (cache !== null) {
      // Synchronous cache hit: nothing to do, initial state is correct.
      return;
    }
    let cancelled = false;
    const promise = inflight ?? (inflight = client.getSilhouettes());
    promise
      .then(rows => {
        cache = rows;
        if (!cancelled) {
          setSilhouettes(rows);
          setError(null);
        }
      })
      .catch(err => {
        // Leave cache null so a subsequent mount retries. Clear inflight
        // so the retry doesn't latch onto the rejected promise.
        inflight = null;
        if (!cancelled) setError(err as Error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [client]);

  return { silhouettes, loading, error };
}

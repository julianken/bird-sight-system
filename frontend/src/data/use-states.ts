import { useEffect, useState } from 'react';
import type { ApiClient } from '../api/client.js';
import type { StateSummary } from '@bird-watch/shared-types';

/**
 * CONUS state name + envelope table hook (#740/C6).
 *
 * Backs the scope chooser/control `<select>` (display names) and the
 * state-scope camera `fitBounds`/`maxBounds` (the per-state `bbox` envelope).
 * The payload is static per deploy — rows only change via seed migrations, and
 * `GET /api/states` is served with a 7d `Cache-Control: public, immutable`
 * header (see `services/read-api/src/cache-headers.ts` entry 'states') — so
 * this module keeps an in-memory cache shared across all consumers: the fetch
 * fires at most once per tab lifetime regardless of how many components mount
 * the hook. Mirrors `useSilhouettes` (same module-cache discipline, #246).
 *
 * Failure semantics: a rejected fetch leaves the cache null (a later mount
 * retries) and surfaces `error`. Callers degrade gracefully — `regionLabelFor`
 * falls back to the bare `stateCode` when the table is empty, and `ScopeChooser`
 * disables only the `<select>` (the ZIP path stays usable) via `statesLoading`.
 */

let cache: StateSummary[] | null = null;
let inflight: Promise<StateSummary[]> | null = null;

// Reset helper for tests — module-level caches survive vitest module reloads
// within a single suite otherwise, which would leak state between tests.
export function __resetStatesCache(): void {
  cache = null;
  inflight = null;
}

export interface StatesState {
  states: StateSummary[];
  loading: boolean;
  error: Error | null;
}

export function useStates(client: ApiClient): StatesState {
  const [states, setStates] = useState<StateSummary[]>(cache ?? []);
  const [loading, setLoading] = useState<boolean>(cache === null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (cache !== null) {
      // Synchronous cache hit: nothing to do, initial state is correct.
      return;
    }
    let cancelled = false;
    const promise = inflight ?? (inflight = client.getStates());
    promise
      .then(rows => {
        cache = rows;
        if (!cancelled) {
          setStates(rows);
          setError(null);
        }
      })
      .catch(err => {
        // Leave cache null so a subsequent mount retries. Clear inflight so the
        // retry doesn't latch onto the rejected promise.
        inflight = null;
        if (!cancelled) setError(err as Error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [client]);

  return { states, loading, error };
}

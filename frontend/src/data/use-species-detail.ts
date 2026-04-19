import { useEffect, useRef, useState } from 'react';
import type { ApiClient } from '../api/client.js';
import type { SpeciesMeta } from '@bird-watch/shared-types';

export interface SpeciesDetailState {
  loading: boolean;
  error: Error | null;
  data: SpeciesMeta | null;
}

/**
 * Fetches /api/species/:code when `speciesCode` transitions to a non-null value.
 *
 * Caching — species_meta rows are immutable for the life of a session (see
 * `services/read-api/src/cache-headers.ts` → `public, max-age=31536000, immutable`
 * for this endpoint). A per-hook ref-backed Map is used so repeat selections
 * of the same code (e.g. closing and re-opening the panel) hit the cache
 * rather than refetching. The cache lives only for the component's lifetime;
 * a full page reload re-fetches, which is fine — the browser HTTP cache +
 * `immutable` directive will satisfy the request without a server round-trip.
 */
export function useSpeciesDetail(
  client: ApiClient,
  speciesCode: string | null,
): SpeciesDetailState {
  const cacheRef = useRef<Map<string, SpeciesMeta>>(new Map());
  const [state, setState] = useState<SpeciesDetailState>({
    loading: false,
    error: null,
    data: null,
  });

  useEffect(() => {
    // Null code — panel closed / no selection. Surface a clean resting state.
    if (speciesCode === null) {
      setState({ loading: false, error: null, data: null });
      return;
    }

    // Cache hit — return synchronously; no fetch, no loading flash.
    const cached = cacheRef.current.get(speciesCode);
    if (cached) {
      setState({ loading: false, error: null, data: cached });
      return;
    }

    // Cold fetch. Use the `cancelled` flag so a fast species-change doesn't
    // leave a stale resolution racing the current render (identical pattern
    // to `useBirdData`).
    let cancelled = false;
    setState({ loading: true, error: null, data: null });
    client.getSpecies(speciesCode)
      .then(meta => {
        if (cancelled) return;
        cacheRef.current.set(speciesCode, meta);
        setState({ loading: false, error: null, data: meta });
      })
      .catch(err => {
        if (cancelled) return;
        setState({ loading: false, error: err as Error, data: null });
      });

    return () => { cancelled = true; };
  }, [client, speciesCode]);

  return state;
}

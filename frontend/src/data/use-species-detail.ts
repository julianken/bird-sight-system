import { useEffect, useState } from 'react';
import type { ApiClient } from '../api/client.js';
import type { SpeciesMeta } from '@bird-watch/shared-types';

export interface SpeciesDetailState {
  loading: boolean;
  error: Error | null;
  data: SpeciesMeta | null;
}

/**
 * Module-level cache shared across ALL instances of useSpeciesDetail.
 *
 * Why module scope instead of per-hook ref: Phase 4 mounts two consumers of
 * this hook simultaneously — SpeciesDetailSheet uses it to pull `data.comName`
 * for the sheet header ARIA label, while SpeciesDetailSurface (inside the
 * sheet body) also calls it for the full species payload. A per-instance
 * `useRef(new Map())` gives each mount its own cache, causing two fetches and
 * two JSON.parse on cold paths. The browser HTTP cache absorbs the second
 * network request (immutable Cache-Control), but the JS-layer duplication is
 * still wasteful (two pending Promises, two state updates, two renders).
 *
 * Module scope means both mounts share one resolved entry — the second mount's
 * effect sees a cache hit and resolves synchronously without even issuing a
 * fetch. species_meta rows are immutable for the life of a session, so there
 * is no staleness risk. A full page reload clears the module cache automatically.
 *
 * For test isolation, use the exported `__resetSpeciesDetailCache()` helper
 * (test-only — not exported from the public barrel).
 */
const _moduleCache = new Map<string, SpeciesMeta>();

/** @internal — test isolation only. Do not call in production code. */
export function __resetSpeciesDetailCache(): void {
  _moduleCache.clear();
}

/**
 * Fetches /api/species/:code when `speciesCode` transitions to a non-null value.
 *
 * Caching — species_meta rows are immutable for the life of a session (see
 * `services/read-api/src/cache-headers.ts` → `public, max-age=31536000, immutable`
 * for this endpoint). The cache lives at module scope so multiple simultaneous
 * mounts (e.g. SpeciesDetailSheet header + SpeciesDetailSurface body) share a
 * single resolved entry — no duplicate fetches on cold paths.
 */
export function useSpeciesDetail(
  client: ApiClient,
  speciesCode: string | null,
): SpeciesDetailState {
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
    // The module-level cache means concurrent mounts (e.g. Sheet header +
    // Surface body both calling this hook with the same speciesCode) share
    // one resolved entry — the second mount hits this branch immediately.
    const cached = _moduleCache.get(speciesCode);
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
        // Populate the module cache BEFORE the cancelled-check. The fetched
        // row is useful to the next consumer of this hook (fast open/close/
        // reopen cycle, or a concurrent mount) even if the current effect's
        // consumer has unmounted. Only the React state update is gated on
        // `cancelled` so we don't call setState on a stale/unmounted tree.
        _moduleCache.set(speciesCode, meta);
        if (cancelled) return;
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

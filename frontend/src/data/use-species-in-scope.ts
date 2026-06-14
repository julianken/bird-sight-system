import { useEffect, useState } from 'react';
import type { ApiClient } from '../api/client.js';
import type { ObservationFilters, SpeciesDictEntry } from '@bird-watch/shared-types';
import type { SpeciesOption } from '../components/FiltersBar.js';

/**
 * Represented-species hook — the source for the FiltersBar Species combobox.
 *
 * Loads `GET /api/species-in-scope` for the active scope's non-species filters
 * (since / notable / family / state) and exposes the result as the
 * `SpeciesOption[]` the combobox `<datalist>` renders. This REPLACES the #1050
 * dictionary-backed index (the full ~17.8k global taxonomy) with the species
 * actually represented on the map for the current scope+filters — so the user
 * only sees birds they can find, and picking a family narrows the list to that
 * family's represented species server-side.
 *
 * Why a dedicated endpoint (not derived from the loaded observations/buckets):
 *  - The endpoint is species-filter-INDEPENDENT, so the list does NOT collapse
 *    to a single entry once a species is selected (the self-narrowing trap the
 *    #1050 family-options fix avoids by sourcing from the stable catalogue).
 *  - It is bbox/zoom-INDEPENDENT, so the list is complete at any zoom — the
 *    low-zoom aggregated buckets carry only each family's top species, which
 *    would otherwise hide rarer ones at the country view.
 *
 * Keyed on the scalar filter values (NOT object identity): a new identical
 * filter object each render must NOT refetch. Gated on `enabled` — while the
 * scope is `unscoped` (the chooser landing) the combobox is not in use, so the
 * hook fires no request and reports `loading: false` (mirrors `useBirdData`).
 *
 * Tolerate-not-loaded: `speciesIndex` is ALWAYS an array (empty until resolved),
 * never undefined. `error` is surfaced (FiltersBar renders the never-silent
 * "could not load the species list" alert) but never thrown.
 */

export type SpeciesScopeFilters = Pick<
  ObservationFilters,
  'since' | 'notable' | 'familyCode' | 'stateCode'
>;

export interface SpeciesInScopeState {
  speciesIndex: SpeciesOption[];
  loading: boolean;
  error: Error | null;
}

export function useSpeciesInScope(
  client: ApiClient,
  filters: SpeciesScopeFilters,
  enabled: boolean = true,
): SpeciesInScopeState {
  const [speciesIndex, setSpeciesIndex] = useState<SpeciesOption[]>([]);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<Error | null>(null);

  // Scalar keys so the effect re-runs on VALUE change, not object identity.
  const sinceKey = filters.since ?? '';
  const notableKey = filters.notable === true;
  const familyKey = filters.familyCode ?? '';
  const stateKey = filters.stateCode ?? '';

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setSpeciesIndex([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    client
      .getSpeciesInScope(filters)
      .then((rows: SpeciesDictEntry[]) => {
        if (cancelled) return;
        // The server already orders by comName; preserve that order.
        setSpeciesIndex(
          rows.map(r => ({ code: r.code, comName: r.comName, familyCode: r.familyCode })),
        );
      })
      .catch(err => {
        if (!cancelled) setError(err as Error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `filters` is intentionally read at fetch time but excluded from the dep
    // list — the scalar keys above are the real triggers (a fresh identical
    // object each render must not refetch). Mirrors useBirdData's effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, enabled, sinceKey, notableKey, familyKey, stateKey]);

  return { speciesIndex, loading, error };
}

import { useEffect, useState } from 'react';
import type { ApiClient } from '../api/client.js';
import type {
  Hotspot, Observation, ObservationFilters,
} from '@bird-watch/shared-types';

export interface BirdDataState {
  loading: boolean;
  error: Error | null;
  hotspots: Hotspot[];
  observations: Observation[];
  /**
   * ISO string of the most recently ingested observation (MAX(ingested_at)),
   * or null when the table is empty / read-api unavailable. Sourced from
   * meta.freshestObservationAt in the ObservationsResponse envelope (#456 W3-A).
   */
  freshestObservationAt: string | null;
}

export function useBirdData(
  client: ApiClient,
  filters: ObservationFilters
): BirdDataState {
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [freshestObservationAt, setFreshestObservationAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // One-time load
  useEffect(() => {
    let cancelled = false;
    client.getHotspots()
      .then(h => {
        if (cancelled) return;
        setHotspots(h);
      })
      .catch(err => { if (!cancelled) setError(err as Error); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [client]);

  // Observation refetch on filter change — unwrap the ObservationsResponse envelope
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    client.getObservations(filters)
      .then(envelope => {
        if (cancelled) return;
        setObservations(envelope.data);
        setFreshestObservationAt(envelope.meta.freshestObservationAt);
      })
      .catch(err => { if (!cancelled) setError(err as Error); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // bbox is an array — serialize to a stable string for the dep list so
    // React re-runs the effect on value-change, not array-identity-change.
    // (App.tsx debounces the bbox upstream; this hook trusts the value.)
  }, [
    client,
    filters.since,
    filters.notable,
    filters.speciesCode,
    filters.familyCode,
    filters.bbox?.join(','),
  ]);

  return { loading, error, hotspots, observations, freshestObservationAt };
}

import { useEffect, useState } from 'react';
import type { ApiClient } from '../api/client.js';
import type {
  Region, Hotspot, Observation, ObservationFilters,
} from '@bird-watch/shared-types';

export interface BirdDataState {
  loading: boolean;
  error: Error | null;
  regions: Region[];
  hotspots: Hotspot[];
  observations: Observation[];
}

export function useBirdData(
  client: ApiClient,
  filters: ObservationFilters
): BirdDataState {
  const [regions, setRegions] = useState<Region[]>([]);
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // One-time loads
  useEffect(() => {
    let cancelled = false;
    Promise.all([client.getRegions(), client.getHotspots()])
      .then(([r, h]) => {
        if (cancelled) return;
        setRegions(r);
        setHotspots(h);
      })
      .catch(err => { if (!cancelled) setError(err as Error); });
    return () => { cancelled = true; };
  }, [client]);

  // Observation refetch on filter change
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    client.getObservations(filters)
      .then(o => { if (!cancelled) setObservations(o); })
      .catch(err => { if (!cancelled) setError(err as Error); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [client, filters.since, filters.notable, filters.speciesCode, filters.familyCode]);

  return { loading, error, regions, hotspots, observations };
}

import { useEffect, useState } from 'react';
import type { ApiClient } from '../api/client.js';
import type {
  Hotspot, Observation, ObservationFilters, AggregatedBucket,
} from '@bird-watch/shared-types';

/**
 * Expand each aggregated bucket (#627) into `count` synthetic Observation
 * rows sharing the same lat/lng, so the existing supercluster/adaptive-grid
 * render path stays unchanged. The wire payload is the optimization target —
 * a few thousand synthetic objects in memory is cheap; serializing them
 * across the wire is what wasn't.
 *
 * The synthetic `speciesCode` rotates through `bucket.families` so the
 * cluster pill's species/family counts approximate the truth at zoom levels
 * where the user can't drill down anyway. Drilling in past zoom 6 swaps to
 * `mode === 'observations'` and shows real rows.
 */
export function expandBucketsToSyntheticObservations(
  buckets: AggregatedBucket[],
): Observation[] {
  const out: Observation[] = [];
  const nowIso = new Date().toISOString();
  for (let bi = 0; bi < buckets.length; bi++) {
    const b = buckets[bi]!;
    const families = b.families.length > 0 ? b.families : [null];
    for (let i = 0; i < b.count; i++) {
      const family = families[i % families.length] ?? null;
      out.push({
        subId: `agg:${bi}:${i}`,
        speciesCode: family
          ? `agg-${bi}-${family}-${i % Math.max(b.speciesCount, 1)}`
          : `agg-${bi}-${i}`,
        comName: family ?? 'Aggregated observation',
        lat: b.lat,
        lng: b.lng,
        obsDt: nowIso,
        locId: `agg-loc-${bi}`,
        locName: null,
        howMany: null,
        isNotable: false,
        silhouetteId: family,
        familyCode: family,
      });
    }
  }
  return out;
}

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
  /**
   * #647 — feed-cap signals from the per-observation envelope. When the
   * underlying query matched more than the server-side limit (500), the
   * API returns `truncated=true` and `totalCount` reports the unfiltered
   * match count. The aggregated branch (zoom < 6) never truncates → these
   * default to `truncated=false, totalCount=observations.length`.
   */
  truncated: boolean;
  totalCount: number;
}

export function useBirdData(
  client: ApiClient,
  filters: ObservationFilters
): BirdDataState {
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [freshestObservationAt, setFreshestObservationAt] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
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
        if (envelope.mode === 'aggregated') {
          const synth = expandBucketsToSyntheticObservations(envelope.buckets);
          setObservations(synth);
          // Aggregated mode never truncates — it's already a server-side
          // summary, not a row slice. Surface (false, synth.length) so the
          // banner stays hidden at low zoom.
          setTruncated(false);
          setTotalCount(synth.length);
        } else {
          setObservations(envelope.data);
          setTruncated(envelope.meta.truncated);
          setTotalCount(envelope.meta.totalCount);
        }
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
    filters.zoom,
  ]);

  return { loading, error, hotspots, observations, freshestObservationAt, truncated, totalCount };
}

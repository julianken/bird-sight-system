import { useCallback, useEffect, useState } from 'react';
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
/**
 * True when `code` is one of the synthetic `agg-…` species codes fabricated
 * by `expandBucketsToSyntheticObservations` at aggregated (z < 6) zoom (#715).
 *
 * Synthetic codes are non-resolvable by `/api/species/:code` — passing one to
 * `useSpeciesDetail` produces a 404 and the SpeciesDetailSurface renders only
 * the error StatusBlock with no body content. Callers that route a `speciesCode`
 * into the detail panel (cluster popovers, deep-link hydration) must gate on
 * this helper to avoid the broken-detail-render UX.
 *
 * Real eBird species codes are 6–8 lowercase letters and never start with
 * `agg-`; the prefix-match contract is exact.
 */
export const isSyntheticCode = (code: string | null): boolean =>
  code !== null && code.startsWith('agg-');

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
  /**
   * Combined loading flag — true while EITHER hotspots OR observations is in
   * flight. Preserved for legacy consumers (e.g. `<main aria-busy>`) that
   * want a single signal. New code should prefer the specific flags below.
   *
   * Issue #720: this used to be the sole flag, which produced a race —
   * whichever effect resolved first flipped the shared flag to false while
   * the other was still in flight. MapLede's cold-load guard requires the
   * observations-specific signal; consume `observationsLoading` there.
   */
  loading: boolean;
  /**
   * True while the initial /api/observations request (or a filter-driven
   * refetch) is in flight. This is the correct flag for "are observations
   * still loading?" — used by MapLede's #716 cold-load guard and by
   * the <main aria-busy> attribute, both of which narrate observation
   * data specifically.
   */
  observationsLoading: boolean;
  /**
   * True while the one-time /api/hotspots request is in flight. Separate
   * from `observationsLoading` so consumers that only care about
   * observations can ignore hotspot timing.
   */
  hotspotsLoading: boolean;
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
   * O7 (#786) — user-triggered retry. Bumps an internal `reloadKey` counter
   * that is added to the dep arrays of BOTH effects (hotspots one-time load +
   * observations filter-driven refetch), causing them to re-run from scratch.
   * Also clears the current `error` so the retry starts from a clean slate.
   *
   * Respects the `enabled` gate: a no-op while `!enabled` (unscoped landing)
   * so Retry can never fire `/api/observations` before a scope is chosen
   * (preserves #740/C6).
   */
  refetch: () => void;
}

export function useBirdData(
  client: ApiClient,
  filters: ObservationFilters,
  // #740 (C6) — scope-gate. When `false` (the unscoped/chooser landing) the
  // hook fires NEITHER the observations NOR the hotspots fetch, and reports
  // both loading flags as false so the app isn't stuck in a loading shell while
  // the chooser is shown. This is the production analogue of the C0 prototype's
  // gated fetch (`if (scope.kind === 'unscoped') return;`) — net
  // /api/observations requests on the chooser landing = 0 (AC 1). Defaults to
  // `true` so every existing caller (no scope concept) is unchanged.
  enabled: boolean = true,
): BirdDataState {
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [freshestObservationAt, setFreshestObservationAt] = useState<string | null>(null);
  // Seed loading from `enabled`: a disabled hook is not loading (nothing is in
  // flight), so the chooser landing never paints a loading shell.
  const [hotspotsLoading, setHotspotsLoading] = useState(enabled);
  const [observationsLoading, setObservationsLoading] = useState(enabled);
  const [error, setError] = useState<Error | null>(null);
  // O7 (#786) — internal retry counter. Bumping this re-runs BOTH effects
  // (hotspots + observations), giving the user a clean-slate retry without a
  // remount. Added to both dep arrays below.
  const [reloadKey, setReloadKey] = useState(0);

  // One-time load (gated — no hotspots fetch while unscoped)
  useEffect(() => {
    if (!enabled) {
      // Re-entering the disabled state (scope cleared → back to chooser):
      // ensure we are not reporting a stale loading=true.
      setHotspotsLoading(false);
      return;
    }
    let cancelled = false;
    setHotspotsLoading(true);
    client.getHotspots()
      .then(h => {
        if (cancelled) return;
        setHotspots(h);
      })
      .catch(err => { if (!cancelled) setError(err as Error); })
      .finally(() => { if (!cancelled) setHotspotsLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, enabled, reloadKey]);

  // Observation refetch on filter change — unwrap the ObservationsResponse
  // envelope. Gated on `enabled`: while unscoped this effect short-circuits
  // BEFORE `client.getObservations`, so the cold-load CONUS fetch never fires.
  useEffect(() => {
    if (!enabled) {
      // Clear any in-flight loading flag and drop stale rows so a return to the
      // chooser (scope cleared) doesn't keep the prior scope's observations
      // mounted underneath it.
      setObservationsLoading(false);
      setObservations([]);
      return;
    }
    let cancelled = false;
    setObservationsLoading(true);
    client.getObservations(filters)
      .then(envelope => {
        if (cancelled) return;
        if (envelope.mode === 'aggregated') {
          setObservations(expandBucketsToSyntheticObservations(envelope.buckets));
        } else {
          setObservations(envelope.data);
        }
        setFreshestObservationAt(envelope.meta.freshestObservationAt);
      })
      .catch(err => { if (!cancelled) setError(err as Error); })
      .finally(() => { if (!cancelled) setObservationsLoading(false); });
    return () => { cancelled = true; };
    // bbox is an array — serialize to a stable string for the dep list so
    // React re-runs the effect on value-change, not array-identity-change.
    // (App.tsx debounces the bbox upstream; this hook trusts the value.)
    // reloadKey: O7 (#786) — user-triggered retry bumps this, re-running the
    // observations effect from scratch (clean-slate, no remount).
  }, [
    client,
    enabled,
    filters.since,
    filters.notable,
    filters.speciesCode,
    filters.familyCode,
    filters.stateCode,
    filters.bbox?.join(','),
    filters.zoom,
    reloadKey,
  ]);

  const loading = hotspotsLoading || observationsLoading;

  // O7 (#786) — stable refetch callback. Calling this:
  //   1. Clears the current error so the retry starts from a clean slate.
  //   2. Bumps `reloadKey` so both effects (hotspots + observations) re-run.
  // The `enabled` gate is respected: if the hook is disabled (unscoped landing),
  // this is a no-op — Retry can never fire `/api/observations` before a scope
  // is chosen (preserves #740/C6 zero-fetch-on-chooser-landing invariant).
  const refetch = useCallback(() => {
    if (!enabled) return;
    setError(null);
    setReloadKey(k => k + 1);
  }, [enabled]);

  return {
    loading,
    observationsLoading,
    hotspotsLoading,
    error,
    hotspots,
    observations,
    freshestObservationAt,
    refetch,
  };
}

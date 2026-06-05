import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiClient } from '../api/client.js';
import type {
  Hotspot, Observation, ObservationFilters, AggregatedBucket,
} from '@bird-watch/shared-types';

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
  /**
   * Per-observation rows. POPULATED ONLY in `mode === 'observations'` (z >= 6).
   * In aggregated mode this is EMPTY (#859 deleted the synthetic-observation
   * fabrication) — read `buckets` instead.
   */
  observations: Observation[];
  /**
   * Real coarse-grid aggregation buckets (#859). POPULATED ONLY in
   * `mode === 'aggregated'` (z < 6); EMPTY in per-observation mode. Each bucket
   * carries its exact family counts and the top-8 species per family (codes
   * only — names resolve via the species dictionary), so the map markers,
   * popovers, and family legend all read REAL data without fabricating
   * Observations or lazily re-fetching per click.
   */
  buckets: AggregatedBucket[];
  /**
   * Render mode of the most recently resolved /api/observations response.
   * `'aggregated'` at low zoom (z < 6) ⇒ read `buckets`; `'observations'` at
   * z >= 6 ⇒ read `observations`. The two arrays are mutually exclusive: when
   * one is populated the other is empty.
   *
   * #852: consumers deriving a distinct-species count MUST gate on this — in
   * aggregated mode the count comes from `bucket.speciesCount` aggregates, not
   * from counting rows.
   */
  mode: 'observations' | 'aggregated';
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
  const [buckets, setBuckets] = useState<AggregatedBucket[]>([]);
  // #852 — mode of the last resolved response. Seeded 'observations' so a
  // never-resolved/disabled hook reports the per-observation default (no
  // overcount risk before any aggregated response lands).
  const [mode, setMode] = useState<'observations' | 'aggregated'>('observations');
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

  // #873 — latest fixed state envelope (`filters.stateBbox`), held in a ref so
  // the observations effect can read the FRESHEST value at fetch time WITHOUT
  // taking it as a trigger dep. The envelope arrives asynchronously (once the
  // /api/states table loads), often a tick AFTER the scope change that fires the
  // fetch; if it were a dep, that late arrival would mint a SECOND fetch per
  // scope change and break the #849/#740 single-fetch invariant. By reading it
  // through a ref instead, the first fetch uses whatever envelope is known then
  // (the canonical viewport key if states hasn't loaded yet), and the NEXT real
  // trigger (a pan/zoom, or a return to the state once states is cached) sends
  // the collapsed fixed-envelope key — exactly the "CF HIT on the second
  // distinct-viewport load" the issue targets. Updated on every render.
  const stateBboxRef = useRef(filters.stateBbox);
  stateBboxRef.current = filters.stateBbox;

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
      setBuckets([]);
      return;
    }
    let cancelled = false;
    setObservationsLoading(true);
    // #873 — merge the freshest fixed state envelope (read from the ref, not a
    // dep) so a state scope sends the collapsed cache key as soon as the states
    // table is known, without that late arrival forcing an extra fetch. Spread
    // conditionally — `exactOptionalPropertyTypes` forbids `stateBbox: undefined`.
    client.getObservations(
      stateBboxRef.current
        ? { ...filters, stateBbox: stateBboxRef.current }
        : filters,
    )
      .then(envelope => {
        if (cancelled) return;
        if (envelope.mode === 'aggregated') {
          // #859: store the REAL buckets directly — no synthetic Observation
          // fabrication. Clear `observations` so a zoom-out from the
          // per-observation path doesn't leave stale rows behind the buckets.
          setBuckets(envelope.buckets);
          setObservations([]);
          setMode('aggregated');
        } else {
          // Per-observation mode (z >= 6) is unchanged. Clear `buckets` so a
          // zoom-in past the aggregation threshold drops the stale low-zoom
          // aggregates (the legend/map otherwise double-count).
          setObservations(envelope.data);
          setBuckets([]);
          setMode('observations');
        }
        setFreshestObservationAt(envelope.meta.freshestObservationAt);
      })
      .catch(err => {
        // #874 — a fetch the client deliberately superseded rejects with a
        // DOMException `AbortError`; it is not a real failure, so never surface
        // it as a UI error (the replacing fetch owns the state). The effect's
        // `cancelled` guard already covers the cross-effect-run case; this also
        // covers any same-run abort defensively.
        if ((err as { name?: string }).name === 'AbortError') return;
        if (!cancelled) setError(err as Error);
      })
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
    // #873 — filters.stateBbox is deliberately NOT a trigger dep (read via
    // stateBboxRef at fetch time): it arrives async with the /api/states table
    // and must not mint a second fetch per scope change. See the ref above.
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
    buckets,
    mode,
    freshestObservationAt,
    refetch,
  };
}

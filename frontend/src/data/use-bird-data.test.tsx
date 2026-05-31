import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useBirdData, isSyntheticCode } from './use-bird-data.js';
import { ApiClient } from '../api/client.js';

describe('isSyntheticCode', () => {
  it('returns true for codes produced by expandBucketsToSyntheticObservations (#715)', () => {
    // Family-bearing buckets emit `agg-${bucketIndex}-${family}-${speciesIndex}`.
    expect(isSyntheticCode('agg-0-tyrannidae-0')).toBe(true);
    expect(isSyntheticCode('agg-3-anatidae-2')).toBe(true);
    // Family-less buckets emit `agg-${bucketIndex}-${rowIndex}`.
    expect(isSyntheticCode('agg-7-12')).toBe(true);
  });

  it('returns false for real eBird species codes', () => {
    expect(isSyntheticCode('norcar')).toBe(false);
    expect(isSyntheticCode('vermfly')).toBe(false);
    expect(isSyntheticCode('wlsfly')).toBe(false);
    // Real codes that happen to contain "agg" anywhere but at the start
    // (defensive — eBird codes are 6–8 lowercase letters, so this should
    // never occur in practice, but the prefix-match contract is explicit).
    expect(isSyntheticCode('zagger')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isSyntheticCode(null)).toBe(false);
  });
});

function makeClient(overrides: Partial<ApiClient>): ApiClient {
  return Object.assign(new ApiClient(), overrides);
}

describe('useBirdData', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('loads hotspots and observations on mount (no regions)', async () => {
    const client = makeClient({
      getHotspots: vi.fn().mockResolvedValue([{ locId: 'h1' }]),
      getObservations: vi.fn().mockResolvedValue({
        data: [{ subId: 's1' }],
        meta: { freshestObservationAt: '2026-05-11T10:00:00.000Z' },
      }),
    } as unknown as Partial<ApiClient>);

    const { result } = renderHook(() => useBirdData(client, { since: '14d', notable: false }));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).not.toHaveProperty('regions');
    expect(result.current.hotspots).toHaveLength(1);
    expect(result.current.observations).toHaveLength(1);
    expect(result.current.freshestObservationAt).toBe('2026-05-11T10:00:00.000Z');
    expect(result.current.error).toBeNull();
  });

  it('refetches observations when filters change', async () => {
    const getObservations = vi.fn().mockResolvedValue({ data: [], meta: { freshestObservationAt: null } });
    const client = makeClient({
      getHotspots: vi.fn().mockResolvedValue([]),
      getObservations,
    } as unknown as Partial<ApiClient>);

    const { rerender } = renderHook(
      ({ filters }: { filters: { since: '1d' | '7d' | '14d'; notable: boolean } }) =>
        useBirdData(client, filters),
      { initialProps: { filters: { since: '14d', notable: false } } }
    );
    await waitFor(() => expect(getObservations).toHaveBeenCalledTimes(1));
    rerender({ filters: { since: '7d', notable: true } });
    await waitFor(() => expect(getObservations).toHaveBeenCalledTimes(2));
    expect(getObservations.mock.calls[1][0]).toMatchObject({ since: '7d', notable: true });
  });

  it('refetches observations when bbox changes (viewport pan/zoom)', async () => {
    const getObservations = vi.fn().mockResolvedValue({ data: [], meta: { freshestObservationAt: null } });
    const client = makeClient({
      getHotspots: vi.fn().mockResolvedValue([]),
      getObservations,
    } as unknown as Partial<ApiClient>);

    const initialBbox: [number, number, number, number] = [-125, 24, -66, 50];
    const nextBbox: [number, number, number, number] = [-120, 30, -100, 45];

    const { rerender } = renderHook(
      ({ filters }: { filters: import('@bird-watch/shared-types').ObservationFilters }) =>
        useBirdData(client, filters),
      { initialProps: { filters: { since: '14d', notable: false, bbox: initialBbox } } }
    );
    await waitFor(() => expect(getObservations).toHaveBeenCalledTimes(1));
    expect(getObservations.mock.calls[0][0]).toMatchObject({ bbox: initialBbox });

    rerender({ filters: { since: '14d', notable: false, bbox: nextBbox } });
    await waitFor(() => expect(getObservations).toHaveBeenCalledTimes(2));
    expect(getObservations.mock.calls[1][0]).toMatchObject({ bbox: nextBbox });
  });

  it('refetches when zoom changes (#627)', async () => {
    const getObservations = vi.fn().mockResolvedValue({
      mode: 'observations', data: [], meta: { freshestObservationAt: null },
    });
    const client = makeClient({
      getHotspots: vi.fn().mockResolvedValue([]),
      getObservations,
    } as unknown as Partial<ApiClient>);

    const { rerender } = renderHook(
      ({ filters }: { filters: import('@bird-watch/shared-types').ObservationFilters }) =>
        useBirdData(client, filters),
      { initialProps: { filters: { since: '14d', notable: false, zoom: 3 } } }
    );
    await waitFor(() => expect(getObservations).toHaveBeenCalledTimes(1));
    rerender({ filters: { since: '14d', notable: false, zoom: 8 } });
    await waitFor(() => expect(getObservations).toHaveBeenCalledTimes(2));
    expect(getObservations.mock.calls[1][0]).toMatchObject({ zoom: 8 });
  });

  it('expands aggregated buckets to synthetic observations (#627)', async () => {
    const getObservations = vi.fn().mockResolvedValue({
      mode: 'aggregated',
      buckets: [
        { lat: 31.75, lng: -111, count: 3, speciesCount: 1, families: ['tyrannidae'] },
        { lat: 40, lng: -100, count: 2, speciesCount: 1, families: ['trochilidae'] },
      ],
      meta: { freshestObservationAt: '2026-05-17T00:00:00.000Z' },
    });
    const client = makeClient({
      getHotspots: vi.fn().mockResolvedValue([]),
      getObservations,
    } as unknown as Partial<ApiClient>);

    const { result } = renderHook(() =>
      useBirdData(client, { since: '14d', notable: false, zoom: 3 }));
    await waitFor(() => expect(result.current.observations.length).toBe(5));
    const byFamily = result.current.observations.reduce<Record<string, number>>((acc, o) => {
      const k = o.familyCode ?? 'null';
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
    expect(byFamily['tyrannidae']).toBe(3);
    expect(byFamily['trochilidae']).toBe(2);
    expect(result.current.freshestObservationAt).toBe('2026-05-17T00:00:00.000Z');
  });

  it('synthesises unique speciesCodes across buckets sharing a family (#630 fix)', async () => {
    // Two distinct buckets both contain family `tyrannidae` with speciesCount=3.
    // Before fix: both buckets emit `agg-tyrannidae-1`/`agg-tyrannidae-2` codes
    // and any DISTINCT-species count across the viewport undercounts.
    const getObservations = vi.fn().mockResolvedValue({
      mode: 'aggregated',
      buckets: [
        { lat: 31.75, lng: -111, count: 3, speciesCount: 3, families: ['tyrannidae'] },
        { lat: 40, lng: -100, count: 3, speciesCount: 3, families: ['tyrannidae'] },
      ],
      meta: { freshestObservationAt: null },
    });
    const client = makeClient({
      getHotspots: vi.fn().mockResolvedValue([]),
      getObservations,
    } as unknown as Partial<ApiClient>);

    const { result } = renderHook(() =>
      useBirdData(client, { since: '14d', notable: false, zoom: 3 }));
    await waitFor(() => expect(result.current.observations.length).toBe(6));

    // Distinct speciesCodes across the two buckets must be 6 (3 per bucket),
    // not 3 (collapsed by collision). Also assert the index `0` slot is
    // actually emitted (regression for the `i % n || 1` fallthrough bug).
    const distinctCodes = new Set(result.current.observations.map(o => o.speciesCode));
    expect(distinctCodes.size).toBe(6);
    const firstBucketCodes = result.current.observations
      .filter(o => o.subId.startsWith('agg:0:'))
      .map(o => o.speciesCode);
    expect(firstBucketCodes).toContain('agg-0-tyrannidae-0');
  });

  // --- O7 (#786) refetch tests ---

  it('refetch re-fires getObservations and clears prior error', async () => {
    const getObservations = vi.fn()
      .mockRejectedValueOnce(new Error('network failure'))
      .mockResolvedValue({ data: [{ subId: 's1' }], meta: { freshestObservationAt: null } });
    const getHotspots = vi.fn().mockResolvedValue([]);
    const client = makeClient({
      getHotspots,
      getObservations,
    } as unknown as Partial<ApiClient>);

    const { result } = renderHook(() =>
      useBirdData(client, { since: '14d', notable: false }, true));

    // Wait for the initial failure
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.observations).toEqual([]);

    // Call refetch — must clear the error and re-run the effect
    await act(async () => { result.current.refetch(); });

    await waitFor(() => expect(result.current.error).toBeNull());
    await waitFor(() => expect(result.current.observations).toHaveLength(1));
    // getObservations must have been called twice (initial + refetch)
    expect(getObservations).toHaveBeenCalledTimes(2);
  });

  it('refetch re-fires getHotspots', async () => {
    const getHotspots = vi.fn()
      .mockRejectedValueOnce(new Error('hotspot fail'))
      .mockResolvedValue([{ locId: 'h1' }]);
    const getObservations = vi.fn().mockResolvedValue({
      data: [], meta: { freshestObservationAt: null },
    });
    const client = makeClient({
      getHotspots,
      getObservations,
    } as unknown as Partial<ApiClient>);

    const { result } = renderHook(() =>
      useBirdData(client, { since: '14d', notable: false }, true));

    await waitFor(() => expect(result.current.error).not.toBeNull());

    await act(async () => { result.current.refetch(); });

    await waitFor(() => expect(result.current.error).toBeNull());
    await waitFor(() => expect(result.current.hotspots).toHaveLength(1));
    expect(getHotspots).toHaveBeenCalledTimes(2);
  });

  it('refetch is a no-op while enabled === false (preserves #740/C6)', async () => {
    const getObservations = vi.fn().mockRejectedValue(new Error('never'));
    const getHotspots = vi.fn().mockRejectedValue(new Error('never'));
    const client = makeClient({
      getHotspots,
      getObservations,
    } as unknown as Partial<ApiClient>);

    const { result } = renderHook(() =>
      useBirdData(client, { since: '14d', notable: false }, false));

    // Disabled hook: no calls fired
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getObservations).not.toHaveBeenCalled();
    expect(getHotspots).not.toHaveBeenCalled();

    // refetch while disabled — must not trigger any calls
    await act(async () => { result.current.refetch(); });
    expect(getObservations).not.toHaveBeenCalled();
    expect(getHotspots).not.toHaveBeenCalled();
  });

  it('a failed refetch sets error but leaves prior observations intact', async () => {
    const getObservations = vi.fn()
      .mockResolvedValueOnce({ data: [{ subId: 's1' }], meta: { freshestObservationAt: null } })
      .mockRejectedValue(new Error('second fetch failed'));
    const getHotspots = vi.fn()
      .mockResolvedValueOnce([{ locId: 'h1' }])
      .mockResolvedValue([{ locId: 'h1' }]);
    const client = makeClient({
      getHotspots,
      getObservations,
    } as unknown as Partial<ApiClient>);

    const { result } = renderHook(() =>
      useBirdData(client, { since: '14d', notable: false }, true));

    // Initial success: 1 observation
    await waitFor(() => expect(result.current.observations).toHaveLength(1));
    expect(result.current.error).toBeNull();

    // Refetch — this time the fetch fails
    await act(async () => { result.current.refetch(); });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    // Prior observations must still be in place (last-good data stays)
    expect(result.current.observations).toHaveLength(1);
  });

  it('exposes error state when a fetch fails', async () => {
    const client = makeClient({
      getHotspots: vi.fn().mockRejectedValue(new Error('boom')),
      getObservations: vi.fn().mockResolvedValue({ data: [], meta: { freshestObservationAt: null } }),
    } as unknown as Partial<ApiClient>);

    const { result } = renderHook(() => useBirdData(client, { since: '14d', notable: false }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
  });

  it('hotspots rejection surfaces error, observations stays loading (#720)', async () => {
    // Observations hang forever; hotspots rejects. After the rejection,
    // hotspotsLoading flips to false but observationsLoading remains true —
    // and `loading` (the combined OR) stays true until observations also
    // settles. This is the #720 fix: a shared flag was previously cleared
    // by whichever effect settled first, which is the race that drove #716.
    const client = makeClient({
      getHotspots: vi.fn().mockRejectedValue(new Error('network error')),
      getObservations: vi.fn().mockReturnValue(new Promise(() => {})),
    } as unknown as Partial<ApiClient>);

    const { result } = renderHook(() => useBirdData(client, { since: '14d', notable: false }));
    expect(result.current.loading).toBe(true);
    expect(result.current.hotspotsLoading).toBe(true);
    expect(result.current.observationsLoading).toBe(true);

    // hotspots effect settles → hotspotsLoading flips false; observations
    // is still in flight so observationsLoading + combined loading stay true.
    await waitFor(() => expect(result.current.hotspotsLoading).toBe(false));
    expect(result.current.observationsLoading).toBe(true);
    expect(result.current.loading).toBe(true);
    expect(result.current.error?.message).toBe('network error');
  });

  it('observationsLoading stays true while hotspots resolves first (#720 race)', async () => {
    // The exact #716 production failure mode: hotspots resolves instantly
    // (e.g. CDN cache hit), observations is in flight. With the old shared
    // `loading` flag, hotspots' `.finally` flipped it to false while
    // observations was still loading — and MapLede saw `loading=false +
    // observations=[]` and rendered the misleading Template 1.
    //
    // After the split, observationsLoading is the source of truth for
    // "have observations resolved yet?". This test pins that contract.
    let releaseObservations: ((envelope: unknown) => void) | undefined;
    const observationsPromise = new Promise<unknown>(resolve => {
      releaseObservations = resolve;
    });

    const client = makeClient({
      getHotspots: vi.fn().mockResolvedValue([{ locId: 'h1' }]),
      getObservations: vi.fn().mockReturnValue(observationsPromise),
    } as unknown as Partial<ApiClient>);

    const { result } = renderHook(() => useBirdData(client, { since: '14d', notable: false }));

    // hotspots resolves first; observations still in flight.
    await waitFor(() => expect(result.current.hotspotsLoading).toBe(false));
    expect(result.current.observationsLoading).toBe(true);
    expect(result.current.loading).toBe(true);
    expect(result.current.observations).toEqual([]);

    // Release observations — both flags now clear.
    releaseObservations?.({ data: [{ subId: 's1' }], meta: { freshestObservationAt: null } });
    await waitFor(() => expect(result.current.observationsLoading).toBe(false));
    expect(result.current.loading).toBe(false);
    expect(result.current.observations).toHaveLength(1);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useBirdData } from './use-bird-data.js';
import { ApiClient } from '../api/client.js';

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

  it('stores aggregated buckets DIRECTLY (no synthetic observations) and flags mode (#859)', async () => {
    const buckets = [
      {
        lat: 31.75, lng: -111, count: 3, speciesCount: 1,
        families: [{
          code: 'tyrannidae', count: 3, speciesCount: 1,
          species: [{ code: 'vermfly', count: 3 }],
        }],
      },
      {
        lat: 40, lng: -100, count: 2, speciesCount: 1,
        families: [{
          code: 'trochilidae', count: 2, speciesCount: 1,
          species: [{ code: 'rufhum', count: 2 }],
        }],
      },
    ];
    const getObservations = vi.fn().mockResolvedValue({
      mode: 'aggregated',
      buckets,
      meta: { freshestObservationAt: '2026-05-17T00:00:00.000Z' },
    });
    const client = makeClient({
      getHotspots: vi.fn().mockResolvedValue([]),
      getObservations,
    } as unknown as Partial<ApiClient>);

    const { result } = renderHook(() =>
      useBirdData(client, { since: '14d', notable: false, zoom: 3 }));
    await waitFor(() => expect(result.current.mode).toBe('aggregated'));

    // Real buckets are stored verbatim — no Observation[] fabrication.
    expect(result.current.buckets).toHaveLength(2);
    expect(result.current.buckets[0]?.families[0]?.species[0]?.code).toBe('vermfly');
    // The per-observation array stays EMPTY in aggregated mode (no synthetics).
    expect(result.current.observations).toHaveLength(0);
    expect(result.current.freshestObservationAt).toBe('2026-05-17T00:00:00.000Z');
  });

  it('clears buckets and uses observations when a per-observation response lands (zoom >= 6)', async () => {
    const getObservations = vi.fn()
      .mockResolvedValueOnce({
        mode: 'aggregated',
        buckets: [{
          lat: 31, lng: -111, count: 3, speciesCount: 1,
          families: [{ code: 'tyrannidae', count: 3, speciesCount: 1, species: [{ code: 'vermfly', count: 3 }] }],
        }],
        meta: { freshestObservationAt: null },
      })
      .mockResolvedValue({
        mode: 'observations',
        data: [{ subId: 's1', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher', familyCode: 'tyrannidae' }],
        meta: { freshestObservationAt: null },
      });
    const client = makeClient({
      getHotspots: vi.fn().mockResolvedValue([]),
      getObservations,
    } as unknown as Partial<ApiClient>);

    const { result, rerender } = renderHook(
      ({ filters }: { filters: import('@bird-watch/shared-types').ObservationFilters }) =>
        useBirdData(client, filters),
      { initialProps: { filters: { since: '14d', notable: false, zoom: 3 } } },
    );
    await waitFor(() => expect(result.current.buckets).toHaveLength(1));

    rerender({ filters: { since: '14d', notable: false, zoom: 8 } });
    await waitFor(() => expect(result.current.mode).toBe('observations'));
    expect(result.current.observations).toHaveLength(1);
    // Stale buckets must be cleared so the legend / map don't double-render.
    expect(result.current.buckets).toHaveLength(0);
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

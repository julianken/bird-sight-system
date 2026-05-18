import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
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
      ({ filters }: { filters: { since: '1d' | '7d' | '14d' | '30d'; notable: boolean } }) =>
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

  it('exposes error state when a fetch fails', async () => {
    const client = makeClient({
      getHotspots: vi.fn().mockRejectedValue(new Error('boom')),
      getObservations: vi.fn().mockResolvedValue({ data: [], meta: { freshestObservationAt: null } }),
    } as unknown as Partial<ApiClient>);

    const { result } = renderHook(() => useBirdData(client, { since: '14d', notable: false }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
  });

  it('hotspots rejection flips loading to false even when observations never resolve', async () => {
    // Observations hang forever — only the hotspots effect can clear loading.
    const client = makeClient({
      getHotspots: vi.fn().mockRejectedValue(new Error('network error')),
      getObservations: vi.fn().mockReturnValue(new Promise(() => {})),
    } as unknown as Partial<ApiClient>);

    const { result } = renderHook(() => useBirdData(client, { since: '14d', notable: false }));
    expect(result.current.loading).toBe(true);
    // Loading should still become false because the hotspots effect cleans up
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe('network error');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useBirdData } from './use-bird-data.js';
import { ApiClient } from '../api/client.js';

function makeClient(overrides: Partial<ApiClient>): ApiClient {
  return Object.assign(new ApiClient(), overrides);
}

describe('useBirdData', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('loads regions, hotspots, and observations on mount', async () => {
    const client = makeClient({
      getRegions: vi.fn().mockResolvedValue([{ id: 'r1' }]),
      getHotspots: vi.fn().mockResolvedValue([{ locId: 'h1' }]),
      getObservations: vi.fn().mockResolvedValue([{ subId: 's1' }]),
    } as unknown as Partial<ApiClient>);

    const { result } = renderHook(() => useBirdData(client, { since: '14d', notable: false }));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.regions).toHaveLength(1);
    expect(result.current.hotspots).toHaveLength(1);
    expect(result.current.observations).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it('refetches observations when filters change', async () => {
    const getObservations = vi.fn().mockResolvedValue([]);
    const client = makeClient({
      getRegions: vi.fn().mockResolvedValue([]),
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

  it('exposes error state when a fetch fails', async () => {
    const client = makeClient({
      getRegions: vi.fn().mockRejectedValue(new Error('boom')),
      getHotspots: vi.fn().mockResolvedValue([]),
      getObservations: vi.fn().mockResolvedValue([]),
    } as unknown as Partial<ApiClient>);

    const { result } = renderHook(() => useBirdData(client, { since: '14d', notable: false }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
  });
});

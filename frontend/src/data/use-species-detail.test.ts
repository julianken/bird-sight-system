import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSpeciesDetail } from './use-species-detail.js';
import { ApiClient } from '../api/client.js';
import type { SpeciesMeta } from '@bird-watch/shared-types';

function makeClient(overrides: Partial<ApiClient>): ApiClient {
  return Object.assign(new ApiClient(), overrides);
}

const VERMFLY: SpeciesMeta = {
  speciesCode: 'vermfly',
  comName: 'Vermilion Flycatcher',
  sciName: 'Pyrocephalus rubinus',
  familyCode: 'tyrannidae',
  familyName: 'Tyrant Flycatchers',
  taxonOrder: 4400,
};

describe('useSpeciesDetail', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('does not fetch when speciesCode is null', () => {
    const getSpecies = vi.fn();
    const client = makeClient({ getSpecies } as unknown as Partial<ApiClient>);

    const { result } = renderHook(() => useSpeciesDetail(client, null));
    expect(result.current).toEqual({ loading: false, error: null, data: null });
    expect(getSpecies).not.toHaveBeenCalled();
  });

  it('fetches on non-null speciesCode and exposes loading → data transition', async () => {
    const getSpecies = vi.fn().mockResolvedValue(VERMFLY);
    const client = makeClient({ getSpecies } as unknown as Partial<ApiClient>);

    const { result } = renderHook(() => useSpeciesDetail(client, 'vermfly'));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(VERMFLY);
    expect(result.current.error).toBeNull();
    expect(getSpecies).toHaveBeenCalledTimes(1);
    expect(getSpecies).toHaveBeenCalledWith('vermfly');
  });

  it('caches by speciesCode — re-selecting the same code does not refetch', async () => {
    const getSpecies = vi.fn().mockResolvedValue(VERMFLY);
    const client = makeClient({ getSpecies } as unknown as Partial<ApiClient>);

    const { result, rerender } = renderHook(
      ({ code }: { code: string | null }) => useSpeciesDetail(client, code),
      { initialProps: { code: 'vermfly' as string | null } }
    );
    await waitFor(() => expect(result.current.data).toEqual(VERMFLY));
    expect(getSpecies).toHaveBeenCalledTimes(1);

    // Close the panel (null), then re-open the same species.
    rerender({ code: null });
    await waitFor(() => expect(result.current.data).toBeNull());
    rerender({ code: 'vermfly' });

    // Cache hit — no second network call; data surfaces synchronously.
    await waitFor(() => expect(result.current.data).toEqual(VERMFLY));
    expect(getSpecies).toHaveBeenCalledTimes(1);
  });

  it('populates cache even when the consumer unmounts mid-fetch (fast open/close/reopen)', async () => {
    // Hand-rolled deferred so we can unmount BEFORE the fetch resolves.
    let resolve!: (meta: SpeciesMeta) => void;
    const deferred = new Promise<SpeciesMeta>(r => { resolve = r; });
    const getSpecies = vi.fn().mockImplementation(() => deferred);
    const client = makeClient({ getSpecies } as unknown as Partial<ApiClient>);

    // NOTE: both mounts share the same hook *component instance* via
    // `rerender`, which is how the ref-backed cache survives. (A genuine
    // unmount would drop the ref — see the JSDoc on the hook for why
    // that's acceptable; the browser HTTP cache catches a full reload.)
    // Here we simulate "panel closed mid-flight" via code=null, then
    // "panel reopened" via code=X.
    const { result, rerender } = renderHook(
      ({ code }: { code: string | null }) => useSpeciesDetail(client, code),
      { initialProps: { code: 'vermfly' as string | null } }
    );
    expect(result.current.loading).toBe(true);
    expect(getSpecies).toHaveBeenCalledTimes(1);

    // Close panel — sets cancelled=true on the in-flight effect's cleanup.
    rerender({ code: null });
    await waitFor(() => expect(result.current.data).toBeNull());

    // Fetch resolves AFTER the consumer moved away — the cache should still
    // absorb the result, because the data is useful to the next consumer.
    resolve(VERMFLY);
    // Drain microtasks so the hook's `.then(meta => cacheRef.current.set(...))`
    // runs before the next render reads the cache. Two turns are needed —
    // one for the `await deferred` continuation, one for React's internal
    // fulfillment bookkeeping.
    await deferred;
    await Promise.resolve();
    await Promise.resolve();

    // Re-open the same species — must hit the cache (no second network call)
    // and surface data synchronously (no loading flash).
    rerender({ code: 'vermfly' });
    await waitFor(() => expect(result.current.data).toEqual(VERMFLY));
    expect(result.current.loading).toBe(false);
    expect(getSpecies).toHaveBeenCalledTimes(1);
  });

  it('surfaces error state and does not cache failures', async () => {
    const getSpecies = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(VERMFLY);
    const client = makeClient({ getSpecies } as unknown as Partial<ApiClient>);

    const { result, rerender } = renderHook(
      ({ code }: { code: string | null }) => useSpeciesDetail(client, code),
      { initialProps: { code: 'vermfly' as string | null } }
    );
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.data).toBeNull();

    // Same code again should retry (not served from cache, since the prior
    // attempt failed).
    rerender({ code: null });
    rerender({ code: 'vermfly' });
    await waitFor(() => expect(result.current.data).toEqual(VERMFLY));
    expect(getSpecies).toHaveBeenCalledTimes(2);
  });
});

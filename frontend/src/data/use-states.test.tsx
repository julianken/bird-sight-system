import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useStates, __resetStatesCache } from './use-states.js';
import { ApiClient } from '../api/client.js';
import type { StateSummary } from '@bird-watch/shared-types';

// Build the client with `Object.assign(new ApiClient(), { getStates: vi.fn() })`
// per the `useSilhouettes` mirror — do NOT `vi.spyOn(ApiClient.prototype, ...)`.
// The hook's cache/inflight live at module scope; a prototype spy restored mid-
// suite while a module-cached promise is latched is exactly where the
// inflight-dedup assertion turns fragile.
function makeClient(overrides: Partial<ApiClient>): ApiClient {
  return Object.assign(new ApiClient(), overrides);
}

const AZ: StateSummary = {
  stateCode: 'US-AZ',
  name: 'Arizona',
  bbox: [-114.82, 31.33, -109.04, 37.0],
};
const CA: StateSummary = {
  stateCode: 'US-CA',
  name: 'California',
  bbox: [-124.41, 32.53, -114.13, 42.01],
};

describe('useStates', () => {
  beforeEach(() => {
    __resetStatesCache();
    vi.restoreAllMocks();
  });

  it('synchronous cache hit: a second mount fires getStates zero times', async () => {
    const getStates = vi.fn().mockResolvedValue([AZ]);
    const client = makeClient({ getStates } as unknown as Partial<ApiClient>);

    // First mount populates the module cache.
    const first = renderHook(() => useStates(client));
    expect(first.result.current.loading).toBe(true);
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(getStates).toHaveBeenCalledTimes(1);
    expect(first.result.current.states).toHaveLength(1);

    // Second mount hits the cache synchronously: loading starts false and the
    // fetcher is NOT invoked again.
    const second = renderHook(() => useStates(client));
    expect(second.result.current.loading).toBe(false);
    expect(second.result.current.states).toHaveLength(1);
    expect(second.result.current.states[0]?.stateCode).toBe('US-AZ');
    expect(getStates).toHaveBeenCalledTimes(1);
  });

  it('inflight-dedup: two concurrent mounts share ONE in-flight promise', async () => {
    // A deferred promise so both mounts subscribe before it resolves.
    let resolveStates: (rows: StateSummary[]) => void = () => {};
    const pending = new Promise<StateSummary[]>(resolve => {
      resolveStates = resolve;
    });
    const getStates = vi.fn().mockReturnValue(pending);
    const client = makeClient({ getStates } as unknown as Partial<ApiClient>);

    // Two mounts before the promise resolves — both should latch onto the same
    // inflight promise, so getStates is called exactly once.
    const a = renderHook(() => useStates(client));
    const b = renderHook(() => useStates(client));
    expect(a.result.current.loading).toBe(true);
    expect(b.result.current.loading).toBe(true);
    expect(getStates).toHaveBeenCalledTimes(1);

    resolveStates([AZ, CA]);
    await waitFor(() => expect(a.result.current.loading).toBe(false));
    await waitFor(() => expect(b.result.current.loading).toBe(false));
    expect(getStates).toHaveBeenCalledTimes(1);
    expect(a.result.current.states).toHaveLength(2);
    expect(b.result.current.states).toHaveLength(2);
  });

  it('retry-on-reject: a rejected fetch leaves cache null + clears inflight so a later mount retries and succeeds', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('states 503'));
    const client = makeClient({ getStates: failing } as unknown as Partial<ApiClient>);

    const first = renderHook(() => useStates(client));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(first.result.current.states).toHaveLength(0);

    // The rejected inflight promise must not be latched into the cache — a
    // later mount with a healthy client retries and succeeds.
    const succeeding = vi.fn().mockResolvedValue([AZ]);
    const healthyClient = makeClient({
      getStates: succeeding,
    } as unknown as Partial<ApiClient>);
    const retry = renderHook(() => useStates(healthyClient));
    expect(retry.result.current.loading).toBe(true);
    await waitFor(() => expect(retry.result.current.loading).toBe(false));
    expect(succeeding).toHaveBeenCalledTimes(1);
    expect(retry.result.current.states).toHaveLength(1);
    expect(retry.result.current.states[0]?.stateCode).toBe('US-AZ');
    expect(retry.result.current.error).toBeNull();
  });

  it('surfaces the error and flips loading false in finally on rejection', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('states 503'));
    const client = makeClient({ getStates: failing } as unknown as Partial<ApiClient>);

    const { result } = renderHook(() => useStates(client));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe('states 503');
    expect(result.current.states).toHaveLength(0);
  });
});

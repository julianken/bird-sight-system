import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSilhouettes, __resetSilhouettesCache } from './use-silhouettes.js';
import { ApiClient } from '../api/client.js';

function makeClient(overrides: Partial<ApiClient>): ApiClient {
  return Object.assign(new ApiClient(), overrides);
}

describe('useSilhouettes', () => {
  beforeEach(() => {
    __resetSilhouettesCache();
    vi.restoreAllMocks();
  });

  it('fetches silhouettes on first mount and exposes them once resolved', async () => {
    const client = makeClient({
      getSilhouettes: vi.fn().mockResolvedValue([
        { familyCode: 'tyrannidae', color: '#C77A2E', svgData: null, source: null, license: null },
      ]),
    } as unknown as Partial<ApiClient>);

    const { result } = renderHook(() => useSilhouettes(client));
    expect(result.current.loading).toBe(true);
    expect(result.current.silhouettes).toHaveLength(0);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.silhouettes).toHaveLength(1);
    expect(result.current.silhouettes[0]?.familyCode).toBe('tyrannidae');
    expect(result.current.error).toBeNull();
  });

  it('reuses the module-level cache across renders and does not refetch', async () => {
    const getSilhouettes = vi.fn().mockResolvedValue([
      { familyCode: 'passerellidae', color: '#D4923A', svgData: null, source: null, license: null },
    ]);
    const client = makeClient({ getSilhouettes } as unknown as Partial<ApiClient>);

    const first = renderHook(() => useSilhouettes(client));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(getSilhouettes).toHaveBeenCalledTimes(1);

    // Second mount should hit the cache synchronously — loading starts false,
    // fetcher is NOT invoked again.
    const second = renderHook(() => useSilhouettes(client));
    expect(second.result.current.loading).toBe(false);
    expect(second.result.current.silhouettes).toHaveLength(1);
    expect(getSilhouettes).toHaveBeenCalledTimes(1);
  });

  it('surfaces errors without throwing and leaves cache empty so a retry can succeed', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('silhouettes 503'));
    const client = makeClient({
      getSilhouettes: failing,
    } as unknown as Partial<ApiClient>);

    const { result } = renderHook(() => useSilhouettes(client));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe('silhouettes 503');
    expect(result.current.silhouettes).toHaveLength(0);

    // A subsequent mount with a working client must be able to retry — the
    // rejected inflight promise should not be latched into the cache.
    const succeeding = vi.fn().mockResolvedValue([
      { familyCode: 'anatidae', color: '#3A6B8E', svgData: null, source: null, license: null },
    ]);
    const healthyClient = makeClient({
      getSilhouettes: succeeding,
    } as unknown as Partial<ApiClient>);
    const retry = renderHook(() => useSilhouettes(healthyClient));
    await waitFor(() => expect(retry.result.current.loading).toBe(false));
    expect(retry.result.current.silhouettes).toHaveLength(1);
  });
});

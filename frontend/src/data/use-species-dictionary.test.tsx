import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  useSpeciesDictionary,
  __resetSpeciesDictionaryCache,
} from './use-species-dictionary.js';
import { ApiClient } from '../api/client.js';

function makeClient(overrides: Partial<ApiClient>): ApiClient {
  return Object.assign(new ApiClient(), overrides);
}

const ROWS = [
  { code: 'norcar', comName: 'Northern Cardinal', familyCode: 'cardinalidae' },
  { code: 'vermfly', comName: 'Vermilion Flycatcher', familyCode: 'tyrannidae' },
];

describe('useSpeciesDictionary', () => {
  beforeEach(() => {
    __resetSpeciesDictionaryCache();
    vi.restoreAllMocks();
  });

  it('fetches the dictionary once and exposes a code→entry Map', async () => {
    const getSpeciesDictionary = vi.fn().mockResolvedValue(ROWS);
    const client = makeClient({ getSpeciesDictionary } as unknown as Partial<ApiClient>);

    const { result } = renderHook(() => useSpeciesDictionary(client));
    // Tolerates not-yet-loaded: starts empty, never undefined, never throws.
    expect(result.current.loading).toBe(true);
    expect(result.current.dictionary.size).toBe(0);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getSpeciesDictionary).toHaveBeenCalledTimes(1);
    expect(result.current.dictionary.get('norcar')).toEqual({
      comName: 'Northern Cardinal',
      familyCode: 'cardinalidae',
    });
    expect(result.current.dictionary.get('vermfly')?.comName).toBe('Vermilion Flycatcher');
  });

  it('returns undefined (not a crash) for an unknown code', async () => {
    const client = makeClient({
      getSpeciesDictionary: vi.fn().mockResolvedValue(ROWS),
    } as unknown as Partial<ApiClient>);
    const { result } = renderHook(() => useSpeciesDictionary(client));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.dictionary.get('nope')).toBeUndefined();
  });

  it('reuses the module-level cache across mounts and does not refetch', async () => {
    const getSpeciesDictionary = vi.fn().mockResolvedValue(ROWS);
    const client = makeClient({ getSpeciesDictionary } as unknown as Partial<ApiClient>);

    const first = renderHook(() => useSpeciesDictionary(client));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(getSpeciesDictionary).toHaveBeenCalledTimes(1);

    const second = renderHook(() => useSpeciesDictionary(client));
    // Synchronous cache hit: loading starts false, fetcher not called again.
    expect(second.result.current.loading).toBe(false);
    expect(second.result.current.dictionary.get('norcar')?.comName).toBe('Northern Cardinal');
    expect(getSpeciesDictionary).toHaveBeenCalledTimes(1);
  });

  it('surfaces errors without throwing and leaves the cache empty so a retry can succeed', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('species dict 503'));
    const client = makeClient({ getSpeciesDictionary: failing } as unknown as Partial<ApiClient>);

    const { result } = renderHook(() => useSpeciesDictionary(client));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe('species dict 503');
    expect(result.current.dictionary.size).toBe(0);

    const succeeding = vi.fn().mockResolvedValue(ROWS);
    const healthy = makeClient({ getSpeciesDictionary: succeeding } as unknown as Partial<ApiClient>);
    const retry = renderHook(() => useSpeciesDictionary(healthy));
    await waitFor(() => expect(retry.result.current.loading).toBe(false));
    expect(retry.result.current.dictionary.get('norcar')?.comName).toBe('Northern Cardinal');
  });
});

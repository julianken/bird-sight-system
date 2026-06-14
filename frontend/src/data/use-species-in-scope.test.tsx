import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSpeciesInScope } from './use-species-in-scope.js';
import { ApiClient } from '../api/client.js';

function makeClient(getSpeciesInScope: unknown): ApiClient {
  return Object.assign(new ApiClient(), { getSpeciesInScope });
}

const ROWS = [
  { code: 'annhum', comName: "Anna's Hummingbird", familyCode: 'trochilidae' },
  { code: 'vermfly', comName: 'Vermilion Flycatcher', familyCode: 'tyrannidae' },
];

describe('useSpeciesInScope', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches the represented species and exposes them as SpeciesOption[]', async () => {
    const getSpeciesInScope = vi.fn().mockResolvedValue(ROWS);
    const client = makeClient(getSpeciesInScope);

    const { result } = renderHook(() =>
      useSpeciesInScope(client, { since: '14d' }, true),
    );
    expect(result.current.loading).toBe(true);
    expect(result.current.speciesIndex).toEqual([]);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.speciesIndex).toEqual([
      { code: 'annhum', comName: "Anna's Hummingbird", familyCode: 'trochilidae' },
      { code: 'vermfly', comName: 'Vermilion Flycatcher', familyCode: 'tyrannidae' },
    ]);
    expect(getSpeciesInScope).toHaveBeenCalledWith({ since: '14d' });
  });

  it('does NOT fetch (and reports not-loading) while disabled (unscoped landing)', async () => {
    const getSpeciesInScope = vi.fn().mockResolvedValue(ROWS);
    const client = makeClient(getSpeciesInScope);
    const { result } = renderHook(() =>
      useSpeciesInScope(client, { since: '14d' }, false),
    );
    expect(result.current.loading).toBe(false);
    expect(result.current.speciesIndex).toEqual([]);
    expect(getSpeciesInScope).not.toHaveBeenCalled();
  });

  it('refetches when a scalar filter value changes (family)', async () => {
    const getSpeciesInScope = vi
      .fn()
      .mockResolvedValueOnce(ROWS)
      .mockResolvedValueOnce([ROWS[1]]); // family-narrowed to tyrannidae
    const client = makeClient(getSpeciesInScope);

    const { result, rerender } = renderHook(
      ({ family }: { family?: string }) =>
        useSpeciesInScope(
          client,
          family ? { since: '14d', familyCode: family } : { since: '14d' },
          true,
        ),
      { initialProps: {} as { family?: string } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.speciesIndex).toHaveLength(2);

    rerender({ family: 'tyrannidae' });
    await waitFor(() => expect(result.current.speciesIndex).toHaveLength(1));
    expect(result.current.speciesIndex[0]!.code).toBe('vermfly');
    expect(getSpeciesInScope).toHaveBeenCalledTimes(2);
  });

  it('does NOT refetch when given a fresh identical filter object (scalar-keyed)', async () => {
    const getSpeciesInScope = vi.fn().mockResolvedValue(ROWS);
    const client = makeClient(getSpeciesInScope);
    const { result, rerender } = renderHook(() =>
      // New object literal every render — same VALUES.
      useSpeciesInScope(client, { since: '14d', notable: false }, true),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender();
    rerender();
    expect(getSpeciesInScope).toHaveBeenCalledTimes(1);
  });

  it('surfaces a fetch error without throwing', async () => {
    const getSpeciesInScope = vi.fn().mockRejectedValue(new Error('scope 503'));
    const client = makeClient(getSpeciesInScope);
    const { result } = renderHook(() =>
      useSpeciesInScope(client, { since: '14d' }, true),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe('scope 503');
    expect(result.current.speciesIndex).toEqual([]);
  });
});

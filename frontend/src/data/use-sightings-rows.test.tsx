import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { ApiClient } from '@/api/client.js';
import type { CellObservationsResponse, Observation } from '@bird-watch/shared-types';
import type { SightingRow, SightingsContext } from '@/components/sightings-context.js';
import { useSightingsRows } from './use-sightings-rows.js';

const apiClient = new ApiClient({ baseUrl: '' });

function obs(over: Partial<Observation> & { subId: string; speciesCode: string; obsDt: string }): Observation {
  return {
    comName: 'Vermilion Flycatcher',
    lat: 32.27,
    lng: -110.85,
    locId: 'L99',
    locName: 'Sweetwater Wetlands',
    howMany: null,
    isNotable: false,
    silhouetteId: 'tyrannidae',
    familyCode: 'tyrannidae',
    ...over,
  };
}

const CELL: Extract<SightingsContext, { kind: 'cell' }> = {
  kind: 'cell',
  lngBucket: -110.5,
  latBucket: 32.5,
  gridMultiplier: 2,
  scopeKey: 'US-AZ',
};

function row(over: Partial<SightingRow> & { subId: string; speciesCode: string; obsDt: string }): SightingRow {
  return { locName: null, howMany: null, isNotable: false, ...over };
}

describe('useSightingsRows — leaves branch', () => {
  it('filters to the selected species and sorts newest-first', () => {
    const context: SightingsContext = {
      kind: 'leaves',
      rows: [
        row({ subId: 'A', speciesCode: 'vermfly', obsDt: '2026-04-15T08:00:00Z' }),
        row({ subId: 'B', speciesCode: 'verdin', obsDt: '2026-04-15T09:00:00Z' }),
        row({ subId: 'C', speciesCode: 'vermfly', obsDt: '2026-04-15T12:00:00Z' }),
        row({ subId: 'D', speciesCode: 'vermfly', obsDt: '2026-04-15T10:00:00Z' }),
      ],
    };
    const { result } = renderHook(() => useSightingsRows(apiClient, 'vermfly', context));
    expect(result.current.supported).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.truncated).toBe(false);
    // Only vermfly rows, ordered C (12:00) > D (10:00) > A (08:00).
    expect(result.current.rows.map((r) => r.subId)).toEqual(['C', 'D', 'A']);
    expect(result.current.total).toBe(3);
  });

  it('total stays the full pre-cap count (the component owns the visible cap)', () => {
    const rows = Array.from({ length: 70 }, (_, i) =>
      row({ subId: `S${i}`, speciesCode: 'vermfly', obsDt: `2026-04-15T${String(i % 24).padStart(2, '0')}:00:00Z` }),
    );
    const { result } = renderHook(() =>
      useSightingsRows(apiClient, 'vermfly', { kind: 'leaves', rows }),
    );
    expect(result.current.rows).toHaveLength(70);
    expect(result.current.total).toBe(70);
    expect(result.current.truncated).toBe(false);
  });

  it('returns an empty supported state when no leaf matches the species', () => {
    const { result } = renderHook(() =>
      useSightingsRows(apiClient, 'amerob', {
        kind: 'leaves',
        rows: [row({ subId: 'A', speciesCode: 'vermfly', obsDt: '2026-04-15T08:00:00Z' })],
      }),
    );
    expect(result.current.supported).toBe(true);
    expect(result.current.rows).toEqual([]);
    expect(result.current.total).toBe(0);
  });
});

describe('useSightingsRows — unsupported branches', () => {
  it('returns supported:false for a null context', () => {
    const { result } = renderHook(() => useSightingsRows(apiClient, 'vermfly', null));
    expect(result.current).toEqual({
      rows: [],
      total: 0,
      truncated: false,
      loading: false,
      error: null,
      supported: false,
    });
  });

  it('returns supported:false for a cell context with an empty speciesCode (no fetch)', () => {
    const fetchSpy = vi.spyOn(apiClient, 'getCellObservations');
    const { result } = renderHook(() => useSightingsRows(apiClient, '', CELL, '7d'));
    expect(result.current.supported).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('useSightingsRows — cell branch (#1302)', () => {
  function cellResponse(over: Partial<CellObservationsResponse> = {}): CellObservationsResponse {
    return {
      data: [
        obs({ subId: 'C', speciesCode: 'vermfly', obsDt: '2026-04-15T12:00:00Z', howMany: 4 }),
        obs({ subId: 'A', speciesCode: 'vermfly', obsDt: '2026-04-15T08:00:00Z' }),
      ],
      meta: { cellObservationCount: 2, truncated: false },
      ...over,
    };
  }

  it('starts loading, then maps the fetched Observation[] to SightingRow[] with total + truncated', async () => {
    const fetchSpy = vi
      .spyOn(apiClient, 'getCellObservations')
      .mockResolvedValue(cellResponse({ meta: { cellObservationCount: 137, truncated: true } }));
    const { result } = renderHook(() => useSightingsRows(apiClient, 'vermfly', CELL, '7d'));

    // First commit: supported + loading, no rows yet.
    expect(result.current.supported).toBe(true);
    expect(result.current.loading).toBe(true);
    expect(result.current.rows).toEqual([]);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.rows.map((r) => r.subId)).toEqual(['C', 'A']);
    // Full Observation → SightingRow projection (subId/speciesCode/obsDt/locName/howMany/isNotable).
    expect(result.current.rows[0]).toEqual({
      subId: 'C',
      speciesCode: 'vermfly',
      obsDt: '2026-04-15T12:00:00Z',
      locName: 'Sweetwater Wetlands',
      howMany: 4,
      isNotable: false,
    });
    // M is meta.cellObservationCount (the truncation-banner denominator), NOT rows.length.
    expect(result.current.total).toBe(137);
    expect(result.current.truncated).toBe(true);
    fetchSpy.mockRestore();
  });

  it('carries the ACTIVE since-window through to the client call (1d → since=1d)', async () => {
    const fetchSpy = vi.spyOn(apiClient, 'getCellObservations').mockResolvedValue(cellResponse());
    renderHook(() => useSightingsRows(apiClient, 'vermfly', CELL, '1d'));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(fetchSpy).toHaveBeenCalledWith({
      scopeKey: 'US-AZ',
      gridMultiplier: 2,
      lngBucket: -110.5,
      latBucket: 32.5,
      speciesCode: 'vermfly',
      since: '1d',
    });
    fetchSpy.mockRestore();
  });

  it('omits since from the client arg when the active window is undefined (exactOptionalPropertyTypes)', async () => {
    const fetchSpy = vi.spyOn(apiClient, 'getCellObservations').mockResolvedValue(cellResponse());
    renderHook(() => useSightingsRows(apiClient, 'vermfly', CELL));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const arg = fetchSpy.mock.calls[0]![0];
    expect('since' in arg).toBe(false);
    fetchSpy.mockRestore();
  });

  it('renders nothing for a resolved 0-row cell fetch (supported, not loading, empty rows)', async () => {
    const fetchSpy = vi
      .spyOn(apiClient, 'getCellObservations')
      .mockResolvedValue({ data: [], meta: { cellObservationCount: 0, truncated: false } });
    const { result } = renderHook(() => useSightingsRows(apiClient, 'vermfly', CELL, '7d'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.supported).toBe(true);
    expect(result.current.rows).toEqual([]);
    expect(result.current.total).toBe(0);
    expect(result.current.error).toBeNull();
    fetchSpy.mockRestore();
  });

  it('surfaces a rejected cell fetch as error (loading cleared)', async () => {
    const boom = new Error('cell fetch failed');
    const fetchSpy = vi.spyOn(apiClient, 'getCellObservations').mockRejectedValue(boom);
    const { result } = renderHook(() => useSightingsRows(apiClient, 'vermfly', CELL, '7d'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(boom);
    expect(result.current.rows).toEqual([]);
    fetchSpy.mockRestore();
  });

  it('drops a stale resolution after the selected species changes (cancelled-flag guard)', async () => {
    // First species resolves LATE; second species resolves first. The stale
    // (first) resolution must NEVER overwrite the second species' state.
    let resolveFirst!: (r: CellObservationsResponse) => void;
    const firstPromise = new Promise<CellObservationsResponse>((res) => {
      resolveFirst = res;
    });
    const fetchSpy = vi
      .spyOn(apiClient, 'getCellObservations')
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce(
        cellResponse({
          data: [obs({ subId: 'SECOND', speciesCode: 'norcar', obsDt: '2026-04-16T09:00:00Z' })],
          meta: { cellObservationCount: 1, truncated: false },
        }),
      );

    const { result, rerender } = renderHook(
      ({ code }: { code: string }) => useSightingsRows(apiClient, code, CELL, '7d'),
      { initialProps: { code: 'vermfly' } },
    );

    // Re-render with a NEW species BEFORE the first fetch resolves — this
    // supersedes the first effect (its cleanup sets cancelled = true).
    rerender({ code: 'norcar' });
    await waitFor(() => expect(result.current.rows.map((r) => r.subId)).toEqual(['SECOND']));

    // Now resolve the FIRST (stale) fetch — it must be dropped, leaving the
    // second species' rows intact.
    resolveFirst(cellResponse());
    await Promise.resolve();
    await Promise.resolve();
    expect(result.current.rows.map((r) => r.subId)).toEqual(['SECOND']);
    expect(result.current.total).toBe(1);
    fetchSpy.mockRestore();
  });
});

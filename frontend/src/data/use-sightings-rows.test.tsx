import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ApiClient } from '@/api/client.js';
import type { SightingRow, SightingsContext } from '@/components/sightings-context.js';
import { useSightingsRows } from './use-sightings-rows.js';

const apiClient = new ApiClient({ baseUrl: '' });

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

describe('useSightingsRows — unsupported branches (cell wired in F3)', () => {
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

  it('returns supported:false for a cell context (no fetch in F2)', () => {
    const context: SightingsContext = {
      kind: 'cell',
      lngBucket: -110.5,
      latBucket: 32.5,
      gridMultiplier: 2,
      scopeKey: 'US-AZ',
    };
    const { result } = renderHook(() => useSightingsRows(apiClient, 'vermfly', context, '7d'));
    expect(result.current.supported).toBe(false);
    expect(result.current.rows).toEqual([]);
    expect(result.current.total).toBe(0);
  });
});

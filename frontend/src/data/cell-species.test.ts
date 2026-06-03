import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  cellBbox,
  gridMultiplierForZoom,
  useCellSpecies,
} from './cell-species.js';
import { ApiClient } from '../api/client.js';
import type { Observation, ObservationsResponse } from '@bird-watch/shared-types';

function makeClient(overrides: Partial<ApiClient>): ApiClient {
  return Object.assign(new ApiClient(), overrides);
}

function obs(speciesCode: string | null, comName: string, family: string | null): Observation {
  return {
    subId: `s-${comName}`,
    speciesCode,
    comName,
    lat: 34,
    lng: -111,
    obsDt: '2026-06-01T00:00:00.000Z',
    locId: 'L1',
    locName: null,
    howMany: null,
    isNotable: false,
    silhouetteId: family,
    familyCode: family,
  };
}

function observationsEnvelope(data: Observation[]): ObservationsResponse {
  return {
    mode: 'observations',
    data,
    meta: { freshestObservationAt: '2026-06-01T00:00:00.000Z' },
  };
}

describe('gridMultiplierForZoom', () => {
  it('mirrors app.ts:241 — 2 at z<=3, 4 at z4, 8 at z>=5', () => {
    expect(gridMultiplierForZoom(0)).toBe(2);
    expect(gridMultiplierForZoom(3)).toBe(2);
    expect(gridMultiplierForZoom(4)).toBe(4);
    expect(gridMultiplierForZoom(5)).toBe(8);
    expect(gridMultiplierForZoom(5.9)).toBe(8);
  });
});

describe('cellBbox', () => {
  it('z3 (mult 2) → ±0.25° per axis around the center', () => {
    expect(cellBbox([-111, 34], 3)).toEqual([-111.25, 33.75, -110.75, 34.25]);
  });
  it('z4 (mult 4) → ±0.125° per axis', () => {
    expect(cellBbox([-111, 34], 4)).toEqual([-111.125, 33.875, -110.875, 34.125]);
  });
  it('z5 (mult 8) → ±0.0625° per axis', () => {
    expect(cellBbox([-111, 34], 5)).toEqual([-111.0625, 33.9375, -110.9375, 34.0625]);
  });
});

describe('useCellSpecies', () => {
  it('does not fetch when active=false (close-zoom, mode !== aggregated)', () => {
    const getObservations = vi.fn();
    const client = makeClient({ getObservations } as unknown as Partial<ApiClient>);
    const { result } = renderHook(() =>
      useCellSpecies(client, { active: false, center: [-111, 34], gridZoom: 3 }),
    );
    expect(result.current).toEqual({ loading: false, error: null, species: null });
    expect(getObservations).not.toHaveBeenCalled();
  });

  it('fetches the cell bbox at synthetic zoom=6 with threaded filters', async () => {
    const getObservations = vi.fn().mockResolvedValue(observationsEnvelope([
      obs('vermfly', 'Vermilion Flycatcher', 'tyrannidae'),
    ]));
    const client = makeClient({ getObservations } as unknown as Partial<ApiClient>);
    renderHook(() =>
      useCellSpecies(client, {
        active: true,
        center: [-111, 34],
        gridZoom: 3,
        since: '7d',
        stateCode: 'US-AZ',
      }),
    );
    await waitFor(() => expect(getObservations).toHaveBeenCalledTimes(1));
    expect(getObservations).toHaveBeenCalledWith({
      bbox: [-111.25, 33.75, -110.75, 34.25],
      zoom: 6,
      since: '7d',
      stateCode: 'US-AZ',
    });
  });

  it('threads familyCode when the per-family popover narrows the cell fetch', async () => {
    const getObservations = vi.fn().mockResolvedValue(observationsEnvelope([]));
    const client = makeClient({ getObservations } as unknown as Partial<ApiClient>);
    renderHook(() =>
      useCellSpecies(client, {
        active: true,
        center: [-111, 34],
        gridZoom: 4,
        familyCode: 'accipitridae',
      }),
    );
    await waitFor(() => expect(getObservations).toHaveBeenCalledTimes(1));
    expect(getObservations).toHaveBeenCalledWith({
      bbox: [-111.125, 33.875, -110.875, 34.125],
      zoom: 6,
      familyCode: 'accipitridae',
    });
  });

  it('exposes loading → success and dedupes by speciesCode, count desc', async () => {
    const getObservations = vi.fn().mockResolvedValue(observationsEnvelope([
      obs('vermfly', 'Vermilion Flycatcher', 'tyrannidae'),
      obs('vermfly', 'Vermilion Flycatcher', 'tyrannidae'),
      obs('gambel', "Gambel's Quail", 'odontophoridae'),
    ]));
    const client = makeClient({ getObservations } as unknown as Partial<ApiClient>);
    const { result } = renderHook(() =>
      useCellSpecies(client, { active: true, center: [-111, 34], gridZoom: 3 }),
    );
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.species).toEqual([
      { speciesCode: 'vermfly', comName: 'Vermilion Flycatcher', count: 2 },
      { speciesCode: 'gambel', comName: "Gambel's Quail", count: 1 },
    ]);
  });

  it('preserves null speciesCode rows (spuh/slash) keyed by comName', async () => {
    const getObservations = vi.fn().mockResolvedValue(observationsEnvelope([
      obs(null, 'duck sp.', 'anatidae'),
      obs(null, 'duck sp.', 'anatidae'),
    ]));
    const client = makeClient({ getObservations } as unknown as Partial<ApiClient>);
    const { result } = renderHook(() =>
      useCellSpecies(client, { active: true, center: [-111, 34], gridZoom: 3 }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.species).toEqual([
      { speciesCode: null, comName: 'duck sp.', count: 2 },
    ]);
  });

  it('surfaces an empty array when the cell has no observations', async () => {
    const getObservations = vi.fn().mockResolvedValue(observationsEnvelope([]));
    const client = makeClient({ getObservations } as unknown as Partial<ApiClient>);
    const { result } = renderHook(() =>
      useCellSpecies(client, { active: true, center: [-111, 34], gridZoom: 3 }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.species).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('surfaces an error when the fetch rejects', async () => {
    const getObservations = vi.fn().mockRejectedValue(new Error('boom'));
    const client = makeClient({ getObservations } as unknown as Partial<ApiClient>);
    const { result } = renderHook(() =>
      useCellSpecies(client, { active: true, center: [-111, 34], gridZoom: 3 }),
    );
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.loading).toBe(false);
    expect(result.current.species).toBeNull();
  });

  it('ignores an aggregated envelope (defensive — should never happen at zoom=6)', async () => {
    const getObservations = vi.fn().mockResolvedValue({
      mode: 'aggregated',
      buckets: [],
      meta: { freshestObservationAt: null },
    } as ObservationsResponse);
    const client = makeClient({ getObservations } as unknown as Partial<ApiClient>);
    const { result } = renderHook(() =>
      useCellSpecies(client, { active: true, center: [-111, 34], gridZoom: 3 }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.species).toEqual([]);
  });
});

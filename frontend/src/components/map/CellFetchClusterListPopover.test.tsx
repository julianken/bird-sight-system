import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { CellFetchClusterListPopover } from './CellFetchClusterListPopover.js';
import { ApiClient } from '../../api/client.js';
import type { FamilyAggregate, SpeciesAggregate } from './adaptive-grid.js';
import type { ObservationsResponse } from '@bird-watch/shared-types';

afterEach(cleanup);

function makeClient(getObservations: ReturnType<typeof vi.fn>): ApiClient {
  return Object.assign(new ApiClient(), { getObservations });
}

const families: FamilyAggregate[] = [{ familyCode: 'anatidae', count: 3 }];
const speciesByFamily = new Map<string, ReadonlyArray<SpeciesAggregate>>();

const emptyEnvelope: ObservationsResponse = {
  mode: 'observations',
  data: [],
  meta: { freshestObservationAt: null },
};

describe('CellFetchClusterListPopover', () => {
  it('fetches the explicit cluster bbox (not the centroid cell) — #859 regression', async () => {
    // The supercluster spans multiple cells; its centroid 0.125° cell is empty.
    // The wrapper must fetch the cluster's union bbox, threaded from MapCanvas.
    const clusterBbox: [number, number, number, number] = [-90.2, 36.4, -89.5, 37.05];
    const getObservations = vi.fn().mockResolvedValue(emptyEnvelope);
    const client = makeClient(getObservations);
    const anchorEl = document.createElement('button');
    document.body.appendChild(anchorEl);

    render(
      <CellFetchClusterListPopover
        client={client}
        center={[-89.88, 36.74]}
        gridZoom={4}
        bbox={clusterBbox}
        since="14d"
        families={families}
        speciesByFamily={speciesByFamily}
        totalCount={31}
        uniqueFamilies={17}
        anchorEl={anchorEl}
        onDismiss={() => {}}
        onSelectSpecies={() => {}}
      />,
    );

    await waitFor(() => expect(getObservations).toHaveBeenCalledTimes(1));
    expect(getObservations).toHaveBeenCalledWith({
      bbox: clusterBbox,
      zoom: 6,
      since: '14d',
    });
  });

  it('falls back to the centroid cell bbox when no cluster bbox is supplied', async () => {
    const getObservations = vi.fn().mockResolvedValue(emptyEnvelope);
    const client = makeClient(getObservations);
    const anchorEl = document.createElement('button');
    document.body.appendChild(anchorEl);

    render(
      <CellFetchClusterListPopover
        client={client}
        center={[-111, 34]}
        gridZoom={4}
        families={families}
        speciesByFamily={speciesByFamily}
        totalCount={3}
        uniqueFamilies={1}
        anchorEl={anchorEl}
        onDismiss={() => {}}
        onSelectSpecies={() => {}}
      />,
    );

    await waitFor(() => expect(getObservations).toHaveBeenCalledTimes(1));
    // z4 → ±0.125° cell around the centroid.
    expect(getObservations).toHaveBeenCalledWith({
      bbox: [-111.125, 33.875, -110.875, 34.125],
      zoom: 6,
    });
  });
});

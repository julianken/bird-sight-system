import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ApiClient } from '@/api/client.js';
import type { CellObservationsResponse, Observation } from '@bird-watch/shared-types';
import type { SightingRow, SightingsContext } from './sightings-context.js';
import { SightingsLog } from './SightingsLog.js';

const apiClient = new ApiClient({ baseUrl: '' });

afterEach(() => {
  vi.restoreAllMocks();
});

const CELL: Extract<SightingsContext, { kind: 'cell' }> = {
  kind: 'cell',
  lngBucket: -110.5,
  latBucket: 32.5,
  gridMultiplier: 2,
  scopeKey: 'US-AZ',
};

function cellObs(over: Partial<Observation> & { subId: string; obsDt: string }): Observation {
  return {
    speciesCode: 'vermfly',
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

function row(over: Partial<SightingRow> & { subId: string; obsDt: string }): SightingRow {
  return { speciesCode: 'vermfly', locName: null, howMany: null, isNotable: false, ...over };
}

function renderLog(context: SightingsContext | null, speciesCode = 'vermfly') {
  return render(
    <SightingsLog apiClient={apiClient} speciesCode={speciesCode} context={context} />,
  );
}

describe('SightingsLog', () => {
  it('renders nothing when the context is null (unsupported)', () => {
    const { container } = renderLog(null);
    expect(container.firstChild).toBeNull();
  });

  it('shows a static loading affordance (no spinner/count animation) while the cell fetch is in flight', () => {
    // Never-resolving fetch → stays in the loading state.
    vi.spyOn(apiClient, 'getCellObservations').mockReturnValue(
      new Promise<CellObservationsResponse>(() => {}),
    );
    const { container } = render(
      <SightingsLog apiClient={apiClient} speciesCode="vermfly" context={CELL} since="7d" />,
    );
    const loading = container.querySelector('.detail-fg-sightings-loading');
    expect(loading).not.toBeNull();
    expect(loading?.textContent).toMatch(/loading sightings/i);
    // No rows / no banner while loading.
    expect(container.querySelector('.detail-fg-sighting-row')).toBeNull();
    expect(container.querySelector('.detail-fg-sightings-truncation')).toBeNull();
  });

  it('renders the fetched cell rows + truncation banner using meta.cellObservationCount as M', async () => {
    vi.spyOn(apiClient, 'getCellObservations').mockResolvedValue({
      data: [
        cellObs({ subId: 'C', obsDt: '2026-04-15T12:00:00Z', locName: 'Sweetwater Wetlands', howMany: 4 }),
        cellObs({ subId: 'A', obsDt: '2026-04-15T08:00:00Z', locName: 'Patagonia' }),
      ],
      meta: { cellObservationCount: 137, truncated: true },
    });
    const { container } = render(
      <SightingsLog apiClient={apiClient} speciesCode="vermfly" context={CELL} since="7d" />,
    );
    const section = await screen.findByRole('region', { name: /sightings under this marker/i });
    expect(section).toBeInTheDocument();
    expect(container.querySelectorAll('.detail-fg-sighting-row')).toHaveLength(2);
    // Banner reads "Showing latest N of M" with M = meta.cellObservationCount.
    expect(container.querySelector('.detail-fg-sightings-truncation')?.textContent).toBe(
      'Showing latest 2 of 137',
    );
    // No loading affordance once resolved.
    expect(container.querySelector('.detail-fg-sightings-loading')).toBeNull();
  });

  it('renders NOTHING for a resolved 0-row cell fetch (no empty shell)', async () => {
    vi.spyOn(apiClient, 'getCellObservations').mockResolvedValue({
      data: [],
      meta: { cellObservationCount: 0, truncated: false },
    });
    const { container } = render(
      <SightingsLog apiClient={apiClient} speciesCode="vermfly" context={CELL} since="7d" />,
    );
    // Wait for the loading affordance to disappear, then assert no section.
    await waitFor(() => expect(container.querySelector('.detail-fg-sightings-loading')).toBeNull());
    expect(container.firstChild).toBeNull();
  });

  it('renders NOTHING on a rejected cell fetch (the panel already has the species)', async () => {
    vi.spyOn(apiClient, 'getCellObservations').mockRejectedValue(new Error('boom'));
    const { container } = render(
      <SightingsLog apiClient={apiClient} speciesCode="vermfly" context={CELL} since="7d" />,
    );
    await waitFor(() => expect(container.querySelector('.detail-fg-sightings-loading')).toBeNull());
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when no leaf matches the selected species', () => {
    const { container } = renderLog({
      kind: 'leaves',
      rows: [row({ subId: 'A', obsDt: '2026-04-15T08:00:00Z', speciesCode: 'verdin' })],
    });
    expect(container.firstChild).toBeNull();
  });

  it('renders one row for a single-sighting marker (popover seam)', () => {
    renderLog({
      kind: 'leaves',
      rows: [row({ subId: 'A', obsDt: '2026-04-15T08:00:00Z', locName: 'Sweetwater Wetlands' })],
    });
    const section = screen.getByRole('region', { name: /sightings under this marker/i });
    expect(section).toBeInTheDocument();
    const rows = section.querySelectorAll('.detail-fg-sighting-row');
    expect(rows).toHaveLength(1);
    expect(screen.getByText('Sweetwater Wetlands')).toBeInTheDocument();
  });

  it('renders two rows newest-first for a 2-observation stack (cluster-list seam)', () => {
    const { container } = renderLog({
      kind: 'leaves',
      rows: [
        row({ subId: 'OLD', obsDt: '2026-04-15T08:00:00Z', locName: 'Patch A' }),
        row({ subId: 'NEW', obsDt: '2026-04-15T12:00:00Z', locName: 'Patch B' }),
      ],
    });
    const locations = Array.from(container.querySelectorAll('.detail-fg-sighting-location')).map(
      (n) => n.textContent,
    );
    expect(locations).toEqual(['Patch B', 'Patch A']);
  });

  it('shows the count column ONLY when howMany > 1 (divergence from the popover)', () => {
    const { container } = renderLog({
      kind: 'leaves',
      rows: [
        row({ subId: 'one', obsDt: '2026-04-15T12:00:00Z', howMany: 1 }),
        row({ subId: 'three', obsDt: '2026-04-15T11:00:00Z', howMany: 3 }),
        row({ subId: 'null', obsDt: '2026-04-15T10:00:00Z', howMany: null }),
      ],
    });
    const counts = Array.from(container.querySelectorAll('.detail-fg-sighting-count')).map(
      (n) => n.textContent,
    );
    // Only the howMany:3 row renders a count cell.
    expect(counts).toEqual(['×3']);
  });

  it('renders the notable badge only for notable rows', () => {
    const { container } = renderLog({
      kind: 'leaves',
      rows: [
        row({ subId: 'plain', obsDt: '2026-04-15T12:00:00Z', isNotable: false }),
        row({ subId: 'note', obsDt: '2026-04-15T11:00:00Z', isNotable: true }),
      ],
    });
    expect(container.querySelectorAll('.detail-fg-sighting-notable')).toHaveLength(1);
  });

  it('caps at 50 visible rows and shows a static "Showing latest 50 of M" banner', () => {
    const rows = Array.from({ length: 63 }, (_, i) =>
      row({
        subId: `S${i}`,
        // descending ISO times so the newest 50 are deterministic
        obsDt: `2026-04-${String(2 + (i % 27)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00:00Z`,
      }),
    );
    const { container } = renderLog({ kind: 'leaves', rows });
    expect(container.querySelectorAll('.detail-fg-sighting-row')).toHaveLength(50);
    const banner = container.querySelector('.detail-fg-sightings-truncation');
    expect(banner?.textContent).toBe('Showing latest 50 of 63');
  });

  it('renders no truncation banner at exactly the cap', () => {
    const rows = Array.from({ length: 50 }, (_, i) =>
      row({ subId: `S${i}`, obsDt: `2026-04-15T${String(i % 24).padStart(2, '0')}:00:00Z` }),
    );
    const { container } = renderLog({ kind: 'leaves', rows });
    expect(container.querySelectorAll('.detail-fg-sighting-row')).toHaveLength(50);
    expect(container.querySelector('.detail-fg-sightings-truncation')).toBeNull();
  });

  // R8 (F3 second pass): a same-bucket species SWITCH must NOT flash the prior
  // species' cell rows for a commit before the new fetch starts. The cell rows
  // live in useState; before the fix, `return syncState ?? cellState` handed the
  // OLD species' resolved rows to the very FIRST render under the NEW species
  // (the cell context kind is unchanged, so syncState is still null), painting a
  // stale row tied to the wrong species before the loading-reset effect ran. The
  // fix resets the cell state synchronously when the fetch identity changes, so
  // the switch shows a clean loading state with no stale paint — applied in the
  // shared hook, so it covers BOTH the desktop Rail mount and the mobile Sheet
  // mount. The render-by-render proof (no commit under the new species carries
  // the prior species' rows) lives in use-sightings-rows.test.tsx; this asserts
  // the user-visible end state of the switch (loading, prior rows gone).
  it('shows a clean loading state (no prior rows) after a same-bucket species switch', async () => {
    const firstResponse: CellObservationsResponse = {
      data: [cellObs({ subId: 'VERM1', obsDt: '2026-04-15T12:00:00Z', locName: 'Sweetwater Wetlands' })],
      meta: { cellObservationCount: 1, truncated: false },
    };
    const fetchSpy = vi
      .spyOn(apiClient, 'getCellObservations')
      .mockResolvedValueOnce(firstResponse)
      // norcar's fetch never resolves — the switch must show loading, not stale rows.
      .mockReturnValueOnce(new Promise<CellObservationsResponse>(() => {}));

    const { container, rerender } = render(
      <SightingsLog apiClient={apiClient} speciesCode="vermfly" context={CELL} since="7d" />,
    );
    // First species' row paints once the fetch resolves.
    await screen.findByText('Sweetwater Wetlands');
    expect(container.querySelectorAll('.detail-fg-sighting-row')).toHaveLength(1);

    // Same cell bucket, NEW species — the prior species' row must be gone and the
    // static loading affordance shown (a fresh, in-flight fetch for the new code).
    rerender(
      <SightingsLog apiClient={apiClient} speciesCode="norcar" context={CELL} since="7d" />,
    );
    expect(screen.queryByText('Sweetwater Wetlands')).toBeNull();
    expect(container.querySelectorAll('.detail-fg-sighting-row')).toHaveLength(0);
    expect(container.querySelector('.detail-fg-sightings-loading')).not.toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

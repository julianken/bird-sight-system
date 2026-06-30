import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ApiClient } from '@/api/client.js';
import type { SightingRow, SightingsContext } from './sightings-context.js';
import { SightingsLog } from './SightingsLog.js';

const apiClient = new ApiClient({ baseUrl: '' });

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

  it('renders nothing for a cell context (cell wired in F3)', () => {
    const { container } = renderLog({
      kind: 'cell',
      lngBucket: -110.5,
      latBucket: 32.5,
      gridMultiplier: 2,
      scopeKey: 'US-AZ',
    });
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
});

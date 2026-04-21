import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Hotspot } from '@bird-watch/shared-types';
import { HotspotRow, STALE_THRESHOLD_DAYS } from './HotspotRow.js';

// Local reference instant. Hotspot rows format relative times in the
// viewer's local TZ (same as ObservationFeedRow), so constructing NOW
// from local components makes the assertions stable across the macOS
// dev TZ (America/Phoenix) and GitHub Actions (UTC).
const NOW = new Date(2026, 3, 15, 15, 0, 0, 0);

const BASE_HOTSPOT: Hotspot = {
  locId: 'L1234567',
  locName: 'Sabino Canyon Recreation Area',
  lat: 32.321,
  lng: -110.812,
  regionId: null,
  numSpeciesAlltime: 287,
  latestObsDt: new Date(NOW.getTime() - 2 * 60 * 60_000).toISOString(), // 2h ago
};

describe('HotspotRow', () => {
  it('renders locName, species count, coords, and relative time', () => {
    render(<HotspotRow hotspot={BASE_HOTSPOT} now={NOW} />);
    // Visible text checks: each slot exists in the DOM. These are the
    // four columns an observer sees scanning the list.
    expect(screen.getByText('Sabino Canyon Recreation Area')).toBeInTheDocument();
    expect(screen.getByText('287 species')).toBeInTheDocument();
    expect(screen.getByText('32.32°N, 110.81°W')).toBeInTheDocument();
    expect(screen.getByText('2h ago')).toBeInTheDocument();
  });

  it('pins a single comprehensive aria-label combining locName, count, coords, time', () => {
    // Same pattern PR #135 locked in for ObservationFeedRow: one
    // accessible name on the row element, child spans aria-hidden so
    // screen readers don't get a duplicate read of the count chip or
    // coord text. Order is locName → count → coords → time.
    render(<HotspotRow hotspot={BASE_HOTSPOT} now={NOW} />);
    const row = screen.getByRole('listitem');
    expect(row).toHaveAccessibleName(
      'Sabino Canyon Recreation Area, 287 species, at 32.32°N, 110.81°W, last seen 2h ago',
    );
  });

  it('de-emphasizes rows whose latestObsDt is null (never-observed hotspot)', () => {
    render(
      <HotspotRow
        hotspot={{ ...BASE_HOTSPOT, latestObsDt: null, numSpeciesAlltime: null }}
        now={NOW}
      />
    );
    const row = screen.getByRole('listitem');
    expect(row.className).toMatch(/\bhotspot-row-stale\b/);
    // "Never observed" surfaces in the visible and accessible slots as
    // "no recent activity" (stale signal IS the info per spec).
    expect(row).toHaveAccessibleName(
      expect.stringContaining('no recent activity'),
    );
  });

  it(`de-emphasizes rows whose latestObsDt is older than ${STALE_THRESHOLD_DAYS} days`, () => {
    // Threshold is strict >30d. At 30d exactly the row is still fresh;
    // at 30d + 1ms it's stale. Using 31 full days keeps the boundary
    // explicit and tolerant of clock drift in test runners.
    const thirtyOneDaysAgo = new Date(
      NOW.getTime() - 31 * 24 * 60 * 60_000,
    ).toISOString();
    render(
      <HotspotRow
        hotspot={{ ...BASE_HOTSPOT, latestObsDt: thirtyOneDaysAgo }}
        now={NOW}
      />
    );
    expect(screen.getByRole('listitem').className).toMatch(/\bhotspot-row-stale\b/);
  });

  it('does NOT de-emphasize rows with recent observations (within the stale window)', () => {
    // 3 days ago is well inside the 30-day fresh window. Stale class
    // must be absent — otherwise the whole feed looks washed out.
    const threeDaysAgo = new Date(NOW.getTime() - 3 * 24 * 60 * 60_000).toISOString();
    render(
      <HotspotRow
        hotspot={{ ...BASE_HOTSPOT, latestObsDt: threeDaysAgo }}
        now={NOW}
      />
    );
    expect(screen.getByRole('listitem').className).not.toMatch(/\bhotspot-row-stale\b/);
  });
});

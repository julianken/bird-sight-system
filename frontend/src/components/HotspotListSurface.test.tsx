import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Hotspot } from '@bird-watch/shared-types';
import { HotspotListSurface } from './HotspotListSurface.js';

// Local-component NOW so format-time bucket boundaries hold across runner
// timezones (America/Phoenix on dev macOS, UTC on GitHub Actions).
const NOW = new Date(2026, 3, 15, 15, 0, 0, 0);

function hotspot(partial: Partial<Hotspot>): Hotspot {
  return {
    locId: partial.locId ?? 'L_default',
    locName: partial.locName ?? 'Default Spot',
    lat: partial.lat ?? 32,
    lng: partial.lng ?? -110,
    regionId: null,
    numSpeciesAlltime: partial.numSpeciesAlltime ?? 100,
    latestObsDt:
      'latestObsDt' in partial
        ? partial.latestObsDt ?? null
        : new Date(NOW.getTime() - 60 * 60_000).toISOString(),
  };
}

describe('HotspotListSurface', () => {
  it('renders a loading state while loading is true', () => {
    render(
      <HotspotListSurface
        loading={true}
        hotspots={[]}
        now={NOW}
      />
    );
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });

  it('renders an empty state when there are no hotspots', () => {
    render(
      <HotspotListSurface
        loading={false}
        hotspots={[]}
        now={NOW}
      />
    );
    // Wording mirrors FeedSurface's generic empty branch — the data pipe
    // already separates outages (.error-screen) from empty arrays, so
    // empty copy must NOT suggest "something broke".
    expect(screen.getByText(/No hotspots/i)).toBeInTheDocument();
  });

  it('renders an ordered list of hotspot rows with the "Hotspots" accessible name', () => {
    const items = [
      hotspot({ locId: 'L1', locName: 'Sabino Canyon' }),
      hotspot({ locId: 'L2', locName: 'Madera Canyon' }),
    ];
    render(<HotspotListSurface loading={false} hotspots={items} now={NOW} />);
    const list = screen.getByRole('list', { name: 'Hotspots' });
    expect(list.tagName).toBe('OL');
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
  });

  it('defaults to sorting by latestObsDt DESC (most-recent first)', () => {
    // Three hotspots at decreasing ages. Default sort should place the
    // 1h-ago row first, then 3h, then 3 days. Null goes last.
    const oneHourAgo = new Date(NOW.getTime() - 60 * 60_000).toISOString();
    const threeHoursAgo = new Date(NOW.getTime() - 3 * 60 * 60_000).toISOString();
    const threeDaysAgo = new Date(NOW.getTime() - 3 * 24 * 60 * 60_000).toISOString();
    const items = [
      hotspot({ locId: 'L3', locName: 'Three Days', latestObsDt: threeDaysAgo }),
      hotspot({ locId: 'LN', locName: 'Never Observed', latestObsDt: null }),
      hotspot({ locId: 'L1', locName: 'One Hour', latestObsDt: oneHourAgo }),
      hotspot({ locId: 'L2', locName: 'Three Hours', latestObsDt: threeHoursAgo }),
    ];
    render(<HotspotListSurface loading={false} hotspots={items} now={NOW} />);
    const rows = screen
      .getAllByRole('listitem')
      .map(li => li.textContent ?? '');
    // Expect 'One Hour' → 'Three Hours' → 'Three Days' → 'Never Observed'.
    expect(rows[0]).toMatch(/One Hour/);
    expect(rows[1]).toMatch(/Three Hours/);
    expect(rows[2]).toMatch(/Three Days/);
    expect(rows[3]).toMatch(/Never Observed/);
  });

  it('cycles the three-way sort toggle: latest → richness-desc → richness-asc → latest', async () => {
    const user = userEvent.setup();
    const oneHourAgo = new Date(NOW.getTime() - 60 * 60_000).toISOString();
    const threeHoursAgo = new Date(NOW.getTime() - 3 * 60 * 60_000).toISOString();
    const items = [
      // 'Low' is oldest but richest; 'High' is newest but poorest.
      // This separation lets each sort mode put a different row first,
      // which is the cleanest way to tell the modes apart in test output.
      hotspot({
        locId: 'Lo',
        locName: 'Low Freshness',
        numSpeciesAlltime: 350,
        latestObsDt: threeHoursAgo,
      }),
      hotspot({
        locId: 'Hi',
        locName: 'High Freshness',
        numSpeciesAlltime: 50,
        latestObsDt: oneHourAgo,
      }),
    ];
    render(<HotspotListSurface loading={false} hotspots={items} now={NOW} />);

    // Default: latest → High Freshness first.
    expect(screen.getAllByRole('listitem')[0]?.textContent).toMatch(/High Freshness/);

    const toggle = screen.getByRole('button', { name: /sort/i });
    // First click: richness-desc → Low Freshness (350) first.
    await user.click(toggle);
    expect(screen.getAllByRole('listitem')[0]?.textContent).toMatch(/Low Freshness/);
    // Second click: richness-asc → High Freshness (50) first again, but
    // for a different reason than the default sort.
    await user.click(toggle);
    expect(screen.getAllByRole('listitem')[0]?.textContent).toMatch(/High Freshness/);
    // Third click: back to latest → High Freshness first.
    await user.click(toggle);
    expect(screen.getAllByRole('listitem')[0]?.textContent).toMatch(/High Freshness/);
  });

  it('applies the stale class to rows whose latestObsDt is null or older than 30 days', () => {
    const oldIso = new Date(NOW.getTime() - 45 * 24 * 60 * 60_000).toISOString();
    const items = [
      hotspot({ locId: 'Fresh', locName: 'Fresh Spot' }),
      hotspot({ locId: 'Null', locName: 'Never Observed', latestObsDt: null }),
      hotspot({ locId: 'Old', locName: 'Old Spot', latestObsDt: oldIso }),
    ];
    render(<HotspotListSurface loading={false} hotspots={items} now={NOW} />);
    const rows = screen.getAllByRole('listitem');
    // Verify by name rather than by index, since sort order is implicit.
    const byName = new Map(rows.map(li => [li.textContent ?? '', li]));
    const pickBy = (needle: string) => {
      for (const [text, li] of byName) {
        if (text.includes(needle)) return li;
      }
      throw new Error(`row with text containing ${needle} not found`);
    };
    expect(pickBy('Fresh Spot').className).not.toMatch(/hotspot-row-stale/);
    expect(pickBy('Never Observed').className).toMatch(/hotspot-row-stale/);
    expect(pickBy('Old Spot').className).toMatch(/hotspot-row-stale/);
  });
});

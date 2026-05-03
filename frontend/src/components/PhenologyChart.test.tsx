import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PhenologyChart } from './PhenologyChart.js';
import { ApiClient } from '../api/client.js';

function makeClient(overrides: Partial<ApiClient>): ApiClient {
  return Object.assign(new ApiClient(), overrides);
}

describe('PhenologyChart', () => {
  it('shows a status loading message while getPhenology is pending', () => {
    const client = makeClient({
      // Pending Promise — never resolves; component should show loading copy.
      getPhenology: vi.fn().mockReturnValue(new Promise(() => {})),
    } as unknown as Partial<ApiClient>);
    render(<PhenologyChart speciesCode="vermfly" apiClient={client} />);
    const loading = screen.getByRole('status');
    expect(loading).toHaveTextContent('Loading phenology…');
    expect(loading).toHaveAttribute('aria-live', 'polite');
  });

  it('renders 12 <rect> elements with heights scaled to max(count) for full data', async () => {
    const full = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, count: (i + 1) * 2 }));
    const client = makeClient({
      getPhenology: vi.fn().mockResolvedValue(full),
    } as unknown as Partial<ApiClient>);
    const { container } = render(
      <PhenologyChart speciesCode="vermfly" apiClient={client} />
    );
    await waitFor(() => {
      expect(container.querySelectorAll('rect').length).toBe(12);
    });

    const svg = container.querySelector('svg.phenology-chart');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('viewBox', '0 0 216 108');
    // SVG attribute `overflow="visible"` is the actual fix for the Jan
    // label clipping at the left edge (#365). The CSS rule on
    // .phenology-chart provides defense-in-depth, but SVG's intrinsic
    // viewBox clipping is only overridden by the SVG attribute itself.
    expect(svg).toHaveAttribute('overflow', 'visible');

    // Tallest bar should match the value with the highest count (24 in this
    // dataset). Smallest non-zero bar is for count=2 → 1/12 of full height.
    const rects = Array.from(container.querySelectorAll('rect'));
    const heights = rects.map(r => Number(r.getAttribute('height')));
    expect(Math.max(...heights)).toBeGreaterThan(0);
    // Bar 12 (count=24) is the max — height should be largest
    const maxIdx = heights.indexOf(Math.max(...heights));
    expect(maxIdx).toBe(11);

    // Visible month labels — one <text class="phenology-label"> per slot,
    // 3-letter abbreviations starting at 'Jan'. Marked aria-hidden so the
    // SVG's aria-label and per-bar <title> tooltips remain the only
    // semantic surface for assistive tech.
    const labels = container.querySelectorAll('text.phenology-label');
    expect(labels.length).toBe(12);
    expect(labels[0]?.textContent).toBe('Jan');

    // Visible count labels — one <text class="phenology-count"> per non-zero
    // bar (issue #365). All 12 fixture entries are non-zero so all 12 count
    // labels render. aria-hidden so assistive tech doesn't double-announce
    // against the SVG's aria-label and per-bar <title> tooltips.
    const counts = container.querySelectorAll('text.phenology-count');
    expect(counts.length).toBe(12);
  });

  it('zero-fills sparse responses to exactly 12 bars', async () => {
    // Only 3 months with non-zero observations.
    const sparse = [
      { month: 3, count: 4 },
      { month: 6, count: 8 },
      { month: 9, count: 12 },
    ];
    const client = makeClient({
      getPhenology: vi.fn().mockResolvedValue(sparse),
    } as unknown as Partial<ApiClient>);
    const { container } = render(
      <PhenologyChart speciesCode="vermfly" apiClient={client} />
    );
    await waitFor(() => {
      expect(container.querySelectorAll('rect').length).toBe(12);
    });
    // Months 1, 2, 4, 5, 7, 8, 10, 11, 12 are zero-filled — heights should
    // be 0 (or rendered as zero-height non-empty placeholder is fine, but
    // with values present, zero-fills are exactly height=0 in scale-to-max
    // mapping).
    const rects = Array.from(container.querySelectorAll('rect'));
    const heights = rects.map(r => Number(r.getAttribute('height')));
    // Exactly three bars should be non-zero.
    const nonZero = heights.filter(h => h > 0);
    expect(nonZero.length).toBe(3);

    // One <text class="phenology-count"> per non-zero bar — sparse fixture
    // has 3 non-zero months, so 3 count labels should render (issue #365).
    const counts = container.querySelectorAll('text.phenology-count');
    expect(counts.length).toBe(3);
  });

  it('renders muted placeholder bars (10% height) for an empty response', async () => {
    const client = makeClient({
      getPhenology: vi.fn().mockResolvedValue([]),
    } as unknown as Partial<ApiClient>);
    const { container } = render(
      <PhenologyChart speciesCode="vermfly" apiClient={client} />
    );
    await waitFor(() => {
      expect(container.querySelectorAll('rect').length).toBe(12);
    });
    // All 12 bars rendered, all the same height (placeholder), all muted.
    const rects = Array.from(container.querySelectorAll('rect'));
    const heights = rects.map(r => Number(r.getAttribute('height')));
    // Placeholder height is 10% of BAR_AREA_HEIGHT (70 after #365 spacing
    // fix) = 7. Bar area shrank from 80 → 70 to widen the gutter so the
    // rotated month labels no longer overlap the bar floor.
    expect(heights.every(h => h === 7)).toBe(true);

    // Empty fixture: zero bars are non-zero, so zero count labels render
    // (issue #365 — count labels are skipped when count === 0).
    const counts = container.querySelectorAll('text.phenology-count');
    expect(counts.length).toBe(0);
  });

  it('returns null on getPhenology error so the surrounding surface is unaffected', async () => {
    const client = makeClient({
      getPhenology: vi.fn().mockRejectedValue(new Error('boom')),
    } as unknown as Partial<ApiClient>);
    const { container } = render(
      <PhenologyChart speciesCode="vermfly" apiClient={client} />
    );
    // Wait for the promise rejection to propagate.
    await waitFor(() => {
      // No SVG, no role=status — error path produces no DOM.
      expect(container.querySelector('svg.phenology-chart')).toBeNull();
      expect(container.querySelector('[role="status"]')).toBeNull();
    });
  });

  it('chart has an accessible label naming it phenology', async () => {
    const data = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, count: 5 }));
    const client = makeClient({
      getPhenology: vi.fn().mockResolvedValue(data),
    } as unknown as Partial<ApiClient>);
    const { container } = render(
      <PhenologyChart speciesCode="vermfly" apiClient={client} />
    );
    await waitFor(() => {
      const svg = container.querySelector('svg.phenology-chart');
      expect(svg).not.toBeNull();
      // Either aria-label or aria-labelledby is acceptable.
      const hasLabel =
        svg!.hasAttribute('aria-label') || svg!.hasAttribute('aria-labelledby');
      expect(hasLabel).toBe(true);
    });
  });
});

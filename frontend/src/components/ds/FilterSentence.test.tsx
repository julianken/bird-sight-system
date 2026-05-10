import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { FilterSentence } from './FilterSentence.js';
import type { UrlState } from '../../state/url-state.js';

// Helper: build a minimal ActiveFilters shape from UrlState fields
function makeFilters(overrides: Partial<UrlState> = {}): UrlState {
  return {
    speciesCode: null,
    familyCode: null,
    since: '14d',
    notable: false,
    view: 'map',
    detail: null,
    ...overrides,
  };
}

describe('<FilterSentence>', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
  });

  // --- Zero filters → null ---

  it('renders null (nothing in the DOM) at zero filters', () => {
    const { container } = render(
      <FilterSentence filters={makeFilters()} />
    );
    // The visible sentence collapses; only the always-mounted live region remains
    expect(container.querySelector('.filter-sentence__visible')).not.toBeInTheDocument();
  });

  it('always mounts the hidden live region even at zero filters', () => {
    const { container } = render(
      <FilterSentence filters={makeFilters()} />
    );
    const liveRegion = container.querySelector('.filter-sentence-live');
    expect(liveRegion).toBeInTheDocument();
    expect(liveRegion).toHaveAttribute('role', 'status');
    expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    expect(liveRegion).toHaveAttribute('aria-atomic', 'true');
    expect(liveRegion).toHaveAttribute('aria-relevant', 'text');
  });

  // --- 1 filter ---

  it('renders "notable sightings" for notable=true, no family', () => {
    render(<FilterSentence filters={makeFilters({ notable: true })} />);
    expect(screen.getByText(/notable sightings/i)).toBeInTheDocument();
  });

  it('renders family filter term for familyCode without notable', () => {
    render(<FilterSentence filters={makeFilters({ familyCode: 'woodpeckers' })} />);
    expect(screen.getByText(/woodpeckers/i)).toBeInTheDocument();
  });

  // --- 2+ filters ---

  it('comma-joins multiple filter terms', () => {
    render(
      <FilterSentence
        filters={makeFilters({ notable: true, familyCode: 'woodpeckers' })}
      />
    );
    // Both terms appear in the sentence
    expect(screen.getByText(/notable sightings/i)).toBeInTheDocument();
    expect(screen.getByText(/woodpeckers/i)).toBeInTheDocument();
  });

  it('always includes the period clause when visible', () => {
    render(<FilterSentence filters={makeFilters({ notable: true })} />);
    // The period clause is always present: "from the last {period}"
    expect(screen.getByText(/from the last/i)).toBeInTheDocument();
  });

  // --- Debounce (500ms) ---

  it('live region does not update immediately on filter change (debounce)', () => {
    const { rerender } = render(
      <FilterSentence filters={makeFilters()} />
    );
    const liveRegion = document.querySelector('.filter-sentence-live');
    rerender(<FilterSentence filters={makeFilters({ notable: true })} />);

    // Before debounce settles, live region should not yet announce
    expect(liveRegion?.textContent).toBe('');
  });

  it('live region announces after 500ms debounce settles', () => {
    const { rerender } = render(
      <FilterSentence filters={makeFilters()} />
    );
    const liveRegion = document.querySelector('.filter-sentence-live');

    rerender(<FilterSentence filters={makeFilters({ notable: true })} />);

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(liveRegion?.textContent).toMatch(/notable sightings/i);
  });

  // --- Clear-hold (1500ms) ---

  it('holds "All filters cleared." in live region for 1500ms after filters go to zero', () => {
    const { rerender } = render(
      <FilterSentence filters={makeFilters({ notable: true })} />
    );
    const liveRegion = document.querySelector('.filter-sentence-live');

    // Settle the initial announcement
    act(() => { vi.advanceTimersByTime(500); });

    // Clear all filters
    rerender(<FilterSentence filters={makeFilters()} />);

    // Just before 1500ms, message is still held
    act(() => { vi.advanceTimersByTime(1499); });
    expect(liveRegion?.textContent).toBe('All filters cleared.');

    // After 1500ms, message clears
    act(() => { vi.advanceTimersByTime(1); });
    expect(liveRegion?.textContent).toBe('');
  });

  it('visible sentence collapses immediately on filter clear (not held)', () => {
    const { rerender } = render(
      <FilterSentence filters={makeFilters({ notable: true })} />
    );

    rerender(<FilterSentence filters={makeFilters()} />);

    // Visible sentence gone immediately
    expect(document.querySelector('.filter-sentence__visible')).not.toBeInTheDocument();
  });
});

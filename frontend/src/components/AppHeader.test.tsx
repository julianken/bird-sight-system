import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppHeader } from './AppHeader.js';

const baseProps = {
  region: 'Arizona' as string | null,
  filterCount: 0,
  onOpenFilters: vi.fn(),
  onOpenAttribution: vi.fn(),
};

describe('<AppHeader>', () => {
  it('renders the wordmark with the runtime region (#738/C5)', () => {
    render(<AppHeader {...baseProps} region="Arizona" />);
    const link = screen.getByRole('link', { name: /Bird Maps Arizona — home/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveTextContent(/Bird Maps · Arizona/);
  });

  it('threads the ?scope=us region "USA" into the wordmark', () => {
    render(<AppHeader {...baseProps} region="USA" />);
    const link = screen.getByRole('link', { name: /Bird Maps USA — home/i });
    expect(link).toHaveTextContent(/Bird Maps · USA/);
  });

  it('unscoped (region=null): wordmark is "Bird Maps" with no " · " separator', () => {
    render(<AppHeader {...baseProps} region={null} />);
    const link = screen.getByRole('link', { name: 'Bird Maps — home' });
    expect(link).toBeInTheDocument();
    // No bare separator and no region word in the visible text or aria-label.
    expect(link.textContent).toBe('Bird Maps');
    expect(link).not.toHaveTextContent('·');
    expect(link.getAttribute('aria-label')).toBe('Bird Maps — home');
  });

  // #800: Map nav removed (redundant — the map is the always-mounted sole surface
  // after F1 #777). No tablist/tab role must appear in the header.
  it('renders no tablist or tab role (#800 Map-nav removal)', () => {
    render(<AppHeader {...baseProps} />);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('renders no "Map" visible label or aria-controls="map-layer" tab (#800)', () => {
    const { container } = render(<AppHeader {...baseProps} />);
    // No element with aria-controls="map-layer" (the removed tab attribute).
    expect(container.querySelector('[aria-controls="map-layer"]')).toBeNull();
    // No button or element with visible text "Map" alone.
    expect(screen.queryByRole('tab', { name: /Map view/i })).toBeNull();
  });

  it('renders Filters trigger without badge when filterCount === 0', () => {
    render(<AppHeader {...baseProps} filterCount={0} />);
    const trigger = screen.getByRole('button', { name: /Filters/i });
    expect(trigger).toBeInTheDocument();
    expect(within(trigger).queryByText(/^[1-9]/)).toBeNull();
  });

  it('renders Filters trigger with numeric badge when filterCount > 0', () => {
    render(<AppHeader {...baseProps} filterCount={3} />);
    const trigger = screen.getByRole('button', { name: /Filters \(3 active\)/i });
    expect(within(trigger).getByText('3')).toBeInTheDocument();
    expect(within(trigger).getByText('3')).toHaveClass('app-header-filter-badge');
  });

  it('clicking the Filters trigger calls onOpenFilters', async () => {
    const onOpenFilters = vi.fn();
    render(<AppHeader {...baseProps} onOpenFilters={onOpenFilters} />);
    await userEvent.click(screen.getByRole('button', { name: /Filters/i }));
    expect(onOpenFilters).toHaveBeenCalledTimes(1);
  });

  it('clicking the Attribution link calls onOpenAttribution', async () => {
    const onOpenAttribution = vi.fn();
    render(<AppHeader {...baseProps} onOpenAttribution={onOpenAttribution} />);
    await userEvent.click(screen.getByRole('button', { name: /Credits & attribution/i }));
    expect(onOpenAttribution).toHaveBeenCalledTimes(1);
  });

  it('mounts the <ThemeToggle> in the right cluster', () => {
    render(<AppHeader {...baseProps} />);
    // Fix #459 W4-C: ThemeToggle now uses a static aria-label + aria-pressed.
    // The label no longer changes with theme state.
    expect(screen.getByRole('button', { name: /Toggle color theme/i })).toBeInTheDocument();
  });

  // #800 AC: floating header — the header element must have top > 0 (inset from
  // the viewport edge) so map pixels at y=0 are visible above it. We assert
  // the CSS class is present on the header element (the style rule sets
  // top: var(--space-md) which JSDOM doesn't compute, but the class association
  // is sufficient for the unit layer; the live viewport assertion is in the e2e).
  it('is a <header role="banner"> with class app-header (floating treatment applied via CSS)', () => {
    const { container } = render(<AppHeader {...baseProps} />);
    const header = container.querySelector('header.app-header');
    expect(header).not.toBeNull();
    expect(header!.getAttribute('role')).toBe('banner');
  });
});

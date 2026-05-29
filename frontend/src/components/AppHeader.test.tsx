import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppHeader } from './AppHeader.js';

const baseProps = {
  activeView: 'map' as const,
  onSelectView: vi.fn(),
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

  it('renders a single Map tab (Species + Feed removed per #688 / #662)', () => {
    render(<AppHeader {...baseProps} />);
    const tablist = screen.getByRole('tablist', { name: /Surface/i });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs).toHaveLength(1);
    expect(tabs[0].textContent).toBe('Map');
  });

  it('does not render a Feed tab (issue #662)', () => {
    render(<AppHeader {...baseProps} />);
    expect(screen.queryByRole('tab', { name: /Feed view/i })).toBeNull();
  });

  it('does not render a Species tab (issue #688)', () => {
    render(<AppHeader {...baseProps} />);
    expect(screen.queryByRole('tab', { name: /Species view/i })).toBeNull();
  });

  it('marks the Map tab as selected via aria-selected and is-active class', () => {
    render(<AppHeader {...baseProps} activeView="map" />);
    const mapTab = screen.getByRole('tab', { name: /Map view/i });
    expect(mapTab).toHaveAttribute('aria-selected', 'true');
    expect(mapTab).toHaveClass('app-header-tab', 'is-active');
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
});

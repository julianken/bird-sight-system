import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppHeader } from './AppHeader.js';

const baseProps = {
  activeView: 'map' as const,
  onSelectView: vi.fn(),
  filterCount: 0,
  onOpenFilters: vi.fn(),
  onOpenAttribution: vi.fn(),
};

describe('<AppHeader>', () => {
  it('renders the wordmark with REGION_LABEL', () => {
    render(<AppHeader {...baseProps} />);
    const link = screen.getByRole('link', { name: /Bird Maps Arizona — home/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveTextContent(/Bird Maps · Arizona/);
  });

  it('renders three tabs in stable order: Feed, Species, Map', () => {
    render(<AppHeader {...baseProps} />);
    const tablist = screen.getByRole('tablist', { name: /Surface/i });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs.map(t => t.textContent)).toEqual(['Feed', 'Species', 'Map']);
  });

  it('marks the active tab via aria-selected and is-active class', () => {
    render(<AppHeader {...baseProps} activeView="map" />);
    const mapTab = screen.getByRole('tab', { name: /Map view/i });
    expect(mapTab).toHaveAttribute('aria-selected', 'true');
    expect(mapTab).toHaveClass('app-header-tab', 'is-active');
  });

  it('clicking an inactive tab calls onSelectView with that view', async () => {
    const onSelectView = vi.fn();
    render(<AppHeader {...baseProps} onSelectView={onSelectView} activeView="map" />);
    await userEvent.click(screen.getByRole('tab', { name: /Feed view/i }));
    expect(onSelectView).toHaveBeenCalledWith('feed');
  });

  it('ArrowRight on a focused tab moves focus + activation to the next tab', async () => {
    const onSelectView = vi.fn();
    render(<AppHeader {...baseProps} onSelectView={onSelectView} activeView="feed" />);
    const feedTab = screen.getByRole('tab', { name: /Feed view/i });
    feedTab.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onSelectView).toHaveBeenCalledWith('species');
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
    // ThemeToggle from Phase 1 renders a button with aria-label like "Switch to dark theme"
    expect(screen.getByRole('button', { name: /Switch to (light|dark) theme/i })).toBeInTheDocument();
  });
});

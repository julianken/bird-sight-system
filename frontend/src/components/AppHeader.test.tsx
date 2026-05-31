import { describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppHeader } from './AppHeader.js';

const baseProps = {
  region: 'Arizona' as string | null,
  filterCount: 0,
  onOpenFilters: vi.fn(),
  // O4 (#780): filtersOpen drives aria-expanded on the trigger;
  // filtersTriggerRef is forwarded to the button for focus restoration.
  filtersOpen: false,
  filtersTriggerRef: createRef<HTMLButtonElement | null>(),
  onOpenAttribution: vi.fn(),
  ledeText: null as string | null,
  freshnessLabel: '',
  scope: { kind: 'unscoped' as const },
  states: [],
  onPickState: vi.fn(),
  onPickWholeUs: vi.fn(),
  onExitScope: vi.fn(),
  onResolveZip: vi.fn(),
};

describe('<AppHeader>', () => {
  // ── Wordmark ────────────────────────────────────────────────────────────

  it('renders the wordmark as a home link (#738/C5)', () => {
    render(<AppHeader {...baseProps} region="Arizona" />);
    const link = screen.getByRole('link', { name: /Bird Maps Arizona — home/i });
    expect(link).toBeInTheDocument();
  });

  it('unscoped (region=null): wordmark is "Bird Maps" with no " · " separator', () => {
    render(<AppHeader {...baseProps} region={null} />);
    const link = screen.getByRole('link', { name: 'Bird Maps — home' });
    expect(link).toBeInTheDocument();
    expect(link).not.toHaveTextContent('·');
    expect(link.getAttribute('aria-label')).toBe('Bird Maps — home');
  });

  it('threads the ?scope=us region "USA" into the wordmark', () => {
    render(<AppHeader {...baseProps} region="USA" />);
    expect(screen.getByRole('link', { name: /Bird Maps USA — home/i })).toBeInTheDocument();
  });

  // ── No tablist / Map nav ────────────────────────────────────────────────
  // The "Map" tab and role="tablist" were removed in #800. The map is the
  // always-mounted sole surface — a navigation tab adds no value and creates
  // a dead center in the old bar.

  it('does NOT render a tablist or any tab roles (#800)', () => {
    render(<AppHeader {...baseProps} />);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('does NOT render a "Map" tab label (#800)', () => {
    render(<AppHeader {...baseProps} />);
    expect(screen.queryByRole('tab', { name: /Map view/i })).toBeNull();
    expect(screen.queryByText(/^Map$/, { selector: 'button' })).toBeNull();
  });

  // ── Two floating cards ──────────────────────────────────────────────────

  it('renders the identity card and controls pill', () => {
    render(<AppHeader {...baseProps} />);
    expect(document.querySelector('.app-header-identity-card')).not.toBeNull();
    expect(document.querySelector('.app-header-controls-pill')).not.toBeNull();
  });

  // ── Lede (O3 #779) ─────────────────────────────────────────────────────

  it('renders the lede text when ledeText is provided', () => {
    render(
      <AppHeader
        {...baseProps}
        ledeText="331 species seen across Arizona in the last 14 days."
      />,
    );
    expect(
      screen.getByText('331 species seen across Arizona in the last 14 days.'),
    ).toBeInTheDocument();
  });

  it('does NOT render a lede row when ledeText is null', () => {
    render(<AppHeader {...baseProps} ledeText={null} />);
    expect(document.querySelector('.app-header-lede-row')).toBeNull();
  });

  it('renders freshnessLabel alongside the lede when both are present', () => {
    render(
      <AppHeader
        {...baseProps}
        ledeText="331 species seen across Arizona in the last 14 days."
        freshnessLabel="Updated 11 min ago · Source: eBird"
      />,
    );
    expect(screen.getByText('Updated 11 min ago · Source: eBird')).toBeInTheDocument();
  });

  // ── Scope rows ──────────────────────────────────────────────────────────

  it('renders scope rows + divider when scope is active (state)', () => {
    render(
      <AppHeader
        {...baseProps}
        scope={{ kind: 'state', stateCode: 'US-AZ' }}
        states={[{ stateCode: 'US-AZ', name: 'Arizona', bbox: [-114.82, 31.33, -109.05, 37.0] }]}
      />,
    );
    expect(document.querySelector('.app-header-divider')).not.toBeNull();
    expect(document.querySelector('.app-header-scope-rows')).not.toBeNull();
  });

  it('does NOT render scope rows on the unscoped landing', () => {
    render(<AppHeader {...baseProps} scope={{ kind: 'unscoped' }} />);
    expect(document.querySelector('.app-header-divider')).toBeNull();
    expect(document.querySelector('.app-header-scope-rows')).toBeNull();
  });

  // ── Filters trigger ─────────────────────────────────────────────────────

  it('renders Filters trigger without badge when filterCount === 0', () => {
    render(<AppHeader {...baseProps} filterCount={0} />);
    const trigger = screen.getByRole('button', { name: /^Filters$/i });
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

  // ── Attribution ─────────────────────────────────────────────────────────

  it('clicking the Attribution link calls onOpenAttribution', async () => {
    const onOpenAttribution = vi.fn();
    render(<AppHeader {...baseProps} onOpenAttribution={onOpenAttribution} />);
    await userEvent.click(screen.getByRole('button', { name: /Credits & attribution/i }));
    expect(onOpenAttribution).toHaveBeenCalledTimes(1);
  });

  // ── ThemeToggle ─────────────────────────────────────────────────────────

  it('mounts the <ThemeToggle> in the controls pill', () => {
    render(<AppHeader {...baseProps} />);
    expect(screen.getByRole('button', { name: /Toggle color theme/i })).toBeInTheDocument();
  });

  // ── role="banner" landmark ───────────────────────────────────────────────

  it('wraps both clusters in exactly ONE role="banner" landmark', () => {
    render(<AppHeader {...baseProps} />);
    const banners = screen.getAllByRole('banner');
    expect(banners).toHaveLength(1);
  });
});

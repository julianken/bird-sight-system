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
  filtersTriggerRef: createRef<HTMLButtonElement>(),
  onOpenAttribution: vi.fn(),
  ledeText: null as string | null,
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

  // ── Region a11y: single sr-only <h1>, visible region in the wordmark (#828) ──

  it('renders the visible region in the wordmark line (· {region}) at all breakpoints', () => {
    render(<AppHeader {...baseProps} region="Arizona" />);
    const brandRegion = document.querySelector('.brand-region');
    expect(brandRegion).not.toBeNull();
    expect(brandRegion).toHaveTextContent('Arizona');
  });

  it('keeps exactly one <h1> and renders it visually hidden (sr-only) (#828)', () => {
    render(<AppHeader {...baseProps} region="Arizona" />);
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    // The region <h1> is preserved for heading structure but visually hidden at
    // every breakpoint (the visible region rides in the wordmark line).
    expect(h1s[0]).toHaveClass('sr-only');
    expect(h1s[0]).toHaveTextContent('Arizona');
  });

  it('omits the <h1> on the unscoped landing (region=null)', () => {
    render(<AppHeader {...baseProps} region={null} />);
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('keeps the role="status" scope announcement (region still announced — no regression)', () => {
    render(<AppHeader {...baseProps} region="Arizona" />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Showing Arizona.');
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

  // ── Lede (O3 #779 / #828 count-only) ────────────────────────────────────

  it('renders the count-only lede text when ledeText is provided (#828)', () => {
    render(<AppHeader {...baseProps} ledeText="331 species" />);
    expect(screen.getByText('331 species')).toBeInTheDocument();
  });

  it('does NOT render a lede row when ledeText is null', () => {
    render(<AppHeader {...baseProps} ledeText={null} />);
    expect(document.querySelector('.app-header-lede-row')).toBeNull();
  });

  // #828: the freshness line is removed entirely — no freshnessLabel prop, no
  // `.app-header-freshness` element. The always-visible eBird/OpenFreeMap credit
  // moved to the bottom-right .map-attribution corner (restored under #828's
  // Option-A rebase over #830); recency is not worth a permanent line on a
  // minimized card. (The bottom-right attribution lives in App, not AppHeader,
  // so it is asserted in App.test.tsx, not here.)
  it('does NOT render any freshness line (#828 — freshness removed)', () => {
    render(<AppHeader {...baseProps} ledeText="331 species" />);
    expect(document.querySelector('.app-header-freshness')).toBeNull();
    expect(screen.queryByText(/Source: eBird/i)).toBeNull();
    expect(screen.queryByText(/Updated .* ago/i)).toBeNull();
  });

  // ── Scope disclosure (#828) ──────────────────────────────────────────────
  // The scope form collapses behind a 🔍 disclosure on the wordmark row. The
  // form is MOUNTED but CSS-hidden when collapsed (an always-present aria-controls
  // target); tapping the trigger reveals it in place. ✕ / Esc collapses.

  const stateProps = {
    scope: { kind: 'state' as const, stateCode: 'US-AZ' },
    states: [{ stateCode: 'US-AZ', name: 'Arizona', bbox: [-114.82, 31.33, -109.05, 37.0] as [number, number, number, number] }],
  };

  it('renders a scope disclosure trigger (collapsed) when scope is active', () => {
    render(<AppHeader {...baseProps} {...stateProps} />);
    const trigger = screen.getByRole('button', { name: /change region/i });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('does NOT render the scope disclosure trigger on the unscoped landing', () => {
    render(<AppHeader {...baseProps} scope={{ kind: 'unscoped' }} />);
    expect(screen.queryByRole('button', { name: /change region/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /scope options/i })).toBeNull();
  });

  it('scope form is collapsed by default (aria-expanded=false; no divider visible)', () => {
    render(<AppHeader {...baseProps} {...stateProps} />);
    // The scope rows container is mounted (always-present aria-controls target)…
    const rows = document.querySelector('.app-header-scope-rows');
    expect(rows).not.toBeNull();
    // …but marked closed via data-open=false (CSS hides it when collapsed).
    expect(rows).toHaveAttribute('data-open', 'false');
    // The divider only renders when expanded — resting card is two lines.
    expect(document.querySelector('.app-header-divider')).toBeNull();
  });

  it('clicking 🔍 expands the scope form in place (aria-expanded → true; divider appears)', async () => {
    render(<AppHeader {...baseProps} {...stateProps} />);
    const trigger = screen.getByRole('button', { name: /change region/i });
    await userEvent.click(trigger);
    // The trigger now reflects the expanded state and its accessible name flips.
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /scope options/i })).toBe(trigger);
    expect(document.querySelector('.app-header-scope-rows')).toHaveAttribute('data-open', 'true');
    expect(document.querySelector('.app-header-divider')).not.toBeNull();
  });

  it('trigger aria-controls points at the mounted scope rows region', () => {
    render(<AppHeader {...baseProps} {...stateProps} />);
    const trigger = screen.getByRole('button', { name: /change region/i });
    const controls = trigger.getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    // The IDREF resolves to a present element (valid aria-controls — the form is
    // mounted-but-hidden, unlike the conditionally-rendered Filters dialog).
    expect(document.getElementById(controls!)).not.toBeNull();
    expect(document.getElementById(controls!)).toHaveClass('app-header-scope-rows');
  });

  it('opening the disclosure moves focus to the first field (the state <select>)', async () => {
    render(<AppHeader {...baseProps} {...stateProps} />);
    await userEvent.click(screen.getByRole('button', { name: /change region/i }));
    const select = screen.getByRole('combobox', { name: /switch state/i });
    expect(document.activeElement).toBe(select);
  });

  it('Esc collapses the disclosure and restores focus to the trigger', async () => {
    render(<AppHeader {...baseProps} {...stateProps} />);
    const trigger = screen.getByRole('button', { name: /change region/i });
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    // Esc from within the form collapses + restores focus to the trigger.
    await userEvent.keyboard('{Escape}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(trigger);
  });

  it('does NOT close on an outside click (a stray click must not discard a half-typed ZIP)', async () => {
    render(
      <div>
        <AppHeader {...baseProps} {...stateProps} />
        <button type="button">outside</button>
      </div>,
    );
    const trigger = screen.getByRole('button', { name: /change region/i });
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    // Click an element entirely outside the card — the disclosure stays open.
    await userEvent.click(screen.getByRole('button', { name: 'outside' }));
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(document.querySelector('.app-header-scope-rows')).toHaveAttribute('data-open', 'true');
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

  it('marks the Attribution trigger with aria-haspopup="dialog" (and intentionally omits aria-expanded)', () => {
    // #830 item E: the trigger opens a showModal() dialog (top-layer), not an
    // inline disclosure — so it carries aria-haspopup but deliberately NOT
    // aria-expanded (a divergence from the Filters trigger, which is inline).
    render(<AppHeader {...baseProps} />);
    const trigger = screen.getByRole('button', { name: /Credits & attribution/i });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).not.toHaveAttribute('aria-expanded');
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

import { describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppHeader } from './AppHeader.js';

const baseProps = {
  region: 'Arizona' as string | null,
  filterCount: 0,
  onOpenFilters: vi.fn(),
  // C8 (#1220): AppHeader closes the Filters panel to enforce the single-header-
  // popover invariant (opening scope/theme closes filters).
  onCloseFilters: vi.fn(),
  // O4 (#780): filtersOpen drives aria-expanded on the trigger;
  // filtersTriggerRef is forwarded to the button for focus restoration.
  filtersOpen: false,
  // E5 (#1057): detail-open signal (App derives it from `?detail=` presence).
  // Drives the scope-disclosure auto-collapse so at most one expanded surface
  // is up at a time (spec §5.1 COMPACT).
  detailOpen: false,
  filtersTriggerRef: createRef<HTMLButtonElement>(),
  onOpenAttribution: vi.fn(),
  ledeText: null as string | null,
  scope: { kind: 'unscoped' as const },
  states: [],
  onPickState: vi.fn(),
  onPickWholeUs: vi.fn(),
  onExitScope: vi.fn(),
  onResolveZip: vi.fn(),
  // C8 (#1220): theme-selector props. The selector is a single icon→popover at
  // every breakpoint — at rest only the trigger renders (no radiogroup until the
  // icon is clicked). AppHeader owns the popover open-state to coordinate it with
  // the scope disclosure + Filters panel (single-header-popover invariant).
  activeThemeId: 'positron' as const,
  onSelectTheme: vi.fn(),
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

  it('clips the form during the reveal (data-opening), then releases it on the opacity transitionend', async () => {
    // The clip-wipe accordion: while opening, the clip carries data-opening so
    // styles.css keeps the form clipped by the growing card edge (overflow:hidden
    // + the ±4px ring-room widen). The flag clears on the reveal's opacity
    // transitionend so overflow returns to visible at rest and the auto-focused
    // field's ring paints unclipped (#1063). Driven deterministically here — no
    // timing — by firing the transitionend the open-edge effect listens for.
    render(<AppHeader {...baseProps} {...stateProps} />);
    await userEvent.click(screen.getByRole('button', { name: /change region/i }));
    const clip = document.querySelector('.app-header-scope-clip');
    expect(clip).toHaveAttribute('data-opening', 'true');

    const rows = document.querySelector('.app-header-scope-rows')!;
    fireEvent.transitionEnd(rows, { propertyName: 'opacity' });
    expect(clip).toHaveAttribute('data-opening', 'false');
  });

  it('skips the clip-wipe under prefers-reduced-motion (no data-opening, ring stays unclipped)', async () => {
    // Under reduced-motion the wipe is zeroed (the card jumps open), so there is
    // no growing edge to clip against — the open-edge effect must NOT set
    // data-opening, else the 800ms backstop would hold overflow:hidden and clip
    // the auto-focused field's focus ring (#1063). jsdom leaves matchMedia
    // undefined (the other tests exercise the animated path), so stub it here.
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: /prefers-reduced-motion/.test(q),
      media: q,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    try {
      render(<AppHeader {...baseProps} {...stateProps} />);
      await userEvent.click(screen.getByRole('button', { name: /change region/i }));
      expect(document.querySelector('.app-header-scope-clip')).toHaveAttribute('data-opening', 'false');
    } finally {
      vi.unstubAllGlobals();
    }
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

  // ── Scope-disclosure auto-collapse (E5 #1057) ────────────────────────────
  // Spec §5.1 COMPACT: at most one expanded surface. The disclosure collapses
  // when another surface takes over (Filters opens, a detail sheet opens) or
  // when a state selection commits. The deliberate no-click-outside rule is
  // PRESERVED (a Filters tap is a different intent than a stray map click).

  it('collapses the disclosure on the RISING edge of filtersOpen (#1057)', async () => {
    const { rerender } = render(<AppHeader {...baseProps} {...stateProps} filtersOpen={false} />);
    const trigger = screen.getByRole('button', { name: /change region/i });
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    // Filters opens (e.g. a Filters tap) → the scope disclosure collapses so the
    // two surfaces are never up simultaneously.
    rerender(<AppHeader {...baseProps} {...stateProps} filtersOpen={true} />);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('.app-header-scope-rows')).toHaveAttribute('data-open', 'false');
  });

  it('does NOT slam shut a fresh re-open while filtersOpen stays true (rising edge only) (#1057)', async () => {
    // Only the rising edge collapses. Once filtersOpen is already true, the user
    // can re-open the disclosure (e.g. Filters got dismissed then re-tapped, or
    // the user deliberately re-opens scope) without it being yanked shut on the
    // next unrelated re-render.
    const { rerender } = render(<AppHeader {...baseProps} {...stateProps} filtersOpen={true} />);
    const trigger = screen.getByRole('button', { name: /change region/i });
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    // An unrelated re-render with filtersOpen STILL true must not collapse it.
    rerender(<AppHeader {...baseProps} {...stateProps} filtersOpen={true} filterCount={2} />);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('collapses the disclosure on the RISING edge of detailOpen (#1057)', async () => {
    const { rerender } = render(<AppHeader {...baseProps} {...stateProps} detailOpen={false} />);
    const trigger = screen.getByRole('button', { name: /change region/i });
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    // A detail sheet/rail opens (?detail= appears) → the scope disclosure collapses.
    rerender(<AppHeader {...baseProps} {...stateProps} detailOpen={true} />);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('.app-header-scope-rows')).toHaveAttribute('data-open', 'false');
  });

  it('collapses the disclosure after a successful state selection (onPickState) (#1057)', async () => {
    const onPickState = vi.fn();
    render(<AppHeader {...baseProps} {...stateProps} onPickState={onPickState} />);
    const trigger = screen.getByRole('button', { name: /change region/i });
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    // Stage a different state and commit via Go (the #1035 explicit-commit path).
    // Scope the Go button to the state form (the ZipInput also renders a "Go").
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /switch state/i }),
      'US-AZ',
    );
    const stateGo = document.querySelector<HTMLButtonElement>('.scope-control__go')!;
    await userEvent.click(stateGo);

    // The commit still flows to the parent…
    expect(onPickState).toHaveBeenCalledWith('US-AZ');
    // …and the disclosure collapses (the commit is the user's "done" signal).
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('.app-header-scope-rows')).toHaveAttribute('data-open', 'false');
  });

  it('renders exactly one middot in the wordmark — the brand-region carries no literal "·" text node (#1057)', () => {
    // The separator is painted via `.brand-region::before` (CSS), so the JSX
    // text node must NOT also carry a literal "· " (else the dot doubles). The
    // visible "·" comes from CSS content, invisible to textContent.
    render(<AppHeader {...baseProps} region="Arizona" />);
    const brandRegion = document.querySelector('.brand-region')!;
    // The DOM text node is just the region name — no literal middot.
    expect(brandRegion.textContent).toBe('Arizona');
    expect(brandRegion.textContent).not.toContain('·');
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
    // #1033 V1: attribution demoted to icon-only; label shortened to "Credits"
    await userEvent.click(screen.getByRole('button', { name: /^Credits$/i }));
    expect(onOpenAttribution).toHaveBeenCalledTimes(1);
  });

  it('marks the Attribution trigger with aria-haspopup="dialog" (and intentionally omits aria-expanded)', () => {
    // #830 item E: the trigger opens a showModal() dialog (top-layer), not an
    // inline disclosure — so it carries aria-haspopup but deliberately NOT
    // aria-expanded (a divergence from the Filters trigger, which is inline).
    render(<AppHeader {...baseProps} />);
    // #1033 V1/V18: attribution label shortened to "Credits"
    const trigger = screen.getByRole('button', { name: /^Credits$/i });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).not.toHaveAttribute('aria-expanded');
  });

  // ── Controls order (V1/V18 #1033): Filters · ⓘ Credits · ThemeSelector ────

  it('controls pill orders Filters first, then Credits (ⓘ), then the theme selector (#1033 V1/V18, C8 #1220)', () => {
    render(<AppHeader {...baseProps} />);
    const pill = document.querySelector('.app-header-controls-pill')!;
    // The two leading icon buttons are Filters then Credits; the theme selector
    // (a single icon trigger at rest) follows.
    expect(pill.querySelector('.app-header-filters')).not.toBeNull();
    expect(pill.querySelector('.app-header-attribution')).not.toBeNull();
    const filters = pill.querySelector('.app-header-filters')!;
    const credits = pill.querySelector('.app-header-attribution')!;
    const selector = pill.querySelector('.theme-selector')!;
    expect(selector).not.toBeNull();
    // DOM order: Filters before Credits before the theme selector.
    expect(filters.compareDocumentPosition(credits) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(credits.compareDocumentPosition(selector) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // ── ThemeSelector (C8 #1220 icon→popover) ─────────────────────────────────

  it('renders the <ThemeSelector> as a single icon trigger at rest (no radiogroup until opened)', () => {
    render(<AppHeader {...baseProps} />);
    // The icon trigger is in the controls pill; the radiogroup is not mounted yet.
    expect(screen.getByRole('button', { name: /^Map theme:/ })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Map theme' })).toBeNull();
  });

  it('clicking the theme icon opens the popover with 5 options, the active one checked', async () => {
    render(<AppHeader {...baseProps} />);
    await userEvent.click(screen.getByRole('button', { name: /^Map theme:/ }));
    const group = screen.getByRole('radiogroup', { name: 'Map theme' });
    expect(within(group).getAllByRole('radio')).toHaveLength(5);
    expect(screen.getByRole('radio', { name: 'Positron' })).toHaveAttribute('aria-checked', 'true');
  });

  // ── Single-header-popover coordination (C8 #1220) ─────────────────────────
  // Only one of {scope disclosure, Filters panel, theme popover} may be open at
  // a time — opening any one closes the others (no overlapping header surfaces).

  it('opening the theme popover closes an open scope disclosure (no two header popovers open)', async () => {
    render(<AppHeader {...baseProps} {...stateProps} />);
    const scopeTrigger = screen.getByRole('button', { name: /change region/i });
    await userEvent.click(scopeTrigger);
    expect(scopeTrigger).toHaveAttribute('aria-expanded', 'true');

    // Now open the theme popover — the scope disclosure must collapse.
    await userEvent.click(screen.getByRole('button', { name: /^Map theme:/ }));
    expect(screen.getByRole('radiogroup', { name: 'Map theme' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /change region/i })).toHaveAttribute('aria-expanded', 'false');
  });

  it('opening the scope disclosure closes an open theme popover', async () => {
    render(<AppHeader {...baseProps} {...stateProps} />);
    const themeTrigger = screen.getByRole('button', { name: /^Map theme:/ });
    await userEvent.click(themeTrigger);
    expect(themeTrigger).toHaveAttribute('aria-expanded', 'true');

    // Open the scope disclosure — the theme popover must collapse. After opening,
    // the scope trigger's accessible name flips to "Close scope options", so use
    // the stable either-name matcher.
    await userEvent.click(screen.getByRole('button', { name: /change region/i }));
    expect(
      screen.getByRole('button', { name: /change region|close scope options/i }),
    ).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /^Map theme:/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('opening the theme popover closes an open Filters panel (onCloseFilters fired)', async () => {
    const onCloseFilters = vi.fn();
    render(<AppHeader {...baseProps} {...stateProps} filtersOpen={true} onCloseFilters={onCloseFilters} />);
    await userEvent.click(screen.getByRole('button', { name: /^Map theme:/ }));
    expect(onCloseFilters).toHaveBeenCalled();
  });

  it('clicking Filters closes an open theme popover (and an open scope disclosure)', async () => {
    render(<AppHeader {...baseProps} {...stateProps} />);
    const themeTrigger = screen.getByRole('button', { name: /^Map theme:/ });
    await userEvent.click(themeTrigger);
    expect(themeTrigger).toHaveAttribute('aria-expanded', 'true');

    // Clicking the Filters trigger closes the theme popover (App opens the panel).
    await userEvent.click(screen.getByRole('button', { name: /^Filters/i }));
    expect(screen.getByRole('button', { name: /^Map theme:/ })).toHaveAttribute('aria-expanded', 'false');
  });

  // ── role="banner" landmark ───────────────────────────────────────────────

  it('wraps both clusters in exactly ONE role="banner" landmark', () => {
    render(<AppHeader {...baseProps} />);
    const banners = screen.getAllByRole('banner');
    expect(banners).toHaveLength(1);
  });
});

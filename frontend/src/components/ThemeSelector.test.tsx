import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeSelector } from './ThemeSelector.js';
import { THEME_REGISTRY, type ThemeId } from '@/components/map/geometry/basemap-style.js';
import { THEME_STORAGE_KEY } from '../utils/boot-theme.js';

/**
 * ThemeSelector unit tests (C8 · #1220). The selector is the user-facing control
 * for all 5 themes: selecting one calls `applyTheme(id)` (writes [data-theme] +
 * persists) AND `onSelect(id)` (drives the id-keyed basemap swap). It exposes ONE
 * `role="radiogroup"` in BOTH responsive forms; the active option is aria-checked.
 */

const ALL_IDS = Object.keys(THEME_REGISTRY) as ThemeId[];

describe('<ThemeSelector>', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });
  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('renders all 5 themes as a single role="radiogroup" (wide/segmented form)', () => {
    render(<ThemeSelector activeThemeId="positron" onSelect={vi.fn()} bp="wide" />);
    const group = screen.getByRole('radiogroup', { name: 'Map theme' });
    expect(group).toHaveAttribute('data-form', 'segmented');
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(5);
    expect(radios.map((r) => r.textContent)).toEqual([
      'Positron', 'Bright', 'Liberty', 'Dark', 'Fiord',
    ]);
  });

  it('marks the active option aria-checked and gives it the only tabbable index (roving tabindex)', () => {
    render(<ThemeSelector activeThemeId="liberty" onSelect={vi.fn()} bp="wide" />);
    const active = screen.getByRole('radio', { name: 'Liberty' });
    expect(active).toHaveAttribute('aria-checked', 'true');
    expect(active).toHaveAttribute('tabindex', '0');
    // Every other radio is aria-checked=false and removed from the tab order.
    for (const label of ['Positron', 'Bright', 'Dark', 'Fiord']) {
      const r = screen.getByRole('radio', { name: label });
      expect(r).toHaveAttribute('aria-checked', 'false');
      expect(r).toHaveAttribute('tabindex', '-1');
    }
  });

  it('selecting a theme calls applyTheme (persists id + writes [data-theme]) AND onSelect with the right id', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ThemeSelector activeThemeId="positron" onSelect={onSelect} bp="wide" />);

    await user.click(screen.getByRole('radio', { name: 'Bright' }));

    // onSelect drives the id-keyed swap.
    expect(onSelect).toHaveBeenCalledWith('bright');
    // applyTheme persisted the id and derived [data-theme] from its kind (light).
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('bright');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('selecting a DARK-kind theme derives [data-theme]=dark (chrome follows kind)', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ThemeSelector activeThemeId="positron" onSelect={onSelect} bp="wide" />);

    await user.click(screen.getByRole('radio', { name: 'Fiord' }));

    expect(onSelect).toHaveBeenCalledWith('fiord');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('fiord');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('each of the 5 themes calls onSelect with its own id (incl. same-kind options)', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ThemeSelector activeThemeId="positron" onSelect={onSelect} bp="wide" />);

    for (const id of ALL_IDS) {
      await user.click(screen.getByRole('radio', { name: THEME_REGISTRY[id].id.replace(/^./, (c) => c.toUpperCase()) }));
    }
    const calledIds = onSelect.mock.calls.map((c) => c[0]);
    expect(calledIds).toEqual(ALL_IDS); // positron, bright, liberty, dark, fiord
  });

  it('arrow keys move + select (selection-follows-focus, wrapping)', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ThemeSelector activeThemeId="positron" onSelect={onSelect} bp="wide" />);

    const positron = screen.getByRole('radio', { name: 'Positron' });
    positron.focus();
    await user.keyboard('{ArrowRight}'); // → Bright
    expect(onSelect).toHaveBeenLastCalledWith('bright');

    // From the first option, ArrowLeft wraps to the last (Fiord).
    positron.focus();
    await user.keyboard('{ArrowLeft}');
    expect(onSelect).toHaveBeenLastCalledWith('fiord');
  });

  it('Home/End jump to first/last option', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ThemeSelector activeThemeId="liberty" onSelect={onSelect} bp="wide" />);

    const active = screen.getByRole('radio', { name: 'Liberty' });
    active.focus();
    await user.keyboard('{End}');
    expect(onSelect).toHaveBeenLastCalledWith('fiord');
    screen.getByRole('radio', { name: 'Liberty' }).focus();
    await user.keyboard('{Home}');
    expect(onSelect).toHaveBeenLastCalledWith('positron');
  });

  // ── Narrow form: trigger + transient popover (same radiogroup) ──────────────

  it('collapses to a trigger + popover at non-wide breakpoints, exposing the SAME radiogroup', async () => {
    const user = userEvent.setup();
    render(<ThemeSelector activeThemeId="dark" onSelect={vi.fn()} bp="compact" />);

    // At rest the radiogroup is NOT mounted — only the disclosure trigger.
    expect(screen.queryByRole('radiogroup')).toBeNull();
    const trigger = screen.getByRole('button', { name: /^Map theme:/ });
    expect(trigger).toHaveAttribute('aria-haspopup', 'true');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const group = screen.getByRole('radiogroup', { name: 'Map theme' });
    expect(group).toHaveAttribute('data-form', 'popover');
    expect(within(group).getAllByRole('radio')).toHaveLength(5);
    // aria-controls points at the popover radiogroup.
    expect(trigger.getAttribute('aria-controls')).toBe(group.id);
  });

  it('roomy breakpoint also uses the trigger + popover form', () => {
    render(<ThemeSelector activeThemeId="positron" onSelect={vi.fn()} bp="roomy" />);
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.getByRole('button', { name: /^Map theme:/ })).toBeInTheDocument();
  });

  it('Esc closes the popover and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<ThemeSelector activeThemeId="positron" onSelect={vi.fn()} bp="compact" />);
    const trigger = screen.getByRole('button', { name: /^Map theme:/ });
    await user.click(trigger);
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(trigger).toHaveFocus();
  });
});

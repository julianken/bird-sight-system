import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeSelector } from './ThemeSelector.js';
import { THEME_REGISTRY, type ThemeId } from '@/components/map/geometry/basemap-style.js';
import { THEME_STORAGE_KEY } from '../utils/boot-theme.js';

/**
 * ThemeSelector unit tests (C8 · #1220, icon→popover rework). The selector is now
 * a SINGLE icon trigger at every breakpoint: clicking it opens a popover holding
 * one `role="radiogroup"`; selecting a theme calls `applyTheme(id)` (writes
 * [data-theme] + persists) AND `onSelect(id)` (drives the id-keyed basemap swap)
 * AND closes the popover. Esc and outside-click also close it.
 *
 * `open` is controlled by the parent, so a tiny <Harness> wires `open` +
 * `onOpenChange` to local state to exercise the real open/close behaviour.
 */

const ALL_IDS = Object.keys(THEME_REGISTRY) as ThemeId[];

/** Controlled-open harness mirroring AppHeader's ownership of the popover state. */
function Harness({
  activeThemeId = 'positron' as ThemeId,
  onSelect = vi.fn(),
  initialOpen = false,
}: {
  activeThemeId?: ThemeId;
  onSelect?: (id: ThemeId) => void;
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <ThemeSelector
      activeThemeId={activeThemeId}
      onSelect={onSelect}
      open={open}
      onOpenChange={setOpen}
    />
  );
}

describe('<ThemeSelector>', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });
  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('renders a single icon trigger at rest — the radiogroup is NOT mounted until opened', () => {
    render(<Harness activeThemeId="dark" />);
    expect(screen.queryByRole('radiogroup')).toBeNull();
    const trigger = screen.getByRole('button', { name: /^Map theme:/ });
    expect(trigger).toHaveAttribute('aria-haspopup', 'true');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    // The trigger's accessible name names the active theme.
    expect(trigger).toHaveAccessibleName('Map theme: Dark');
  });

  it('clicking the icon opens the popover (aria-expanded true) with all 5 themes as one role="radiogroup"', async () => {
    const user = userEvent.setup();
    render(<Harness activeThemeId="positron" />);

    const trigger = screen.getByRole('button', { name: /^Map theme:/ });
    await user.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const group = screen.getByRole('radiogroup', { name: 'Map theme' });
    expect(group).toHaveAttribute('data-form', 'popover');
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(5);
    expect(radios.map((r) => r.textContent)).toEqual([
      'Positron', 'Bright', 'Liberty', 'Dark', 'Fiord',
    ]);
    // aria-controls points at the popover radiogroup.
    expect(trigger.getAttribute('aria-controls')).toBe(group.id);
  });

  it('marks the active option aria-checked and gives it the only tabbable index (roving tabindex)', async () => {
    const user = userEvent.setup();
    render(<Harness activeThemeId="liberty" />);
    await user.click(screen.getByRole('button', { name: /^Map theme:/ }));

    const active = screen.getByRole('radio', { name: 'Liberty' });
    expect(active).toHaveAttribute('aria-checked', 'true');
    expect(active).toHaveAttribute('tabindex', '0');
    for (const label of ['Positron', 'Bright', 'Dark', 'Fiord']) {
      const r = screen.getByRole('radio', { name: label });
      expect(r).toHaveAttribute('aria-checked', 'false');
      expect(r).toHaveAttribute('tabindex', '-1');
    }
  });

  it('selecting a theme calls applyTheme (persists id + writes [data-theme]) AND onSelect AND CLOSES the popover', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness activeThemeId="positron" onSelect={onSelect} />);

    const trigger = screen.getByRole('button', { name: /^Map theme:/ });
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    await user.click(screen.getByRole('radio', { name: 'Bright' }));

    // onSelect drives the id-keyed swap.
    expect(onSelect).toHaveBeenCalledWith('bright');
    // applyTheme persisted the id and derived [data-theme] from its kind (light).
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('bright');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    // Selecting CLOSES the popover (aria-expanded flips immediately) and returns
    // focus to the trigger. The surface unmounts after the close animation.
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
    await waitFor(() => expect(screen.queryByRole('radiogroup')).toBeNull());
  });

  it('selecting a DARK-kind theme derives [data-theme]=dark (chrome follows kind)', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness activeThemeId="positron" onSelect={onSelect} />);

    await user.click(screen.getByRole('button', { name: /^Map theme:/ }));
    await user.click(screen.getByRole('radio', { name: 'Fiord' }));

    expect(onSelect).toHaveBeenCalledWith('fiord');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('fiord');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('each of the 5 themes calls onSelect with its own id (incl. same-kind options)', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness activeThemeId="positron" onSelect={onSelect} />);
    const trigger = screen.getByRole('button', { name: /^Map theme:/ });

    for (const id of ALL_IDS) {
      // Selecting closes the popover, so re-open before each pick. Wait for the
      // group to be present (the prior close animation may still be unmounting).
      await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
      await user.click(trigger);
      const label = THEME_REGISTRY[id].id.replace(/^./, (c) => c.toUpperCase());
      const group = await screen.findByRole('radiogroup', { name: 'Map theme' });
      await user.click(within(group).getByRole('radio', { name: label, exact: true }));
    }
    const calledIds = onSelect.mock.calls.map((c) => c[0]);
    expect(calledIds).toEqual(ALL_IDS); // positron, bright, liberty, dark, fiord
  });

  it('arrow keys move + select (selection-follows-focus, wrapping) WITHOUT closing the popover', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness activeThemeId="positron" onSelect={onSelect} />);
    const trigger = screen.getByRole('button', { name: /^Map theme:/ });
    await user.click(trigger);

    const positron = screen.getByRole('radio', { name: 'Positron' });
    positron.focus();
    await user.keyboard('{ArrowRight}'); // → Bright
    expect(onSelect).toHaveBeenLastCalledWith('bright');
    // Arrow nav previews but keeps the popover open.
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    // From the first option, ArrowLeft wraps to the last (Fiord).
    screen.getByRole('radio', { name: 'Positron' }).focus();
    await user.keyboard('{ArrowLeft}');
    expect(onSelect).toHaveBeenLastCalledWith('fiord');
  });

  it('Home/End jump to first/last option', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness activeThemeId="liberty" onSelect={onSelect} />);
    await user.click(screen.getByRole('button', { name: /^Map theme:/ }));

    const active = screen.getByRole('radio', { name: 'Liberty' });
    active.focus();
    await user.keyboard('{End}');
    expect(onSelect).toHaveBeenLastCalledWith('fiord');
    screen.getByRole('radio', { name: 'Liberty' }).focus();
    await user.keyboard('{Home}');
    expect(onSelect).toHaveBeenLastCalledWith('positron');
  });

  it('Esc closes the popover and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<Harness activeThemeId="positron" />);
    const trigger = screen.getByRole('button', { name: /^Map theme:/ });
    await user.click(trigger);
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
    await waitFor(() => expect(screen.queryByRole('radiogroup')).toBeNull());
  });

  it('an outside click closes the popover', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <Harness activeThemeId="positron" />
        <button type="button">outside</button>
      </div>,
    );
    const trigger = screen.getByRole('button', { name: /^Map theme:/ });
    await user.click(trigger);
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'outside' }));
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(screen.queryByRole('radiogroup')).toBeNull());
  });

  it('applies the menu-dropdown recipe class + top-right origin to the popover surface', async () => {
    const user = userEvent.setup();
    render(<Harness activeThemeId="positron" />);
    await user.click(screen.getByRole('button', { name: /^Map theme:/ }));

    const surface = screen.getByTestId('theme-selector-popover');
    expect(surface).toHaveClass('t-dropdown');
    expect(surface).toHaveAttribute('data-origin', 'top-right');
  });
});

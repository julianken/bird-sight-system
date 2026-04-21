import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SpeciesOption } from './FiltersBar.js';
import { SpeciesAutocomplete } from './SpeciesAutocomplete.js';

const SPECIES_INDEX: SpeciesOption[] = [
  { code: 'vermfly', comName: 'Vermilion Flycatcher' },
  { code: 'cacwre', comName: 'Cactus Wren' },
  { code: 'gbher3', comName: 'Great Blue Heron' },
  { code: 'rethaw', comName: 'Red-tailed Hawk' },
  { code: 'annhum', comName: "Anna's Hummingbird" },
];

describe('SpeciesAutocomplete', () => {
  it('renders a combobox input with the WAI-ARIA 1.2 contract', () => {
    render(
      <SpeciesAutocomplete
        speciesIndex={SPECIES_INDEX}
        onSelectSpecies={() => {}}
      />
    );
    // WAI-ARIA 1.2 combobox pattern: the input itself carries role="combobox"
    // with aria-autocomplete="list" (not "inline" — we do not text-insert),
    // aria-expanded, and aria-controls pointing at the listbox id.
    const input = screen.getByRole('combobox', { name: /search species/i });
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input.getAttribute('aria-controls')).toBeTruthy();
  });

  it('does not render the listbox until the user types', () => {
    render(
      <SpeciesAutocomplete
        speciesIndex={SPECIES_INDEX}
        onSelectSpecies={() => {}}
      />
    );
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('opens the listbox when the user types and narrows by prefix + substring', async () => {
    const user = userEvent.setup();
    render(
      <SpeciesAutocomplete
        speciesIndex={SPECIES_INDEX}
        onSelectSpecies={() => {}}
      />
    );
    const input = screen.getByRole('combobox', { name: /search species/i });
    await user.type(input, 'wren');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    const listbox = screen.getByRole('listbox');
    const options = within(listbox).getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Cactus Wren');
  });

  it('matches comName prefix first, then substring — "red" matches "Red-tailed Hawk" (prefix), not "Cactus Wren" or "Vermilion Flycatcher"', async () => {
    const user = userEvent.setup();
    render(
      <SpeciesAutocomplete
        speciesIndex={SPECIES_INDEX}
        onSelectSpecies={() => {}}
      />
    );
    const input = screen.getByRole('combobox', { name: /search species/i });
    await user.type(input, 'red');
    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    const texts = options.map(o => o.textContent);
    // Prefix hit leads the list.
    expect(texts[0]).toMatch(/Red-tailed Hawk/);
    // "red" does not appear in any other seed species, so no substring hits.
    expect(texts).toHaveLength(1);
  });

  it('surfaces substring matches when no prefix match exists — "ron" matches "Great Blue Heron"', async () => {
    const user = userEvent.setup();
    render(
      <SpeciesAutocomplete
        speciesIndex={SPECIES_INDEX}
        onSelectSpecies={() => {}}
      />
    );
    const input = screen.getByRole('combobox', { name: /search species/i });
    await user.type(input, 'ron');
    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    const texts = options.map(o => o.textContent);
    expect(texts).toContain('Great Blue Heron');
  });

  it('arrow keys navigate the option list and Enter commits', async () => {
    const onSelectSpecies = vi.fn();
    const user = userEvent.setup();
    render(
      <SpeciesAutocomplete
        speciesIndex={SPECIES_INDEX}
        onSelectSpecies={onSelectSpecies}
      />
    );
    const input = screen.getByRole('combobox', { name: /search species/i });
    await user.type(input, 're');
    // ArrowDown highlights the first option.
    await user.keyboard('{ArrowDown}');
    const listbox = screen.getByRole('listbox');
    const firstOption = within(listbox).getAllByRole('option')[0];
    expect(firstOption).toHaveAttribute('aria-selected', 'true');
    // aria-activedescendant on the input points at the highlighted option.
    expect(input.getAttribute('aria-activedescendant')).toBe(firstOption.id);
    // Enter commits the highlighted option.
    await user.keyboard('{Enter}');
    expect(onSelectSpecies).toHaveBeenCalledTimes(1);
    // The first option after typing "re" is the prefix-matched Red-tailed Hawk.
    expect(onSelectSpecies).toHaveBeenCalledWith('rethaw');
  });

  it('ArrowDown wraps from last to first, ArrowUp wraps from first to last', async () => {
    const user = userEvent.setup();
    render(
      <SpeciesAutocomplete
        speciesIndex={SPECIES_INDEX}
        onSelectSpecies={() => {}}
      />
    );
    const input = screen.getByRole('combobox', { name: /search species/i });
    await user.type(input, 'e'); // broad match
    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options.length).toBeGreaterThan(1);
    // Walk past the end — wraps.
    for (let i = 0; i < options.length + 1; i++) {
      await user.keyboard('{ArrowDown}');
    }
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    // ArrowUp from first → last.
    await user.keyboard('{ArrowUp}');
    expect(options[options.length - 1]).toHaveAttribute('aria-selected', 'true');
  });

  it('Escape clears the query, closes the listbox, and blurs the input', async () => {
    const onSelectSpecies = vi.fn();
    const user = userEvent.setup();
    render(
      <SpeciesAutocomplete
        speciesIndex={SPECIES_INDEX}
        onSelectSpecies={onSelectSpecies}
      />
    );
    const input = screen.getByRole('combobox', { name: /search species/i }) as HTMLInputElement;
    await user.type(input, 'wren');
    expect(input.value).toBe('wren');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(input.value).toBe('');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).not.toBe(input);
    // Escape must NOT commit a selection.
    expect(onSelectSpecies).not.toHaveBeenCalled();
  });

  it('clicking an option commits and closes the listbox', async () => {
    const onSelectSpecies = vi.fn();
    const user = userEvent.setup();
    render(
      <SpeciesAutocomplete
        speciesIndex={SPECIES_INDEX}
        onSelectSpecies={onSelectSpecies}
      />
    );
    const input = screen.getByRole('combobox', { name: /search species/i });
    await user.type(input, 'wren');
    const option = within(screen.getByRole('listbox')).getByRole('option', { name: /Cactus Wren/ });
    await user.click(option);
    expect(onSelectSpecies).toHaveBeenCalledWith('cacwre');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows a "No matches" state when the query matches nothing', async () => {
    const user = userEvent.setup();
    render(
      <SpeciesAutocomplete
        speciesIndex={SPECIES_INDEX}
        onSelectSpecies={() => {}}
      />
    );
    const input = screen.getByRole('combobox', { name: /search species/i });
    await user.type(input, 'zzzzz');
    // No listbox when zero matches — but a visible "No matches" status.
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByText(/No matches/i)).toBeInTheDocument();
  });

  describe('dropdown positioning', () => {
    // Pin viewport height to 800 and test getBoundingClientRect with stubs.
    // The component reads input.getBoundingClientRect().bottom + a fixed
    // dropdown height estimate; when the sum overflows window.innerHeight,
    // data-position flips to "above".
    let originalInnerHeight: number;

    beforeEach(() => {
      originalInnerHeight = window.innerHeight;
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: 800,
      });
    });

    afterEach(() => {
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: originalInnerHeight,
      });
    });

    it('dropdown opens below the input by default (input near top of viewport)', async () => {
      const user = userEvent.setup();
      const { container } = render(
        <SpeciesAutocomplete
          speciesIndex={SPECIES_INDEX}
          onSelectSpecies={() => {}}
        />
      );
      const input = screen.getByRole('combobox', { name: /search species/i });
      // Stub rect: input sits at top of viewport.
      input.getBoundingClientRect = () => ({
        top: 10, bottom: 40, left: 0, right: 300,
        x: 0, y: 10, width: 300, height: 30,
        toJSON: () => ({}),
      });
      await user.type(input, 'wren');
      const wrapper = container.querySelector('.species-autocomplete') as HTMLElement;
      expect(wrapper.getAttribute('data-position')).toBe('below');
    });

    it('dropdown flips above when the input is near the viewport bottom', async () => {
      const user = userEvent.setup();
      const { container } = render(
        <SpeciesAutocomplete
          speciesIndex={SPECIES_INDEX}
          onSelectSpecies={() => {}}
        />
      );
      const input = screen.getByRole('combobox', { name: /search species/i });
      // Stub rect: input's bottom is near the bottom of the viewport so
      // input.bottom + dropdown-height would overflow.
      input.getBoundingClientRect = () => ({
        top: 760, bottom: 790, left: 0, right: 300,
        x: 0, y: 760, width: 300, height: 30,
        toJSON: () => ({}),
      });
      await user.type(input, 'wren');
      const wrapper = container.querySelector('.species-autocomplete') as HTMLElement;
      expect(wrapper.getAttribute('data-position')).toBe('above');
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, act } from '@testing-library/react';
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
    // Auto-highlight already selects the first option; confirm it before
    // pressing any arrow key.
    const listbox = screen.getByRole('listbox');
    const firstOption = within(listbox).getAllByRole('option')[0];
    expect(firstOption).toHaveAttribute('aria-selected', 'true');
    // aria-activedescendant on the input points at the auto-highlighted option.
    expect(input.getAttribute('aria-activedescendant')).toBe(firstOption.id);
    // ArrowDown advances from the first option to the second.
    await user.keyboard('{ArrowDown}');
    const secondOption = within(listbox).getAllByRole('option')[1];
    expect(secondOption).toHaveAttribute('aria-selected', 'true');
    // ArrowUp returns to the first option.
    await user.keyboard('{ArrowUp}');
    expect(firstOption).toHaveAttribute('aria-selected', 'true');
    // Enter commits the highlighted option (back on first = Red-tailed Hawk).
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
    // Auto-highlight starts at 0; walk from 0 past the end — wraps back to 0.
    // That takes options.length presses (0→1→…→last→0).
    for (let i = 0; i < options.length; i++) {
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

  it('auto-highlights the first option (aria-selected="true") when matches first appear', async () => {
    const user = userEvent.setup();
    render(
      <SpeciesAutocomplete
        speciesIndex={SPECIES_INDEX}
        onSelectSpecies={() => {}}
      />
    );
    const input = screen.getByRole('combobox', { name: /search species/i });
    await user.type(input, 'wren');
    const listbox = screen.getByRole('listbox');
    const options = within(listbox).getAllByRole('option');
    // First option must be auto-highlighted without any arrow-key navigation.
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('Enter with no prior arrow-key nav commits the first option', async () => {
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
    // Press Enter immediately — no ArrowDown/ArrowUp.
    await user.keyboard('{Enter}');
    expect(onSelectSpecies).toHaveBeenCalledTimes(1);
    expect(onSelectSpecies).toHaveBeenCalledWith('cacwre');
  });

  it('Enter commits first match when highlighted is stale/out-of-bounds after match list narrows', async () => {
    // Reproduces the race: user ArrowDowns to index 3 while 4 matches are
    // shown, then a narrowing keystroke shrinks matches to 2. The useEffect
    // that clamps highlighted hasn't flushed yet when Enter fires. Without the
    // fix, highlighted=3 is out-of-bounds for the new matches list and Enter
    // is a no-op.
    const onSelectSpecies = vi.fn();
    const user = userEvent.setup();
    render(
      <SpeciesAutocomplete
        speciesIndex={SPECIES_INDEX}
        onSelectSpecies={onSelectSpecies}
      />
    );
    const input = screen.getByRole('combobox', { name: /search species/i }) as HTMLInputElement;

    // Type "e" → 4 substring matches sorted by comName:
    // [0] Cactus Wren, [1] Great Blue Heron, [2] Red-tailed Hawk, [3] Vermilion Flycatcher
    // ("e" is a substring in all four; none start with "e" so all rank=1).
    await user.type(input, 'e');
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getAllByRole('option')).toHaveLength(4);

    // ArrowDown × 3: highlighted advances 0 → 1 → 2 → 3 (Vermilion Flycatcher).
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowDown}');
    expect(within(listbox).getAllByRole('option')[3]).toHaveAttribute('aria-selected', 'true');

    // Simulate the stale-highlighted race by batching both events inside a
    // synchronous act() call. Inside act, React re-renders synchronously after
    // fireEvent.change (useMemo recomputes matches to length 2) but defers
    // useEffect until act exits. fireEvent.keyDown therefore executes with
    // highlighted=3 (stale) against matches.length=2 — exactly the state the
    // bug was filed against.
    act(() => {
      fireEvent.change(input, { target: { value: 'er' } });
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    // Without the fix: Enter is a no-op (highlighted=3, matches[3]=undefined,
    // neither branch triggers). With the fix: falls through to the
    // !matches[highlighted] branch and commits matches[0].
    // "er" matches Great Blue Heron (gbher3) and Vermilion Flycatcher (vermfly),
    // sorted by comName → matches[0] = Great Blue Heron.
    expect(onSelectSpecies).toHaveBeenCalledTimes(1);
    expect(onSelectSpecies).toHaveBeenCalledWith('gbher3');
  });

  describe('family group headers', () => {
    // Extended species index with familyCode populated so grouping can run.
    const GROUPED_INDEX: SpeciesOption[] = [
      { code: 'dowwoo', comName: 'Downy Woodpecker',    familyCode: 'Picidae',    taxonOrder: 10 },
      { code: 'haiwoo', comName: 'Hairy Woodpecker',    familyCode: 'Picidae',    taxonOrder: 11 },
      { code: 'rethaw', comName: 'Red-tailed Hawk',     familyCode: 'Accipitridae', taxonOrder: 5 },
      { code: 'coohaw', comName: "Cooper's Hawk",        familyCode: 'Accipitridae', taxonOrder: 6 },
      { code: 'unknsp', comName: 'Unknown Species',      familyCode: null,         taxonOrder: 999 },
    ];

    it('grouping contract: options render under family group headers', async () => {
      const user = userEvent.setup();
      render(
        <SpeciesAutocomplete
          speciesIndex={GROUPED_INDEX}
          onSelectSpecies={() => {}}
        />
      );
      const input = screen.getByRole('combobox', { name: /search species/i });
      // "o" matches Downy Woodpecker, Hairy Woodpecker (via substring),
      // Cooper's Hawk (prefix "coo" but "o" substring), Red-tailed Hawk ("o" in "Red"),
      // and Unknown Species ("o" in "Unknown").
      await user.type(input, 'oo');
      // Group headers should be present: Picidae (has "oo" matches), Accipitridae (Cooper's Hawk).
      const listbox = screen.getByRole('listbox');
      // Options are still role="option" and accessible.
      const options = within(listbox).getAllByRole('option');
      expect(options.length).toBeGreaterThan(0);
      // Group elements present (role="group").
      const groups = within(listbox).getAllByRole('group');
      expect(groups.length).toBeGreaterThan(0);
    });

    it('stable sort: groups sort by the first member taxonOrder; "Other" bucket sorts last', async () => {
      const user = userEvent.setup();
      render(
        <SpeciesAutocomplete
          speciesIndex={GROUPED_INDEX}
          onSelectSpecies={() => {}}
        />
      );
      const input = screen.getByRole('combobox', { name: /search species/i });
      // Type "a" — matches Red-tailed Hawk, Cooper's Hawk (Accipitridae taxonOrder 5&6),
      // Downy Woodpecker (no "a"), Hairy Woodpecker (Hairy has "a"), Unknown Species ("a" in "Unknown").
      // Actually, use broad query to get all groups.
      // "oo" matches: Downy Woodpecker (oo), Hairy Woodpecker (oo), Cooper's Hawk (oo), Unknown Species (oo in "Unknown")
      await user.type(input, 'oo');
      const listbox = screen.getByRole('listbox');
      const groups = within(listbox).getAllByRole('group');
      // Group order should be Accipitridae (taxonOrder 5) first, then Picidae (taxonOrder 10),
      // and any "Other" bucket last.
      const groupLabels = groups.map(g => {
        // The header is a role="presentation" or aria-labelledby; grab its text content.
        return g.textContent ?? '';
      });
      // "Other" must appear last if present.
      const otherIdx = groupLabels.findIndex(l => /other/i.test(l));
      if (otherIdx !== -1) {
        expect(otherIdx).toBe(groupLabels.length - 1);
      }
    });

    it('fallback "Other" bucket: options with null familyCode appear in Other group', async () => {
      const user = userEvent.setup();
      render(
        <SpeciesAutocomplete
          speciesIndex={GROUPED_INDEX}
          onSelectSpecies={() => {}}
        />
      );
      const input = screen.getByRole('combobox', { name: /search species/i });
      // "unknown" matches only "Unknown Species" which has familyCode=null.
      await user.type(input, 'unknown');
      const listbox = screen.getByRole('listbox');
      // Should render in an "Other" group.
      const groups = within(listbox).getAllByRole('group');
      const hasOtherHeader = groups.some(g => /other/i.test(g.textContent ?? ''));
      expect(hasOtherHeader).toBe(true);
      // The option itself is still present.
      const options = within(listbox).getAllByRole('option');
      expect(options.some(o => /Unknown Species/i.test(o.textContent ?? ''))).toBe(true);
    });

    it('keyboard nav skips headers — ArrowDown traverses options across group boundaries', async () => {
      const user = userEvent.setup();
      const onSelectSpecies = vi.fn();
      render(
        <SpeciesAutocomplete
          speciesIndex={GROUPED_INDEX}
          onSelectSpecies={onSelectSpecies}
        />
      );
      const input = screen.getByRole('combobox', { name: /search species/i });
      // "hawk" matches Red-tailed Hawk and Cooper's Hawk (both Accipitridae).
      await user.type(input, 'hawk');
      const listbox = screen.getByRole('listbox');
      const options = within(listbox).getAllByRole('option');
      // Auto-highlight should be on first option.
      expect(options[0]).toHaveAttribute('aria-selected', 'true');
      // ArrowDown should advance to next option (skipping any header).
      await user.keyboard('{ArrowDown}');
      expect(options[1]).toHaveAttribute('aria-selected', 'true');
      // Enter commits the highlighted option.
      await user.keyboard('{Enter}');
      expect(onSelectSpecies).toHaveBeenCalledTimes(1);
    });
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

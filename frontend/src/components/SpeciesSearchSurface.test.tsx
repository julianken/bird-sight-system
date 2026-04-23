import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Observation } from '@bird-watch/shared-types';
import { SpeciesSearchSurface } from './SpeciesSearchSurface.js';
import type { SpeciesOption } from './FiltersBar.js';

const NOW = new Date(2026, 3, 15, 15, 0, 0, 0);

const SPECIES_INDEX: SpeciesOption[] = [
  { code: 'vermfly', comName: 'Vermilion Flycatcher' },
  { code: 'cacwre', comName: 'Cactus Wren' },
  { code: 'gbher3', comName: 'Great Blue Heron' },
];

function obs(partial: Partial<Observation>): Observation {
  return {
    subId: partial.subId ?? 'S000',
    speciesCode: partial.speciesCode ?? 'vermfly',
    comName: partial.comName ?? 'Vermilion Flycatcher',
    lat: 32.2,
    lng: -110.9,
    obsDt: partial.obsDt ?? new Date(NOW.getTime() - 60 * 60_000).toISOString(),
    locId: 'L001',
    locName: partial.locName ?? 'Sabino Canyon',
    howMany: partial.howMany ?? 1,
    isNotable: partial.isNotable ?? false,
    regionId: null,
    silhouetteId: null,
    familyCode: null,
  };
}

describe('SpeciesSearchSurface', () => {
  it('renders the autocomplete at the top', () => {
    render(
      <SpeciesSearchSurface
        loading={false}
        speciesCode={null}
        observations={[]}
        speciesIndex={SPECIES_INDEX}
        now={NOW}
        onSelectSpecies={() => {}}
        onClearSpecies={() => {}}
      />
    );
    expect(screen.getByRole('combobox', { name: /search species/i })).toBeInTheDocument();
  });

  it('renders the autocomplete above the recent-sightings list in the DOM', () => {
    render(
      <SpeciesSearchSurface
        loading={false}
        speciesCode="vermfly"
        observations={[
          obs({ subId: 'S1', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher' }),
        ]}
        speciesIndex={SPECIES_INDEX}
        now={NOW}
        onSelectSpecies={() => {}}
        onClearSpecies={() => {}}
      />
    );
    const combobox = screen.getByRole('combobox', { name: /search species/i });
    const list = screen.getByRole('list', { name: /recent sightings/i });
    // The combobox's compareDocumentPosition should put it before the list.
    expect(combobox.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders a prompt when speciesCode is null', () => {
    render(
      <SpeciesSearchSurface
        loading={false}
        speciesCode={null}
        observations={[]}
        speciesIndex={SPECIES_INDEX}
        now={NOW}
        onSelectSpecies={() => {}}
        onClearSpecies={() => {}}
      />
    );
    expect(screen.getByText(/Start typing a species|Pick a species/i)).toBeInTheDocument();
    // No recent-sightings list yet.
    expect(screen.queryByRole('list', { name: /recent sightings/i })).toBeNull();
  });

  it('renders recent-sightings list filtered client-side when speciesCode is set', () => {
    const observations = [
      obs({ subId: 'S1', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher' }),
      obs({ subId: 'S2', speciesCode: 'cacwre', comName: 'Cactus Wren' }),
      obs({ subId: 'S3', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher', locName: 'Agua Caliente' }),
    ];
    render(
      <SpeciesSearchSurface
        loading={false}
        speciesCode="vermfly"
        observations={observations}
        speciesIndex={SPECIES_INDEX}
        now={NOW}
        onSelectSpecies={() => {}}
        onClearSpecies={() => {}}
      />
    );
    const list = screen.getByRole('list', { name: /recent sightings/i });
    const rows = within(list).getAllByRole('button');
    // Only the two vermfly observations render.
    expect(rows).toHaveLength(2);
    rows.forEach(row => {
      expect(row).toHaveTextContent('Vermilion Flycatcher');
    });
  });

  it('clicking a recent-sightings row is a no-op because the panel is already open', async () => {
    const onSelectSpecies = vi.fn();
    const user = userEvent.setup();
    render(
      <SpeciesSearchSurface
        loading={false}
        speciesCode="vermfly"
        observations={[obs({ subId: 'S1', speciesCode: 'vermfly' })]}
        speciesIndex={SPECIES_INDEX}
        now={NOW}
        onSelectSpecies={onSelectSpecies}
        onClearSpecies={() => {}}
      />
    );
    const row = within(
      screen.getByRole('list', { name: /recent sightings/i }),
    ).getByRole('button');
    await user.click(row);
    // No reopen/re-commit — the panel is already open for this species.
    expect(onSelectSpecies).not.toHaveBeenCalled();
  });

  it('selecting a species via the autocomplete fires onSelectSpecies', async () => {
    const onSelectSpecies = vi.fn();
    const user = userEvent.setup();
    render(
      <SpeciesSearchSurface
        loading={false}
        speciesCode={null}
        observations={[]}
        speciesIndex={SPECIES_INDEX}
        now={NOW}
        onSelectSpecies={onSelectSpecies}
        onClearSpecies={() => {}}
      />
    );
    const input = screen.getByRole('combobox', { name: /search species/i });
    await user.type(input, 'wren');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onSelectSpecies).toHaveBeenCalledWith('cacwre');
  });

  it('renders an empty-state when species is set but no matching observations are in the feed', () => {
    render(
      <SpeciesSearchSurface
        loading={false}
        speciesCode="vermfly"
        observations={[obs({ subId: 'S1', speciesCode: 'cacwre', comName: 'Cactus Wren' })]}
        speciesIndex={SPECIES_INDEX}
        now={NOW}
        onSelectSpecies={() => {}}
        onClearSpecies={() => {}}
      />
    );
    // No list — and an explicit empty hint (keeps the failure explicit for
    // a user who came in on a cold-load ?species=xxx URL with a narrow ?since=).
    expect(screen.queryByRole('list', { name: /recent sightings/i })).toBeNull();
    expect(screen.getByText(/No recent sightings/i)).toBeInTheDocument();
  });

  it('renders a loading hint while observations are still loading', () => {
    render(
      <SpeciesSearchSurface
        loading={true}
        speciesCode="vermfly"
        observations={[]}
        speciesIndex={SPECIES_INDEX}
        now={NOW}
        onSelectSpecies={() => {}}
        onClearSpecies={() => {}}
      />
    );
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /recent sightings/i })).toBeNull();
  });
});

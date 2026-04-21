import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Observation } from '@bird-watch/shared-types';
import { ObservationFeedRow } from './ObservationFeedRow.js';

// NOW is constructed from LOCAL components so bucket boundaries survive
// the runner timezone (macOS = America/Phoenix, Actions = UTC).
const NOW = new Date(2026, 3, 15, 15, 0, 0, 0);

const BASE_OBS: Observation = {
  subId: 'S001',
  speciesCode: 'vermfly',
  comName: 'Vermilion Flycatcher',
  lat: 32.2,
  lng: -110.9,
  obsDt: new Date(NOW.getTime() - 15 * 60_000).toISOString(), // 15 min ago
  locId: 'L001',
  locName: 'Sabino Canyon',
  howMany: 1,
  isNotable: false,
  regionId: null,
  silhouetteId: null,
};

describe('ObservationFeedRow', () => {
  it('renders comName, locName, and relative time', () => {
    render(
      <ObservationFeedRow
        observation={BASE_OBS}
        now={NOW}
        onSelectSpecies={() => {}}
      />
    );
    expect(screen.getByText('Vermilion Flycatcher')).toBeInTheDocument();
    expect(screen.getByText('Sabino Canyon')).toBeInTheDocument();
    expect(screen.getByText('15 min ago')).toBeInTheDocument();
  });

  it('renders a count chip "×N" when howMany > 1 and hides it when howMany is 1', () => {
    const { rerender } = render(
      <ObservationFeedRow
        observation={{ ...BASE_OBS, howMany: 5 }}
        now={NOW}
        onSelectSpecies={() => {}}
      />
    );
    expect(screen.getByText('×5')).toBeInTheDocument();

    rerender(
      <ObservationFeedRow
        observation={{ ...BASE_OBS, howMany: 1 }}
        now={NOW}
        onSelectSpecies={() => {}}
      />
    );
    expect(screen.queryByText(/×\d/)).toBeNull();
    expect(screen.queryByText('×1')).toBeNull();
  });

  it('renders the notable badge when isNotable is true even when global notable filter is off', () => {
    // The row-level flag is independent of FiltersBar.notable. The parent
    // passes observation.isNotable directly; this test asserts we render the
    // badge regardless of any other filter context.
    render(
      <ObservationFeedRow
        observation={{ ...BASE_OBS, isNotable: true }}
        now={NOW}
        onSelectSpecies={() => {}}
      />
    );
    // Notable signal lives in the row's single aria-label — child aria-labels
    // would be silenced by the parent button's label anyway (ARIA accname).
    expect(
      screen.getByRole('button', { name: /^Notable sighting, Vermilion Flycatcher/ }),
    ).toBeInTheDocument();
    // And the visible "!" glyph is aria-hidden so screen readers don't
    // announce it twice.
    expect(screen.getByTitle('Notable sighting')).toHaveAttribute('aria-hidden', 'true');
  });

  it('pins the comprehensive accessible name with all five slots', () => {
    // The button carries one aria-label combining: notable flag, comName,
    // count, locName, relative time — in that order, comma-separated. This
    // is the contract #117 and #118 depend on when they reuse the row.
    render(
      <ObservationFeedRow
        observation={{ ...BASE_OBS, isNotable: true, howMany: 7 }}
        now={NOW}
        onSelectSpecies={() => {}}
      />
    );
    const row = screen.getByRole('button');
    expect(row).toHaveAccessibleName(
      'Notable sighting, Vermilion Flycatcher, 7 birds, at Sabino Canyon, 15 min ago',
    );
  });

  it('omits the notable prefix, count, and location when absent', () => {
    render(
      <ObservationFeedRow
        observation={{ ...BASE_OBS, isNotable: false, howMany: 1, locName: null }}
        now={NOW}
        onSelectSpecies={() => {}}
      />
    );
    const row = screen.getByRole('button');
    // No "Notable sighting" prefix, no count (howMany=1 is solo/default),
    // no "at <loc>" (null), just comName and time.
    expect(row).toHaveAccessibleName('Vermilion Flycatcher, 15 min ago');
  });

  it('announces "count unknown" when howMany is null', () => {
    render(
      <ObservationFeedRow
        observation={{ ...BASE_OBS, isNotable: false, howMany: null, locName: null }}
        now={NOW}
        onSelectSpecies={() => {}}
      />
    );
    expect(screen.getByRole('button')).toHaveAccessibleName(
      'Vermilion Flycatcher, count unknown, 15 min ago',
    );
  });

  it('renders null howMany as "—" (em dash) and omits locName when null', () => {
    render(
      <ObservationFeedRow
        observation={{ ...BASE_OBS, howMany: null, locName: null }}
        now={NOW}
        onSelectSpecies={() => {}}
      />
    );
    expect(screen.getByText('—')).toBeInTheDocument();
    // Must not render the literal "null".
    expect(screen.queryByText('null')).toBeNull();
  });

  it('fires onSelectSpecies with the species code on click and Enter', async () => {
    const onSelectSpecies = vi.fn();
    const user = userEvent.setup();
    render(
      <ObservationFeedRow
        observation={BASE_OBS}
        now={NOW}
        onSelectSpecies={onSelectSpecies}
      />
    );
    const row = screen.getByRole('button', { name: /Vermilion Flycatcher/ });
    await user.click(row);
    expect(onSelectSpecies).toHaveBeenCalledWith('vermfly');

    onSelectSpecies.mockClear();
    row.focus();
    await user.keyboard('{Enter}');
    expect(onSelectSpecies).toHaveBeenCalledWith('vermfly');
  });

  it('is a React.memo — does not re-render when props are referentially equal', () => {
    // The memoization contract: same observation reference + same now +
    // same onSelectSpecies → no DOM churn. We assert this indirectly by
    // checking that rerendering with the same props does not mutate the
    // DOM node identity (React bails out on the render path).
    const onSelectSpecies = vi.fn();
    const { rerender, container } = render(
      <ObservationFeedRow
        observation={BASE_OBS}
        now={NOW}
        onSelectSpecies={onSelectSpecies}
      />
    );
    const firstNode = container.firstChild;
    rerender(
      <ObservationFeedRow
        observation={BASE_OBS}
        now={NOW}
        onSelectSpecies={onSelectSpecies}
      />
    );
    const secondNode = container.firstChild;
    // Identity is preserved across renders either way (React re-uses DOM
    // nodes), but the `displayName` check below confirms the export is a
    // memo component — the behavioural contract.
    expect(firstNode).toBe(secondNode);
    // React.memo sets `$$typeof === REACT_MEMO_TYPE` and exposes a
    // `.type` pointing at the inner component. The runtime shape check
    // lets us verify the wrapper is present without depending on React's
    // internal symbol constants.
    const MemoSymbol = Symbol.for('react.memo');
    expect(
      (ObservationFeedRow as unknown as { $$typeof: symbol }).$$typeof
    ).toBe(MemoSymbol);
  });
});

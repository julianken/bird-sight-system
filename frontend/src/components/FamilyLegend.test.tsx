import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FamilySilhouette, Observation } from '@bird-watch/shared-types';
import { FamilyLegend } from './FamilyLegend.js';

const baseSilhouettes: FamilySilhouette[] = [
  {
    familyCode: 'tyrannidae',
    color: '#C77A2E',
    svgData: 'M0 0L1 1Z',
    source: 'placeholder',
    license: 'CC0',
    commonName: 'Tyrant Flycatchers',
    creator: null,
  },
  {
    familyCode: 'trochilidae',
    color: '#7B2D8E',
    svgData: 'M0 0L1 1Z',
    source: 'placeholder',
    license: 'CC0',
    commonName: 'Hummingbirds',
    creator: null,
  },
  {
    familyCode: 'unknownidae',
    color: '#888888',
    svgData: null,
    source: null,
    license: null,
    // Null commonName drives the prettyFamily fallback path.
    commonName: null,
    creator: null,
  },
];

function obs(subId: string, familyCode: string): Observation {
  return {
    subId,
    speciesCode: 'x',
    comName: 'X',
    lat: 31.7,
    lng: -110.8,
    obsDt: '2026-04-15T12:00:00Z',
    locId: 'L1',
    locName: 'X',
    howMany: 1,
    isNotable: false,
    regionId: null,
    silhouetteId: null,
    familyCode,
  };
}

// Three observations exercising every silhouette in baseSilhouettes so the
// legend renders three entries — including the unknownidae row whose
// commonName is null and exercises the prettyFamily fallback path.
const baseObservations: Observation[] = [
  obs('S1', 'tyrannidae'),
  obs('S2', 'tyrannidae'),
  obs('S3', 'trochilidae'),
  obs('S4', 'unknownidae'),
];

const STORAGE_KEY = 'family-legend-expanded';

function clearLegendStorage() {
  try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* jsdom only */ }
}

beforeEach(() => clearLegendStorage());
afterEach(() => clearLegendStorage());

describe('FamilyLegend', () => {
  it('renders a header reading "Bird families in view" and a toggle button', () => {
    // Issue #351: the legend title narrates viewport state, not a global
    // catalogue. The "in view" suffix is what tells a sighted user that
    // counts will change as they pan.
    render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode={null}
        onFamilyToggle={() => {}}
        defaultExpanded={true}
      />
    );
    expect(screen.getByText(/bird families in view/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /bird families in view/i }),
    ).toBeInTheDocument();
  });

  it('renders an entry for each provided silhouette when expanded', () => {
    render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode={null}
        onFamilyToggle={() => {}}
        defaultExpanded={true}
      />
    );
    // Three entries: tyrannidae, trochilidae, unknownidae.
    const entries = screen.getAllByTestId('family-legend-entry');
    expect(entries).toHaveLength(3);
  });

  it('uses commonName when present and falls back to prettyFamily(code) when null', () => {
    render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode={null}
        onFamilyToggle={() => {}}
        defaultExpanded={true}
      />
    );
    // Tyrannidae => 'Tyrant Flycatchers' (commonName)
    expect(screen.getByText('Tyrant Flycatchers')).toBeInTheDocument();
    // Trochilidae => 'Hummingbirds'
    expect(screen.getByText('Hummingbirds')).toBeInTheDocument();
    // Unknownidae => prettyFamily fallback => 'Unknownidae'
    expect(screen.getByText('Unknownidae')).toBeInTheDocument();
  });

  it('shows observation counts per family', () => {
    render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode={null}
        onFamilyToggle={() => {}}
        defaultExpanded={true}
      />
    );
    const tyrEntry = screen.getByRole('button', { name: /Tyrant Flycatchers/ });
    expect(within(tyrEntry).getByText('2')).toBeInTheDocument();
    const trochEntry = screen.getByRole('button', { name: /Hummingbirds/ });
    expect(within(trochEntry).getByText('1')).toBeInTheDocument();
  });

  it('per-entry aria-label reads "{count} observations in view" (issue #351)', () => {
    // Screen-reader text mirrors the title's "in view" framing so the
    // count is unambiguously a viewport snapshot, not a global total.
    render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode={null}
        onFamilyToggle={() => {}}
        defaultExpanded={true}
      />
    );
    // Tyrannidae: 2 observations.
    const tyrEntry = screen.getByRole('button', { name: /Tyrant Flycatchers/ });
    expect(
      within(tyrEntry).getByLabelText('2 observations in view'),
    ).toBeInTheDocument();
    // Trochilidae: 1 observation.
    const trochEntry = screen.getByRole('button', { name: /Hummingbirds/ });
    expect(
      within(trochEntry).getByLabelText('1 observations in view'),
    ).toBeInTheDocument();
  });

  it('invokes onFamilyToggle with the family code when an entry is clicked', async () => {
    const onFamilyToggle = vi.fn();
    const user = userEvent.setup();
    render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode={null}
        onFamilyToggle={onFamilyToggle}
        defaultExpanded={true}
      />
    );
    await user.click(screen.getByRole('button', { name: /Tyrant Flycatchers/ }));
    expect(onFamilyToggle).toHaveBeenCalledWith('tyrannidae');
  });

  it('marks the active family entry with aria-pressed=true', () => {
    render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode="tyrannidae"
        onFamilyToggle={() => {}}
        defaultExpanded={true}
      />
    );
    const tyr = screen.getByRole('button', { name: /Tyrant Flycatchers/, pressed: true });
    expect(tyr).toBeInTheDocument();
    const troch = screen.getByRole('button', { name: /Hummingbirds/, pressed: false });
    expect(troch).toBeInTheDocument();
  });

  it('toggle button expands and collapses the entries', async () => {
    const user = userEvent.setup();
    render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode={null}
        onFamilyToggle={() => {}}
        defaultExpanded={true}
      />
    );
    expect(screen.getAllByTestId('family-legend-entry')).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: /bird families in view/i }));
    // Once collapsed, no entries are rendered (or at least none visible).
    expect(screen.queryAllByTestId('family-legend-entry')).toHaveLength(0);
    // And the toggle button reports collapsed state via aria-expanded=false.
    expect(screen.getByRole('button', { name: /bird families in view/i })).toHaveAttribute('aria-expanded', 'false');
  });

  it('respects defaultExpanded=false when localStorage is empty', () => {
    render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode={null}
        onFamilyToggle={() => {}}
        defaultExpanded={false}
      />
    );
    expect(screen.queryAllByTestId('family-legend-entry')).toHaveLength(0);
    expect(screen.getByRole('button', { name: /bird families in view/i })).toHaveAttribute('aria-expanded', 'false');
  });

  it('persists collapse state to localStorage', async () => {
    const user = userEvent.setup();
    render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode={null}
        onFamilyToggle={() => {}}
        defaultExpanded={true}
      />
    );
    expect(screen.getAllByTestId('family-legend-entry')).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: /bird families in view/i }));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('false');
    await user.click(screen.getByRole('button', { name: /bird families in view/i }));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('true');
  });

  it('localStorage value overrides defaultExpanded', () => {
    window.localStorage.setItem(STORAGE_KEY, 'true');
    render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode={null}
        onFamilyToggle={() => {}}
        defaultExpanded={false}
      />
    );
    // Despite defaultExpanded=false, localStorage 'true' wins and shows entries.
    expect(screen.getAllByTestId('family-legend-entry')).toHaveLength(3);
  });

  it('renders nothing when silhouettes is empty', () => {
    const { container } = render(
      <FamilyLegend
        silhouettes={[]}
        observations={[]}
        familyCode={null}
        onFamilyToggle={() => {}}
        defaultExpanded={true}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('omits entries with zero observations to keep the legend focused on what is visible', () => {
    // No observations means no families have counts; legend hides them.
    render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={[]}
        familyCode={null}
        onFamilyToggle={() => {}}
        defaultExpanded={true}
      />
    );
    expect(screen.queryAllByTestId('family-legend-entry')).toHaveLength(0);
  });

  it('entries list does not have inline grid-template-columns: 1fr 1fr override', () => {
    const { container } = render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode={null}
        onFamilyToggle={() => {}}
        defaultExpanded={true}
      />
    );
    const list = container.querySelector('.family-legend-entries') as HTMLElement;
    expect(list).not.toBeNull();
    // Guard against accidental inline-style re-introduction of a 2-column
    // layout — visual contract is enforced by Playwright at PR review time.
    expect(list.style.gridTemplateColumns).not.toBe('1fr 1fr');
  });
});

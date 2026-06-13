import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FamilySilhouette, Observation } from '@bird-watch/shared-types';
import { FamilyLegend } from './FamilyLegend.js';
import { setMatchMedia, getMockMediaQuery } from '../test-setup.js';

// useBreakpoint's two matchMedia queries (see use-breakpoint.ts). A matcher for
// a given viewport width lets these tests drive a specific tier and simulate a
// live mid-session resize via getMockMediaQuery(...).dispatchChange().
// F2 #1062: compact is now INCLUSIVE of 480 (`(max-width: 480px)`), matching the
// CSS desktop-first ≤480 convention; the matcher tracks the engine's query string.
const Q_COMPACT = '(max-width: 480px)';
const Q_ROOMY = '(max-width: 1023px)';
function matcherForWidth(width: number) {
  return (query: string): boolean => {
    if (query === Q_COMPACT) return width <= 480;
    if (query === Q_ROOMY) return width <= 1023;
    return false;
  };
}

const baseSilhouettes: FamilySilhouette[] = [
  {
    familyCode: 'tyrannidae',
    color: '#C77A2E',
    colorDark: '#C77A2E',
    svgData: 'M0 0L1 1Z',
    svgUrl: null,
    source: 'placeholder',
    license: 'CC0',
    commonName: 'Tyrant Flycatchers',
    creator: null,
  },
  {
    familyCode: 'trochilidae',
    color: '#7B2D8E',
    colorDark: '#7B2D8E',
    svgData: 'M0 0L1 1Z',
    svgUrl: null,
    source: 'placeholder',
    license: 'CC0',
    commonName: 'Hummingbirds',
    creator: null,
  },
  {
    familyCode: 'unknownidae',
    color: '#888888',
    colorDark: '#888888',
    svgData: null,
    svgUrl: null,
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

// E3 (#1055): the preference key is now per-breakpoint tier
// (`family-legend-expanded.v3.<tier>`). These unit tests do NOT install a
// matchMedia mock (no setMatchMedia call), so useBreakpoint() falls back to
// 'wide' — STORAGE_KEY therefore targets the wide tier's key, the active tier
// under jsdom. Tests that need a specific tier install setMatchMedia.
const STORAGE_KEY = 'family-legend-expanded.v3.wide';
const STORAGE_KEY_COMPACT = 'family-legend-expanded.v3.compact';
const STORAGE_KEY_ROOMY = 'family-legend-expanded.v3.roomy';
// Superseded breakpoint-blind key — only referenced by the migration cases.
const V2_STORAGE_KEY = 'family-legend-expanded.v2';
const LEGACY_STORAGE_KEY = 'family-legend-expanded';

function clearLegendStorage() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(STORAGE_KEY_COMPACT);
    window.localStorage.removeItem(STORAGE_KEY_ROOMY);
    window.localStorage.removeItem(V2_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch { /* jsdom only */ }
}

beforeEach(() => clearLegendStorage());
afterEach(() => clearLegendStorage());

describe('FamilyLegend', () => {
  it('O2 (#770): <aside> has explicit role="complementary" and aria-labelledby', () => {
    // AC: the <aside> must carry an explicit role="complementary" landmark
    // (not relying on the implicit aside-in-body mapping, which is ambiguous
    // once the element is hoisted to App-root). The aria-labelledby name
    // ("Bird families in view") disambiguates it from SpeciesDetailRail's
    // complementary landmark when both are open on desktop.
    render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode={null}
        onFamilyToggle={() => {}}
        defaultExpanded={true}
      />
    );
    const aside = document.querySelector('.family-legend');
    expect(aside).not.toBeNull();
    expect(aside!.getAttribute('role')).toBe('complementary');
    expect(aside!.getAttribute('aria-labelledby')).toBe('family-legend-toggle');
  });

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

  it('uses EXACT familyCounts (aggregated mode) instead of counting observations (#859 F)', () => {
    // In aggregated (low-zoom) mode the legend reads exact per-family totals
    // summed from bucket.families[].count — NOT the (empty) observations array,
    // and NEVER the capped species list. A family present with a true count of
    // 137 must show 137 even though `observations` is empty.
    render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={[]}
        familyCounts={new Map([['tyrannidae', 137], ['trochilidae', 42]])}
        familyCode={null}
        onFamilyToggle={() => {}}
        defaultExpanded={true}
      />
    );
    const tyrEntry = screen.getByRole('button', { name: /Tyrant Flycatchers/ });
    expect(within(tyrEntry).getByText('137')).toBeInTheDocument();
    const trochEntry = screen.getByRole('button', { name: /Hummingbirds/ });
    expect(within(trochEntry).getByText('42')).toBeInTheDocument();
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
    // Trochilidae: 1 observation — must use singular noun (C1 #1045).
    const trochEntry = screen.getByRole('button', { name: /Hummingbirds/ });
    expect(
      within(trochEntry).getByLabelText('1 observation in view'),
    ).toBeInTheDocument();
  });

  it('per-entry aria-label uses thousands separators for counts ≥1000 (C1 #1045)', () => {
    // Build a synthetic 1-family observation set with 1,500 entries.
    const manyObs: import('@bird-watch/shared-types').Observation[] = Array.from(
      { length: 1500 },
      (_, i) => obs(`S-${i}`, 'tyrannidae'),
    );
    render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={manyObs}
        familyCode={null}
        onFamilyToggle={() => {}}
        defaultExpanded={true}
      />
    );
    const tyrEntry = screen.getByRole('button', { name: /Tyrant Flycatchers/ });
    expect(
      within(tyrEntry).getByLabelText('1,500 observations in view'),
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

  it('persists collapse state to localStorage (.v2 key)', async () => {
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

  it('localStorage .v2 value overrides defaultExpanded', () => {
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
    // Despite defaultExpanded=false, localStorage .v2 'true' wins and shows entries.
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

describe('Phase 3: mobile-collapsed default', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('mobile viewport with empty localStorage starts collapsed', () => {
    render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode={null}
        onFamilyToggle={vi.fn()}
        defaultExpanded={false}
      />,
    );
    expect(screen.getByRole('button', { name: /Bird families in view/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('legacy localStorage value (.v1 key) is migrated and ignored on first paint', () => {
    // The user previously set the legacy key on desktop. On mobile first
    // paint, the legacy key is deleted and the viewport hint wins.
    window.localStorage.setItem('family-legend-expanded', 'true');
    render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode={null}
        onFamilyToggle={vi.fn()}
        defaultExpanded={false}
      />,
    );
    expect(screen.getByRole('button', { name: /Bird families in view/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(window.localStorage.getItem('family-legend-expanded')).toBeNull();
  });

  it('persistence under the per-tier .v3 key wins on subsequent mounts', () => {
    // jsdom has no matchMedia mock here → useBreakpoint() = 'wide', so the
    // active tier key is .v3.wide.
    window.localStorage.setItem(STORAGE_KEY, 'true');
    render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode={null}
        onFamilyToggle={vi.fn()}
        defaultExpanded={false}
      />,
    );
    expect(screen.getByRole('button', { name: /Bird families in view/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  // E3 (#1055): one-shot .v2 → .v3.<active-tier> migration. A non-null .v2 seeds
  // ONLY the tier the user is on right now (wide under jsdom), then .v2 is
  // deleted. Seeding all three tiers would re-create the cross-breakpoint leak
  // this issue kills.
  it('#1055: a stored .v2=true migrates into the ACTIVE tier key, then .v2 is deleted', () => {
    window.localStorage.setItem(V2_STORAGE_KEY, 'true');
    render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode={null}
        onFamilyToggle={vi.fn()}
        defaultExpanded={false}
      />,
    );
    // The migrated value wins over defaultExpanded=false: entries render.
    expect(screen.getByRole('button', { name: /Bird families in view/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    // .v2 is consumed and removed; the active tier (wide) carries the value.
    expect(window.localStorage.getItem(V2_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('true');
    // CRITICAL: the OTHER tiers are NOT seeded — that would re-create the leak.
    expect(window.localStorage.getItem(STORAGE_KEY_COMPACT)).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY_ROOMY)).toBeNull();
  });

  it('#1055: an already-set tier key wins over a stale .v2 (no overwrite), and .v2 is still cleared', () => {
    // A fresher per-tier write must not be clobbered by a leftover .v2.
    window.localStorage.setItem(STORAGE_KEY, 'false');
    window.localStorage.setItem(V2_STORAGE_KEY, 'true');
    render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode={null}
        onFamilyToggle={vi.fn()}
        defaultExpanded={true}
      />,
    );
    // The tier key 'false' wins (collapsed), NOT the stale .v2 'true'.
    expect(screen.getByRole('button', { name: /Bird families in view/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('false');
    expect(window.localStorage.getItem(V2_STORAGE_KEY)).toBeNull();
  });

  it('#1055: absent .v2 leaves defaultExpanded untouched (no seed)', () => {
    // No .v2 and no tier key → defaultExpanded governs; nothing is written
    // until the user toggles.
    render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode={null}
        onFamilyToggle={vi.fn()}
        defaultExpanded={false}
      />,
    );
    expect(screen.getByRole('button', { name: /Bird families in view/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(window.localStorage.getItem(V2_STORAGE_KEY)).toBeNull();
  });

  // #853: on the 481–1023px 'roomy' band, App passes defaultExpanded=false
  // (the <1024px collapse-default, #809). A stored tier preference still
  // overrides that default and renders the entries expanded — this behaviour is
  // intentional and must be preserved; the occlusion is bounded in CSS (a
  // shorter scrollable entries max-height on the band, NOT a forced collapse).
  // jsdom does not evaluate media queries, so the height cap itself is asserted
  // by legend-roomy-band-cap.spec.ts; this case guards the component contract
  // that the stored-expanded path keeps rendering entries.
  it('#853: stored tier=true keeps entries expanded over a collapse-default', () => {
    window.localStorage.setItem(STORAGE_KEY, 'true');
    render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode={null}
        onFamilyToggle={vi.fn()}
        defaultExpanded={false}
      />,
    );
    // The stored preference wins over the collapse-default: entries render,
    // and the toggle reports expanded. The bounding cap is CSS-only and does
    // NOT collapse the legend or mutate the stored preference.
    expect(screen.getAllByTestId('family-legend-entry')).toHaveLength(3);
    expect(
      screen.getByRole('button', { name: /Bird families in view/i }),
    ).toHaveAttribute('aria-expanded', 'true');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('true');
  });
});

describe('Phase 3: shape-paired swatches', () => {
  it('each entry swatch is a <FamilySilhouette> with the shape from getFamilyChannel', () => {
    render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode={null}
        onFamilyToggle={vi.fn()}
        defaultExpanded={true}
      />,
    );
    const entries = screen.getAllByTestId('family-legend-entry');
    // Each entry button contains a <FamilySilhouette> with data-shape attr
    for (const entry of entries) {
      const shape = entry.querySelector('[data-shape]');
      expect(shape).not.toBeNull();
      expect(['circle', 'square', 'pentagon', 'diamond']).toContain(
        shape!.getAttribute('data-shape'),
      );
    }
  });
});

describe('theme-aware swatch (F3 / #578)', () => {
  // Fixtures with distinct color vs colorDark so we can assert the correct
  // one is selected per theme. Distinct from baseSilhouettes where they happen
  // to be equal.
  const dualSilhouettes: FamilySilhouette[] = [
    {
      familyCode: 'tyrannidae',
      color: '#C77A2E',         // light-basemap color (darker)
      colorDark: '#E8983E',     // dark-legend color (lighter)
      svgData: 'M0 0L1 1Z',
      svgUrl: null,
      source: 'placeholder',
      license: 'CC0',
      commonName: 'Tyrant Flycatchers',
      creator: null,
    },
  ];
  const dualObservations: Observation[] = [obs('S1', 'tyrannidae')];

  it('light theme: swatch uses entry.silhouette.color (NOT colorDark)', () => {
    const prior = document.documentElement.getAttribute('data-theme');
    document.documentElement.setAttribute('data-theme', 'light');
    try {
      render(
        <FamilyLegend
          silhouettes={dualSilhouettes}
          observations={dualObservations}
          familyCode={null}
          onFamilyToggle={vi.fn()}
          defaultExpanded={true}
        />,
      );
      const tyrEntry = screen.getByRole('button', { name: /Tyrant Flycatchers/ });
      const silhouette = tyrEntry.querySelector('[data-testid="family-silhouette"]') as HTMLElement;
      expect(silhouette).not.toBeNull();
      // Light theme must use .color (#C77A2E), NOT .colorDark (#E8983E)
      expect(silhouette.style.getPropertyValue('--family-fill')).toBe('#C77A2E');
    } finally {
      if (prior === null) document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', prior);
    }
  });

  it('dark theme: swatch uses entry.silhouette.colorDark (NOT color)', () => {
    const prior = document.documentElement.getAttribute('data-theme');
    document.documentElement.setAttribute('data-theme', 'dark');
    try {
      render(
        <FamilyLegend
          silhouettes={dualSilhouettes}
          observations={dualObservations}
          familyCode={null}
          onFamilyToggle={vi.fn()}
          defaultExpanded={true}
        />,
      );
      const tyrEntry = screen.getByRole('button', { name: /Tyrant Flycatchers/ });
      const silhouette = tyrEntry.querySelector('[data-testid="family-silhouette"]') as HTMLElement;
      expect(silhouette).not.toBeNull();
      // Dark theme must use .colorDark (#E8983E), NOT .color (#C77A2E)
      expect(silhouette.style.getPropertyValue('--family-fill')).toBe('#E8983E');
    } finally {
      if (prior === null) document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', prior);
    }
  });
});

describe('DB color binding (NEW-3 fix)', () => {
  it('legend silhouette chips use the DB color from silhouettes[].color, not the grey fallback', () => {
    // The tyrannidae silhouette has color '#C77A2E' in baseSilhouettes.
    // Before the fix, every entry rendered grey (#5a6472 / null-family fallback)
    // because the legend passed paletteCode=null for all unknown family codes.
    // After the fix, the silhouette.color from the DB payload must reach
    // <FamilySilhouette color="..."> and override channel.fill.
    render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode={null}
        onFamilyToggle={vi.fn()}
        defaultExpanded={true}
      />,
    );
    // Find the tyrannidae entry's FamilySilhouette span
    const tyrEntry = screen.getByRole('button', { name: /Tyrant Flycatchers/ });
    const silhouette = tyrEntry.querySelector('[data-testid="family-silhouette"]') as HTMLElement;
    expect(silhouette).not.toBeNull();
    // Must use DB color #C77A2E, NOT the grey null-family fallback #5a6472
    expect(silhouette.style.getPropertyValue('--family-fill')).toBe('#C77A2E');
  });

  it('trochilidae legend chip uses its DB color', () => {
    render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode={null}
        onFamilyToggle={vi.fn()}
        defaultExpanded={true}
      />,
    );
    const trochEntry = screen.getByRole('button', { name: /Hummingbirds/ });
    const silhouette = trochEntry.querySelector('[data-testid="family-silhouette"]') as HTMLElement;
    expect(silhouette).not.toBeNull();
    expect(silhouette.style.getPropertyValue('--family-fill')).toBe('#7B2D8E');
  });
});

/**
 * O5 (#783) — forceCollapsed prop tests.
 *
 * AC coverage:
 *   - forceCollapsed=true renders the toggle bar only (no entries).
 *   - forceCollapsed=true does NOT call writeStoredExpanded / mutate localStorage.
 *   - aria-expanded reflects the EFFECTIVE rendered state (false when force-collapsed).
 *   - data-force-collapsed="true" attribute is present on the <aside>.
 *   - Restoring forceCollapsed=false restores the user's stored expanded state.
 *   - localStorage .v2 precedence is orthogonal to forceCollapsed.
 */
describe('O5 (#783): forceCollapsed prop', () => {
  beforeEach(() => {
    try { window.localStorage.clear(); } catch { /* jsdom only */ }
  });
  afterEach(() => {
    try { window.localStorage.clear(); } catch { /* jsdom only */ }
  });

  it('forceCollapsed=true renders toggle bar only — no family-legend-entries', () => {
    render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode={null}
        onFamilyToggle={vi.fn()}
        defaultExpanded={true}
        forceCollapsed={true}
      />,
    );
    // Entries list must be absent regardless of defaultExpanded=true
    expect(screen.queryAllByTestId('family-legend-entry')).toHaveLength(0);
    // Toggle button must still be present
    expect(
      screen.getByRole('button', { name: /bird families in view/i }),
    ).toBeInTheDocument();
  });

  it('forceCollapsed=true sets data-force-collapsed="true" on the <aside>', () => {
    const { container } = render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode={null}
        onFamilyToggle={vi.fn()}
        defaultExpanded={true}
        forceCollapsed={true}
      />,
    );
    const aside = container.querySelector('.family-legend');
    expect(aside).not.toBeNull();
    expect(aside!.getAttribute('data-force-collapsed')).toBe('true');
  });

  it('forceCollapsed=true: aria-expanded reflects effective state (false)', () => {
    render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode={null}
        onFamilyToggle={vi.fn()}
        defaultExpanded={true}
        forceCollapsed={true}
      />,
    );
    // Effective state is collapsed — aria-expanded must be false
    expect(
      screen.getByRole('button', { name: /bird families in view/i }),
    ).toHaveAttribute('aria-expanded', 'false');
  });

  it('forceCollapsed=true does NOT mutate localStorage (transient display override)', () => {
    // Set a stored expanded=true to verify it survives force-collapse
    window.localStorage.setItem(STORAGE_KEY, 'true');
    render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode={null}
        onFamilyToggle={vi.fn()}
        defaultExpanded={true}
        forceCollapsed={true}
      />,
    );
    // forceCollapsed must NOT write to localStorage
    // The stored value remains 'true' (or at minimum is NOT set to 'false')
    const stored = window.localStorage.getItem(STORAGE_KEY);
    expect(stored).toBe('true');
  });

  it('restoring forceCollapsed=false renders stored expanded state', () => {
    // User had expanded=true stored
    window.localStorage.setItem(STORAGE_KEY, 'true');
    const { rerender } = render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode={null}
        onFamilyToggle={vi.fn()}
        defaultExpanded={true}
        forceCollapsed={true}
      />,
    );
    // While force-collapsed: no entries
    expect(screen.queryAllByTestId('family-legend-entry')).toHaveLength(0);

    // Overlay dismissed — forceCollapsed=false
    rerender(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode={null}
        onFamilyToggle={vi.fn()}
        defaultExpanded={true}
        forceCollapsed={false}
      />,
    );
    // The stored expanded=true state is restored — entries are visible
    expect(screen.getAllByTestId('family-legend-entry')).toHaveLength(3);
    expect(
      screen.getByRole('button', { name: /bird families in view/i }),
    ).toHaveAttribute('aria-expanded', 'true');
  });

  it('localStorage .v2 precedence is orthogonal to forceCollapsed', () => {
    // User previously expanded on desktop — .v2 = 'true'
    window.localStorage.setItem(STORAGE_KEY, 'true');
    render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode={null}
        onFamilyToggle={vi.fn()}
        defaultExpanded={false} // responsive default says collapsed
        forceCollapsed={false}  // no force-collapse right now
      />,
    );
    // localStorage wins over defaultExpanded — entries render expanded
    expect(screen.getAllByTestId('family-legend-entry')).toHaveLength(3);
  });

  it('data-force-collapsed attribute absent when forceCollapsed=false', () => {
    const { container } = render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode={null}
        onFamilyToggle={vi.fn()}
        defaultExpanded={true}
        forceCollapsed={false}
      />,
    );
    const aside = container.querySelector('.family-legend');
    expect(aside).not.toBeNull();
    expect(aside!.getAttribute('data-force-collapsed')).toBeNull();
  });
});

/**
 * E3 (#1055) — per-breakpoint-class persistence.
 *
 * The preference key is `family-legend-expanded.v3.<tier>` where the tier comes
 * from useBreakpoint(). A desktop (wide) expand must NOT pre-open the phone
 * (compact) legend, and a live mid-session tier change must NOT clobber the new
 * tier's key with the old tier's value (the reviewer's IMPORTANT, an explicit
 * AC).
 */
describe('E3 (#1055): per-breakpoint persistence', () => {
  beforeEach(() => {
    try { window.localStorage.clear(); } catch { /* jsdom only */ }
  });
  afterEach(() => {
    try { window.localStorage.clear(); } catch { /* jsdom only */ }
  });

  it('writes the toggle under the ACTIVE tier key — a wide write does not pre-open compact', async () => {
    // Mount at the wide tier (≥1024px).
    setMatchMedia(matcherForWidth(1440));
    const user = userEvent.setup();
    render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode={null}
        onFamilyToggle={vi.fn()}
        defaultExpanded={true}
      />,
    );
    // Toggle collapses at wide → writes .v3.wide='false'.
    await user.click(screen.getByRole('button', { name: /bird families in view/i }));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('false');
    // The compact tier key was never touched — no cross-breakpoint leak.
    expect(window.localStorage.getItem(STORAGE_KEY_COMPACT)).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY_ROOMY)).toBeNull();
  });

  it('reading a compact preference does not consult the wide key', () => {
    // A compact-only stored preference (collapsed) must govern at compact even
    // when a wide preference exists and says expanded.
    setMatchMedia(matcherForWidth(390));
    window.localStorage.setItem(STORAGE_KEY_COMPACT, 'false');
    window.localStorage.setItem(STORAGE_KEY, 'true'); // wide says expanded
    render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode={null}
        onFamilyToggle={vi.fn()}
        defaultExpanded={true}
      />,
    );
    // At compact the compact key ('false') wins, NOT the wide key.
    expect(
      screen.getByRole('button', { name: /bird families in view/i }),
    ).toHaveAttribute('aria-expanded', 'false');
  });

  it('a live tier change (compact → wide) does NOT write the old expanded value into the new tier key', () => {
    // Reviewer IMPORTANT / explicit AC: toggle at compact, then drag to wide.
    // The wide key must remain untouched (read-only re-key on resize).
    setMatchMedia(matcherForWidth(390)); // start compact
    render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode={null}
        onFamilyToggle={vi.fn()}
        defaultExpanded={false}
      />,
    );
    // Expand at compact → writes .v3.compact='true'.
    act(() => {
      screen.getByRole('button', { name: /bird families in view/i }).click();
    });
    expect(window.localStorage.getItem(STORAGE_KEY_COMPACT)).toBe('true');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull(); // wide untouched

    // Live resize to wide: move the matcher then fire both queries' change.
    act(() => {
      setMatchMedia(matcherForWidth(1440));
      getMockMediaQuery(Q_COMPACT)!.dispatchChange(false);
      getMockMediaQuery(Q_ROOMY)!.dispatchChange(false);
    });

    // The wide key must NOT have been clobbered with the compact 'true' value.
    // It adopts wide's own preference instead — here none, so defaultExpanded
    // (false) governs and nothing is written for wide.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    // And the compact preference the user actually set is intact.
    expect(window.localStorage.getItem(STORAGE_KEY_COMPACT)).toBe('true');
  });

  it('a live tier change adopts the new tier stored preference (read-only re-key)', () => {
    // wide has its own stored 'false'; expanding at compact then resizing to
    // wide must adopt wide's 'false' (collapsed), not carry compact's 'true'.
    setMatchMedia(matcherForWidth(390)); // start compact
    window.localStorage.setItem(STORAGE_KEY, 'false'); // wide pref: collapsed
    render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode={null}
        onFamilyToggle={vi.fn()}
        defaultExpanded={false} // start collapsed at compact, then expand
      />,
    );
    act(() => {
      screen.getByRole('button', { name: /bird families in view/i }).click();
    });
    // Expanded at compact (writes .v3.compact='true').
    expect(
      screen.getByRole('button', { name: /bird families in view/i }),
    ).toHaveAttribute('aria-expanded', 'true');

    act(() => {
      setMatchMedia(matcherForWidth(1440));
      getMockMediaQuery(Q_COMPACT)!.dispatchChange(false);
      getMockMediaQuery(Q_ROOMY)!.dispatchChange(false);
    });

    // Adopts wide's stored 'false' → collapsed, and wide's key is unchanged.
    expect(
      screen.getByRole('button', { name: /bird families in view/i }),
    ).toHaveAttribute('aria-expanded', 'false');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('false');
  });
});

/**
 * E3 (#1055) — empty / zero-in-view honesty.
 */
describe('E3 (#1055): empty and zero-in-view states', () => {
  beforeEach(() => {
    try { window.localStorage.clear(); } catch { /* jsdom only */ }
  });
  afterEach(() => {
    try { window.localStorage.clear(); } catch { /* jsdom only */ }
  });

  it('expanded + zero entries renders one muted row and keeps aria-expanded=true', () => {
    render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={[]} // silhouettes present, but nothing in view to count
        familyCode={null}
        onFamilyToggle={vi.fn()}
        defaultExpanded={true}
      />,
    );
    // No entry rows…
    expect(screen.queryAllByTestId('family-legend-entry')).toHaveLength(0);
    // …but a muted empty row, not a bare header.
    expect(screen.getByText(/no birds in this view/i)).toBeInTheDocument();
    // aria-expanded stays truthful (the legend IS expanded).
    expect(
      screen.getByRole('button', { name: /bird families in view/i }),
    ).toHaveAttribute('aria-expanded', 'true');
  });

  it('collapsed + zero entries renders a non-interactive "No families in view" pill', () => {
    render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={[]}
        familyCode={null}
        onFamilyToggle={vi.fn()}
        defaultExpanded={false}
      />,
    );
    // The zero-state pill reads "No families in view" and is disabled — it must
    // not advertise an expand whose only result is an empty card.
    const toggle = screen.getByRole('button', { name: /no families in view/i });
    expect(toggle).toBeDisabled();
    const aside = document.querySelector('.family-legend');
    expect(aside!.getAttribute('data-empty')).toBe('true');
    // No muted empty row while collapsed (the pill itself carries the message).
    expect(screen.queryByText(/no birds in this view/i)).not.toBeInTheDocument();
  });

  it('zero-state pill restores to a live toggle when entries return', () => {
    const { rerender } = render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={[]}
        familyCode={null}
        onFamilyToggle={vi.fn()}
        defaultExpanded={false}
      />,
    );
    expect(
      screen.getByRole('button', { name: /no families in view/i }),
    ).toBeDisabled();

    // Observations return → the pill becomes a live, enabled toggle again.
    rerender(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode={null}
        onFamilyToggle={vi.fn()}
        defaultExpanded={false}
      />,
    );
    const toggle = screen.getByRole('button', { name: /bird families in view/i });
    expect(toggle).toBeEnabled();
    expect(document.querySelector('.family-legend')!.getAttribute('data-empty')).toBeNull();
  });
});

/**
 * E3 (#1055) — chevron affordance: ≥16px, points up when collapsed, down (180°
 * via data-expanded) when expanded.
 */
describe('E3 (#1055): chevron affordance', () => {
  beforeEach(() => {
    try { window.localStorage.clear(); } catch { /* jsdom only */ }
  });

  it('renders a ≥16px SVG chevron (not the old --type-xs glyph)', () => {
    const { container } = render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode={null}
        onFamilyToggle={vi.fn()}
        defaultExpanded={false}
      />,
    );
    const chevron = container.querySelector('svg.family-legend-chevron');
    expect(chevron).not.toBeNull();
    expect(chevron!.getAttribute('width')).toBe('16');
    expect(chevron!.getAttribute('height')).toBe('16');
    // aria-hidden — it is decorative; the toggle's accessible name carries state.
    expect(chevron!.getAttribute('aria-hidden')).toBe('true');
  });

  it("chevron data-expanded='false' when collapsed (points up) and 'true' when expanded", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <FamilyLegend
        silhouettes={baseSilhouettes}
        observations={baseObservations}
        familyCode={null}
        onFamilyToggle={vi.fn()}
        defaultExpanded={false}
      />,
    );
    const chevron = () => container.querySelector('svg.family-legend-chevron')!;
    // Collapsed at rest: data-expanded='false' (CSS leaves it pointing up).
    expect(chevron().getAttribute('data-expanded')).toBe('false');
    await user.click(screen.getByRole('button', { name: /bird families in view/i }));
    // Expanded: data-expanded='true' (CSS rotates 180° to point down).
    expect(chevron().getAttribute('data-expanded')).toBe('true');
  });
});

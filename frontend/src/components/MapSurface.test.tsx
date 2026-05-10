import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Observation } from '@bird-watch/shared-types';

/* Stub the heavy MapCanvas chunk so MapSurface tests don't pull in maplibre.
   The skip-link rendering is what we're asserting on, and it lives outside
   the React.lazy() boundary, so a no-op canvas is sufficient here.

   Both stubs capture their `observations` prop in module-scoped vars so
   the issue-#351 thread test can assert MapCanvas receives the FULL set
   while FamilyLegend receives the (potentially) filtered legendObservations.

   FamilyLegend is also stubbed because it consumes silhouette+observation
   data and renders its own DOM that would shadow the skip-link role queries
   in the original tests — keeping it out of the test surface narrows the
   assertion target to the skip-link only. */
let mapCanvasObservations: Observation[] | undefined;
let mapCanvasOnViewportChange:
  | ((bounds: unknown) => void)
  | undefined;
let familyLegendObservations: Observation[] | undefined;
vi.mock('./map/MapCanvas.js', () => ({
  MapCanvas: (props: {
    observations: Observation[];
    onViewportChange?: (bounds: unknown) => void;
  }) => {
    mapCanvasObservations = props.observations;
    mapCanvasOnViewportChange = props.onViewportChange;
    return <div data-testid="stub-map-canvas" />;
  },
}));
vi.mock('./FamilyLegend.js', () => ({
  FamilyLegend: (props: { observations: Observation[] }) => {
    familyLegendObservations = props.observations;
    return <div data-testid="stub-family-legend" />;
  },
}));

const { MapSurface } = await import('./MapSurface.js');

const sampleObs: Observation[] = [];

/* Helper to build an Observation for context-strip tests. */
function makeObs(overrides: Partial<Observation> & { subId: string }): Observation {
  return {
    speciesCode: 'x',
    comName: 'X',
    lat: 32.0,
    lng: -110.0,
    obsDt: '2026-04-15T12:00:00Z',
    locId: 'L1',
    locName: 'X',
    howMany: 1,
    isNotable: false,
    regionId: null,
    silhouetteId: null,
    familyCode: null,
    ...overrides,
  };
}

/* Common required-prop set for every test. The skip-link is the only
   thing under test; the rest are dummies so MapSurface mounts. */
const baseProps = {
  observations: sampleObs,
  silhouettes: [],
  familyCode: null as string | null,
  onFamilyToggle: () => {
    /* no-op */
  },
  // Phase 3 required props — use defaults for pre-existing tests.
  since: '14d' as const,
  notable: false,
  freshness: 'fresh' as const,
  freshnessLabel: 'Updated just now · Source: eBird',
};

describe('MapSurface skip-link', () => {
  it('renders a "Skip to species list" button as the first interactive element', () => {
    render(<MapSurface {...baseProps} onSkipToFeed={vi.fn()} />);
    const skip = screen.getByRole('button', { name: /Skip to species list/i });
    expect(skip).toBeInTheDocument();
    expect(skip.tagName).toBe('BUTTON');
  });

  it('uses class="skip-link" so the global stylesheet rule applies', () => {
    render(<MapSurface {...baseProps} onSkipToFeed={vi.fn()} />);
    const skip = screen.getByRole('button', { name: /Skip to species list/i });
    expect(skip.className).toContain('skip-link');
  });

  it('is a <button> (not an <a href="#feed-surface">) — App.tsx mounts surfaces mutually-exclusive so anchors do not exist', () => {
    render(<MapSurface {...baseProps} onSkipToFeed={vi.fn()} />);
    // No <a href="#feed-surface"> anywhere in this surface.
    expect(screen.queryByRole('link', { name: /Skip to species list/i })).toBeNull();
  });

  it('invokes onSkipToFeed when activated (the URL-state setter is wired by App.tsx)', () => {
    const onSkip = vi.fn();
    render(<MapSurface {...baseProps} onSkipToFeed={onSkip} />);
    const skip = screen.getByRole('button', { name: /Skip to species list/i });
    fireEvent.click(skip);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('also fires onSkipToFeed via Enter / Space (native <button> default)', () => {
    const onSkip = vi.fn();
    render(<MapSurface {...baseProps} onSkipToFeed={onSkip} />);
    const skip = screen.getByRole('button', { name: /Skip to species list/i });
    skip.focus();
    fireEvent.keyDown(skip, { key: 'Enter' });
    // jsdom does not synthesise a click on Enter for <button>, so explicitly
    // simulate the click that the browser default would dispatch. The point
    // of this test is to confirm the handler is wired to the click event,
    // which `fireEvent.click` exercises.
    fireEvent.click(skip);
    expect(onSkip).toHaveBeenCalled();
  });
});

/* ── Issue #351: legendObservations prop split ──────────────────────────
   MapSurface now optionally accepts `legendObservations` distinct from
   `observations`. When supplied, the FamilyLegend renders against the
   filtered legend set while MapCanvas continues to render against the
   full set. When omitted, both consumers receive the same array
   (preserves prior behavior for callers that didn't migrate). */

function obs(subId: string, lat: number, lng: number): Observation {
  return {
    subId,
    speciesCode: 'x',
    comName: 'X',
    lat,
    lng,
    obsDt: '2026-04-15T12:00:00Z',
    locId: 'L1',
    locName: 'X',
    howMany: 1,
    isNotable: false,
    regionId: null,
    silhouetteId: null,
    familyCode: null,
  };
}

describe('MapSurface legendObservations prop', () => {
  it('passes the legendObservations array to FamilyLegend when provided', () => {
    mapCanvasObservations = undefined;
    familyLegendObservations = undefined;
    const fullSet = [obs('A', 32.2, -110.9), obs('B', 35.2, -111.6)];
    const filtered = [fullSet[0]!];
    render(
      <MapSurface
        {...baseProps}
        observations={fullSet}
        legendObservations={filtered}
      />,
    );
    // MapCanvas always sees the full set — clustering math + auto-spider
    // depend on a stable observations identity.
    expect(mapCanvasObservations).toBe(fullSet);
    // FamilyLegend sees the (potentially) filtered set so per-family
    // counts narrate what's in the viewport.
    expect(familyLegendObservations).toBe(filtered);
  });

  it('falls back to observations for FamilyLegend when legendObservations is omitted', () => {
    mapCanvasObservations = undefined;
    familyLegendObservations = undefined;
    const fullSet = [obs('A', 32.2, -110.9)];
    render(<MapSurface {...baseProps} observations={fullSet} />);
    expect(mapCanvasObservations).toBe(fullSet);
    // No legendObservations → MapSurface defaults to observations so
    // existing callers see no behavior change.
    expect(familyLegendObservations).toBe(fullSet);
  });

  it('threads onViewportChange through to MapCanvas when provided', () => {
    mapCanvasOnViewportChange = undefined;
    const handler = vi.fn();
    render(<MapSurface {...baseProps} onViewportChange={handler} />);
    expect(mapCanvasOnViewportChange).toBe(handler);
  });

  it('does NOT pass onViewportChange to MapCanvas when omitted', () => {
    mapCanvasOnViewportChange = undefined;
    render(<MapSurface {...baseProps} />);
    // Tests that already use baseProps (no onViewportChange) shouldn't see
    // a callback on the MapCanvas. Strict-undefined matters because
    // exactOptionalPropertyTypes mode disallows passing `undefined` to an
    // optional prop — we want a true omit, not a `prop={undefined}`.
    expect(mapCanvasOnViewportChange).toBeUndefined();
  });
});

describe('Phase 3: context strip', () => {
  const baseObservations = [
    // 3 species, 3 observations
    makeObs({ subId: 's1', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher' }),
    makeObs({ subId: 's2', speciesCode: 'gilwoo', comName: 'Gila Woodpecker' }),
    makeObs({ subId: 's3', speciesCode: 'cacwre', comName: 'Cactus Wren' }),
  ];

  it('mounts <MapLede> with the default-template text', () => {
    render(
      <MapSurface
        observations={baseObservations}
        silhouettes={[]}
        familyCode={null}
        onFamilyToggle={vi.fn()}
        since="14d"
        notable={false}
        freshness="fresh"
        freshnessLabel="Updated 11 min ago · Source: eBird"
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: /3 species seen across Arizona in the last 14 days\./i })).toBeInTheDocument();
  });

  it('mounts <FilterSentence> when filters are active', () => {
    render(
      <MapSurface
        observations={baseObservations}
        silhouettes={[]}
        familyCode={null}
        onFamilyToggle={vi.fn()}
        since="14d"
        notable={true}
        freshness="fresh"
        freshnessLabel="Updated 11 min ago · Source: eBird"
      />,
    );
    // <FilterSentence> renders a span with class .filter-sentence__visible when filters are non-empty
    expect(document.querySelector('.filter-sentence__visible')).not.toBeNull();
  });

  it('renders the freshness meta line below the lede', () => {
    render(
      <MapSurface
        observations={baseObservations}
        silhouettes={[]}
        familyCode={null}
        onFamilyToggle={vi.fn()}
        since="14d"
        notable={false}
        freshness="fresh"
        freshnessLabel="Updated 11 min ago · Source: eBird"
      />,
    );
    expect(screen.getByText('Updated 11 min ago · Source: eBird')).toHaveClass('map-freshness');
  });

  it('drops period clause and shows "Last updated" copy under stale', () => {
    render(
      <MapSurface
        observations={baseObservations}
        silhouettes={[]}
        familyCode={null}
        onFamilyToggle={vi.fn()}
        since="14d"
        notable={false}
        freshness="stale"
        freshnessLabel="Last updated 9 h ago · Source: eBird"
      />,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      '3 species seen across Arizona.',
    );
    expect(screen.getByText('Last updated 9 h ago · Source: eBird')).toBeInTheDocument();
  });
});

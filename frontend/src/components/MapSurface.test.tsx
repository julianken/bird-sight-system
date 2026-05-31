import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
    silhouetteId: null,
    familyCode: null,
    ...overrides,
  };
}

/* Common required-prop set for every test. The skip-link is the only
   thing under test; the rest are dummies so MapSurface mounts.
   #800: the context-strip props (since, notable, speciesCode, freshness,
   freshnessLabel, loading, region, noFiltersActive) are REMOVED from
   MapSurface — that content moved to the AppHeader identity card. */
const baseProps = {
  observations: sampleObs,
  silhouettes: [],
  familyCode: null as string | null,
  onFamilyToggle: () => {
    /* no-op */
  },
};

// Issue #662: the "Skip to species list" skip-link + its `onSkipToFeed`
// prop were removed with the Feed view. The "Explore map markers"
// skip-link below (covered in its own describe block) is now the sole
// keyboard-bypass entry point on the map surface.
describe('MapSurface — no Feed skip-link (issue #662)', () => {
  it('does not render a "Skip to species list" button', () => {
    render(<MapSurface {...baseProps} />);
    expect(screen.queryByRole('button', { name: /Skip to species list/i })).toBeNull();
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

describe('Phase 3: context strip — REMOVED from MapSurface (#800)', () => {
  // The context strip (MapLede + FilterSentence + freshness) was moved to the
  // AppHeader identity card in #800. MapSurface no longer renders it.
  // Tests that covered the old context-strip behaviour are now in
  // AppHeader.test.tsx (lede rows) and App.test.tsx (ledeText derivation).
  //
  // This block verifies that MapSurface does NOT render the old strip.

  it('does NOT render a .map-context-strip section', () => {
    render(<MapSurface {...baseProps} />);
    expect(document.querySelector('.map-context-strip')).toBeNull();
  });

  it('does NOT render a .map-lede h1 heading', () => {
    render(<MapSurface {...baseProps} />);
    expect(document.querySelector('.map-lede')).toBeNull();
  });

  it('does NOT render a .map-freshness paragraph', () => {
    render(<MapSurface {...baseProps} />);
    expect(document.querySelector('.map-freshness')).toBeNull();
  });
});

// --- Phase 1 (#558): second skip-link "Explore map markers" --------------------

describe('MapSurface — cell popover skip-link (Phase 1, #558)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('renders "Explore map markers" as a second skip-link', async () => {
    const { MapSurface } = await import('./MapSurface.js');
    render(
      <MapSurface
        {...baseProps}
        onExploreMapMarkers={vi.fn()}
        hasMarkers={true}
      />
    );
    expect(screen.getByRole('button', { name: /Explore map markers/i })).toBeInTheDocument();
  });

  it('skip-link uses class="skip-link" so global hidden-until-focus style applies', async () => {
    const { MapSurface } = await import('./MapSurface.js');
    render(
      <MapSurface
        {...baseProps}
        onExploreMapMarkers={vi.fn()}
        hasMarkers={true}
      />
    );
    const link = screen.getByRole('button', { name: /Explore map markers/i });
    expect(link.className).toContain('skip-link');
  });

  it('clicking the skip-link calls onExploreMapMarkers prop', async () => {
    const { MapSurface } = await import('./MapSurface.js');
    const onExplore = vi.fn();
    render(
      <MapSurface
        {...baseProps}
        onExploreMapMarkers={onExplore}
        hasMarkers={true}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Explore map markers/i }));
    expect(onExplore).toHaveBeenCalledTimes(1);
  });

  it('empty viewport (hasMarkers=false): skip-link is aria-hidden and tabIndex=-1', async () => {
    const { MapSurface } = await import('./MapSurface.js');
    render(
      <MapSurface
        {...baseProps}
        onExploreMapMarkers={vi.fn()}
        hasMarkers={false}
      />
    );
    // queryByRole skips aria-hidden=true buttons; use a class-based query.
    const link = document.querySelector('[data-testid="explore-map-markers-skip-link"]') as HTMLElement | null;
    expect(link).toBeTruthy();
    expect(link!.getAttribute('aria-hidden')).toBe('true');
    expect(link!.getAttribute('tabIndex') ?? link!.tabIndex.toString()).toBe('-1');
  });
});

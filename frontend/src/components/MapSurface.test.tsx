import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { Observation } from '@bird-watch/shared-types';

/* Stub the heavy MapCanvas chunk so MapSurface tests don't pull in maplibre.
   O2 (#770): the skip-link and FamilyLegend were hoisted out of MapSurface
   to App-root siblings. MapSurface now owns only the Suspense/MapCanvas
   boundary. The stub captures observations + onViewportChange so prop-
   threading can be asserted. FamilyLegend is no longer imported by
   MapSurface, so no FamilyLegend stub is needed. */
let mapCanvasObservations: Observation[] | undefined;
let mapCanvasOnViewportChange:
  | ((bounds: unknown) => void)
  | undefined;
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

const { MapSurface } = await import('./MapSurface.js');

const sampleObs: Observation[] = [];

/* Common required-prop set for every test.
   O2 (#770): familyCode, onFamilyToggle, legendObservations,
   onExploreMapMarkers, hasMarkers are REMOVED from MapSurface — those
   moved to the App level alongside the hoisted skip-link + FamilyLegend.
   #800: context-strip props (since, notable, speciesCode, freshness, etc.)
   were already removed from MapSurface in that PR. */
const baseProps = {
  observations: sampleObs,
  silhouettes: [],
};

// Issue #662: the "Skip to species list" skip-link + its `onSkipToFeed`
// prop were removed with the Feed view.
describe('MapSurface — no Feed skip-link (issue #662)', () => {
  it('does not render a "Skip to species list" button', () => {
    render(<MapSurface {...baseProps} />);
    expect(document.querySelector('button[name="Skip to species list"]')).toBeNull();
  });
});

// O2 (#770): MapSurface NO LONGER renders the "Explore map markers" skip-link
// or the FamilyLegend — both were hoisted to persistent App-root siblings.
describe('O2 (#770): MapSurface does NOT render the hoisted overlays', () => {
  it('does NOT render the "Explore map markers" skip-link', () => {
    render(<MapSurface {...baseProps} />);
    expect(
      document.querySelector('[data-testid="explore-map-markers-skip-link"]'),
    ).toBeNull();
  });

  it('does NOT render the family-legend <aside>', () => {
    render(<MapSurface {...baseProps} />);
    expect(document.querySelector('.family-legend')).toBeNull();
  });
});

/* ── Issue #351: MapCanvas observations prop threading ─────────────────────
   MapSurface forwards its observations array directly to MapCanvas.
   The legendObservations split was removed in O2 (#770) since FamilyLegend
   now lives at App level and receives viewportObservations directly. */

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

describe('MapSurface → MapCanvas prop threading', () => {
  it('passes observations to MapCanvas', () => {
    mapCanvasObservations = undefined;
    const fullSet = [obs('A', 32.2, -110.9), obs('B', 35.2, -111.6)];
    render(<MapSurface {...baseProps} observations={fullSet} />);
    expect(mapCanvasObservations).toBe(fullSet);
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
    // Strict-undefined matters because exactOptionalPropertyTypes mode
    // disallows passing `undefined` to an optional prop — we want a true omit.
    expect(mapCanvasOnViewportChange).toBeUndefined();
  });
});

describe('Phase 3: context strip — REMOVED from MapSurface (#800)', () => {
  // The context strip (MapLede + FilterSentence + freshness) was moved to the
  // AppHeader identity card in #800. MapSurface no longer renders it.
  // Tests that covered the old context-strip behaviour are now in
  // AppHeader.test.tsx (lede rows) and App.test.tsx (ledeText derivation).

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

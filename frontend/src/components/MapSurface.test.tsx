import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Observation } from '@bird-watch/shared-types';

/* Stub the heavy MapCanvas chunk so MapSurface tests don't pull in maplibre.
   O2 (#770): the skip-link and FamilyLegend were hoisted out of MapSurface
   to App-root siblings. MapSurface now owns only the Suspense/MapCanvas
   boundary. The stub captures observations + onViewportChange so prop-
   threading can be asserted. FamilyLegend is no longer imported by
   MapSurface, so no FamilyLegend stub is needed.
   O7 (#786): `mapCanvasShouldThrow` controls whether the stub simulates a
   GL failure so the ErrorBoundary GL-recovery integration test can drive
   the full wired path (throw → fallback → "Try again" → recovery). */
let mapCanvasObservations: Observation[] | undefined;
let mapCanvasOnViewportChange:
  | ((bounds: unknown) => void)
  | undefined;
let mapCanvasShouldThrow = false;
vi.mock('./map/MapCanvas.js', () => ({
  MapCanvas: (props: {
    observations: Observation[];
    onViewportChange?: (bounds: unknown) => void;
  }) => {
    if (mapCanvasShouldThrow) throw new Error('WebGL context lost');
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

/* MapCanvas mounts behind a React.lazy()/Suspense boundary (MapSurface.tsx).
   On the FIRST render in this file the lazy chunk has not resolved yet — the
   Suspense fallback (`.map-loading-skeleton`) shows and the stub has NOT run,
   so the module-level capture vars are still undefined. The stub only runs
   once the lazy promise flushes on a later microtask. Asserting synchronously
   therefore raced the lazy boundary: whichever test ran first under
   `--sequence.shuffle` saw the unresolved state and failed (#1106). Every test
   that depends on MapCanvas having mounted (or thrown) must AWAIT the boundary
   flushing — `findByTestId` / `findByRole` retry until React settles the
   Suspense subtree. */
describe('MapSurface → MapCanvas prop threading', () => {
  it('passes observations to MapCanvas', async () => {
    mapCanvasObservations = undefined;
    const fullSet = [obs('A', 32.2, -110.9), obs('B', 35.2, -111.6)];
    render(<MapSurface {...baseProps} observations={fullSet} />);
    // Wait for the lazy MapCanvas stub to mount before reading the capture.
    await screen.findByTestId('stub-map-canvas');
    expect(mapCanvasObservations).toBe(fullSet);
  });

  it('threads onViewportChange through to MapCanvas when provided', async () => {
    mapCanvasOnViewportChange = undefined;
    const handler = vi.fn();
    render(<MapSurface {...baseProps} onViewportChange={handler} />);
    await screen.findByTestId('stub-map-canvas');
    expect(mapCanvasOnViewportChange).toBe(handler);
  });

  it('does NOT pass onViewportChange to MapCanvas when omitted', async () => {
    mapCanvasOnViewportChange = undefined;
    render(<MapSurface {...baseProps} />);
    // Must wait for the stub to mount: before the lazy boundary flushes the
    // stub has not run, so `mapCanvasOnViewportChange` would be undefined for
    // the wrong reason (the assertion would pass spuriously on an unresolved
    // boundary instead of proving the omit).
    await screen.findByTestId('stub-map-canvas');
    // Strict-undefined matters because exactOptionalPropertyTypes mode
    // disallows passing `undefined` to an optional prop — we want a true omit.
    expect(mapCanvasOnViewportChange).toBeUndefined();
  });
});

describe('Phase 3: context strip — REMOVED from MapSurface (#800)', () => {
  // The context strip (lede + FilterSentence + freshness) was moved to the
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

/* ── O7 (#786): GL-recovery integration test ────────────────────────────────
   Drives the FULL wired path: MapCanvas throws → ErrorBoundary catches it →
   GL fallback renders with "Try again" → clicking "Try again" bumps
   glRetryKey (resetKeys) → boundary clears → MapCanvas re-renders (now
   succeeding) proving in-place recovery without a page reload. */

// Suppress ErrorBoundary's componentDidCatch console.error during GL tests.
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  mapCanvasShouldThrow = false;
  vi.restoreAllMocks();
});

describe('O7 (#786): GL ErrorBoundary wiring — MapSurface in-place recovery', () => {
  it('shows the GL fallback with "Try again" when MapCanvas throws', async () => {
    mapCanvasShouldThrow = true;
    render(<MapSurface {...baseProps} />);

    // The throw happens inside the lazy MapCanvas, so the GL fallback only
    // appears once the React.lazy boundary flushes and the stub runs. `findBy`
    // retries until the boundary settles — `getBy` raced it on first render.
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Map failed to load')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();

    // The stub MapCanvas must NOT be in the DOM
    expect(screen.queryByTestId('stub-map-canvas')).toBeNull();
  });

  it('"Try again" clears the GL boundary and re-mounts MapCanvas (no page reload)', async () => {
    // First render: MapCanvas throws → boundary catches (after lazy flush).
    mapCanvasShouldThrow = true;
    render(<MapSurface {...baseProps} />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();

    // Simulate recovery: MapCanvas will succeed on the next mount
    mapCanvasShouldThrow = false;

    // Click "Try again" — bumps glRetryKey → resetKeys changes → boundary resets
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    // GL fallback must be gone; MapCanvas must be rendered. The re-mount goes
    // back through the (already-resolved) lazy boundary, so wait for the stub.
    expect(await screen.findByTestId('stub-map-canvas')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

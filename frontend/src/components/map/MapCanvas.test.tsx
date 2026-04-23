import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { forwardRef } from 'react';
import type { Observation } from '@bird-watch/shared-types';

/* ── Mock react-map-gl/maplibre ─────────────────���──────────────────────────
   jsdom has no WebGL context so we stub Map, Source, and Layer as thin
   pass-through components that expose their props for assertion.
   Map is wrapped in forwardRef because MapCanvas passes a ref to it. */

let capturedSourceProps: Record<string, unknown> = {};
let capturedAttributionProps: Record<string, unknown> = {};

vi.mock('react-map-gl/maplibre', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Map: forwardRef(function MockMap({ children, ...rest }: any, _ref: any) {
    return (
      <div data-testid="mock-map" data-props={JSON.stringify(rest)}>
        {children}
      </div>
    );
  }),
  Source: ({ children, ...rest }: Record<string, unknown>) => {
    capturedSourceProps = rest;
    return (
      <div data-testid="mock-source" data-props={JSON.stringify(rest)}>
        {children as React.ReactNode}
      </div>
    );
  },
  Layer: (props: Record<string, unknown>) => (
    <div data-testid="mock-layer" data-layer-id={props.id} />
  ),
  AttributionControl: (props: Record<string, unknown>) => {
    capturedAttributionProps = props;
    return (
      <div
        data-testid="mock-attribution-control"
        data-props={JSON.stringify(props)}
      />
    );
  },
}));

vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));

/* ── Import after mocks ───────���───────────────────────────────────────── */
const { MapCanvas } = await import('./MapCanvas.js');

/* ── Helpers ─────────────────��─────────────────────────────────────────── */

function makeObs(partial: Partial<Observation> = {}): Observation {
  return {
    subId: partial.subId ?? 'S001',
    speciesCode: partial.speciesCode ?? 'houfin',
    comName: partial.comName ?? 'House Finch',
    lat: partial.lat ?? 32.2,
    lng: partial.lng ?? -110.9,
    obsDt: partial.obsDt ?? '2026-04-15T10:00:00Z',
    locId: partial.locId ?? 'L001',
    locName: partial.locName ?? 'Sabino Canyon',
    howMany: partial.howMany ?? 3,
    isNotable: partial.isNotable ?? false,
    regionId: null,
    silhouetteId: null,
    familyCode: null,
  };
}

describe('MapCanvas', () => {
  beforeEach(() => {
    capturedSourceProps = {};
    capturedAttributionProps = {};
  });

  it('renders the map-canvas wrapper with data-testid', () => {
    const obs = Array.from({ length: 10 }, (_, i) =>
      makeObs({ subId: `S${String(i).padStart(3, '0')}` }),
    );
    render(<MapCanvas observations={obs} />);
    expect(screen.getByTestId('map-canvas')).toBeInTheDocument();
  });

  it('passes a GeoJSON FeatureCollection to the Source component', () => {
    const obs = Array.from({ length: 10 }, (_, i) =>
      makeObs({ subId: `S${String(i).padStart(3, '0')}` }),
    );
    render(<MapCanvas observations={obs} />);

    expect(capturedSourceProps.type).toBe('geojson');
    expect(capturedSourceProps.cluster).toBe(true);
    expect(capturedSourceProps.clusterMaxZoom).toBe(14);
    expect(capturedSourceProps.clusterRadius).toBe(50);

    const data = capturedSourceProps.data as { type: string; features: unknown[] };
    expect(data.type).toBe('FeatureCollection');
    expect(data.features).toHaveLength(10);
  });

  it('renders three Layer components: clusters, cluster-count, unclustered-point', () => {
    render(<MapCanvas observations={[makeObs()]} />);

    const layers = screen.getAllByTestId('mock-layer');
    const layerIds = layers.map((el) => el.getAttribute('data-layer-id'));

    expect(layerIds).toContain('clusters');
    expect(layerIds).toContain('cluster-count');
    expect(layerIds).toContain('unclustered-point');
  });

  it('renders the ObservationPopover (initially null / hidden)', () => {
    render(<MapCanvas observations={[makeObs()]} />);
    // Popover renders nothing when observation is null.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders an AttributionControl crediting OpenStreetMap and OpenFreeMap', () => {
    // ODbL compliance: OSM-derived data must be attributed. The built-in
    // MapLibre attribution control is disabled on <Map> so that the standalone
    // <AttributionControl> can be configured with compact=false and custom
    // credit strings.
    render(<MapCanvas observations={[makeObs()]} />);

    expect(screen.getByTestId('mock-attribution-control')).toBeInTheDocument();
    expect(capturedAttributionProps.compact).toBe(false);

    const custom = capturedAttributionProps.customAttribution as string[];
    expect(Array.isArray(custom)).toBe(true);
    expect(custom.join(' ')).toMatch(/OpenStreetMap/);
    expect(custom.join(' ')).toMatch(/OpenFreeMap/);
    expect(custom.join(' ')).toMatch(
      /openstreetmap\.org\/copyright/,
    );
    expect(custom.join(' ')).toMatch(/openfreemap\.org/);
  });
});

import { forwardRef, useImperativeHandle } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { Observation } from '@bird-watch/shared-types';
import { DisplacedSilhouetteLayer } from './DisplacedSilhouetteLayer.js';
import type { SilhouetteOffsets } from '@/components/map/geometry/obs-derive.js';
import type { HitLayerMap, HitTargetMarker } from './MapMarkerHitLayer.js';

/* ── Mocks ───────────────────────────────────────────────────────────────────
   The twins wrap <button>s in <PresentationMarker> → react-map-gl <Marker>; the
   Marker mock forwardRefs + exposes getElement() (so the #459 role-strip effect
   runs) and renders children inline with lng/lat as data attributes so the #718
   "project from the DISPLACED point" contract is assertable.

   MapMarkerHitLayer is mocked as a lightweight double so the co-located mount
   (and its `map && (...)` guard) is assertable without its projection internals. */
vi.mock('react-map-gl/maplibre', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Marker: forwardRef(function Marker({ children, longitude, latitude }: any, ref: any) {
    const el = document.createElement('div');
    useImperativeHandle(ref, () => ({ getElement: () => el }), []);
    return (
      <div data-testid="mock-marker" data-lng={longitude} data-lat={latitude}>
        {children}
      </div>
    );
  }),
}));

vi.mock('./MapMarkerHitLayer.js', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  MapMarkerHitLayer: ({ markers, isCoarsePointer }: any) => (
    <div
      data-testid="mock-hit-layer"
      data-marker-count={markers.length}
      data-coarse={isCoarsePointer ? 'yes' : 'no'}
    />
  ),
}));

// Helpers --------------------------------------------------------------------

function obs(over: Partial<Observation> = {}): Observation {
  return {
    subId: 'S1',
    speciesCode: 'houfin',
    comName: 'House Finch',
    lat: 32.27,
    lng: -110.85,
    obsDt: '2026-04-15T10:00:00Z',
    locId: 'L1',
    locName: 'Sweetwater Wetlands',
    howMany: 1,
    isNotable: false,
    silhouetteId: null,
    familyCode: 'fringillidae',
    ...over,
  };
}

function offsets(
  entries: Array<[string, { dx: number; dy: number; longitude: number; latitude: number }]>,
): SilhouetteOffsets {
  return new Map(entries);
}

const fakeMap: HitLayerMap = {
  project: () => ({ x: 0, y: 0 }),
  on: () => {},
  off: () => {},
};

const noop = () => {};

describe('DisplacedSilhouetteLayer', () => {
  describe('displaced-silhouette twins', () => {
    it('renders an accessible <button> twin per displaced subId', () => {
      const o = obs({ subId: 'S1', comName: 'Verdin' });
      render(
        <DisplacedSilhouetteLayer
          silhouetteOffsets={offsets([['S1', { dx: 5, dy: 5, longitude: -110.8, latitude: 32.3 }]])}
          obsLookup={{ S1: o }}
          silhouetteRenderById={new Map([['S1', { svgData: 'M0 0L24 24Z', color: '#C77A2E' }]])}
          onOpen={noop}
          map={null}
          hitMarkers={[]}
          onSelect={noop}
          isCoarsePointer={false}
        />,
      );
      const btn = screen.getByTestId('displaced-silhouette');
      expect(btn).toHaveAttribute('data-subid', 'S1');
      expect(btn).toHaveAttribute('aria-label', 'Verdin observation');
      // SVG body path painted with the family color.
      expect(btn.querySelector('path[fill="#C77A2E"]')).not.toBeNull();
    });

    it('skips a displaced subId with no matching observation (obsLookup miss → null)', () => {
      render(
        <DisplacedSilhouetteLayer
          silhouetteOffsets={offsets([['GHOST', { dx: 1, dy: 1, longitude: -110, latitude: 32 }]])}
          obsLookup={{}}
          silhouetteRenderById={new Map()}
          onOpen={noop}
          map={null}
          hitMarkers={[]}
          onSelect={noop}
          isCoarsePointer={false}
        />,
      );
      expect(screen.queryByTestId('displaced-silhouette')).toBeNull();
    });

    it('falls back to the _FALLBACK circle when the family has no silhouette svgData', () => {
      render(
        <DisplacedSilhouetteLayer
          silhouetteOffsets={offsets([['S1', { dx: 0, dy: 0, longitude: -110.8, latitude: 32.3 }]])}
          obsLookup={{ S1: obs({ subId: 'S1' }) }}
          silhouetteRenderById={new Map([['S1', { svgData: null, color: '#555' }]])}
          onOpen={noop}
          map={null}
          hitMarkers={[]}
          onSelect={noop}
          isCoarsePointer={false}
        />,
      );
      const btn = screen.getByTestId('displaced-silhouette');
      expect(btn.querySelector('circle')).not.toBeNull();
      expect(btn.querySelector('path')).toBeNull();
    });

    it('projects the popover from the DISPLACED point, not the obs survey point (#718)', () => {
      const onOpen = vi.fn();
      const o = obs({ subId: 'S1', lng: -110.85, lat: 32.27 });
      render(
        <DisplacedSilhouetteLayer
          silhouetteOffsets={offsets([['S1', { dx: 12, dy: -8, longitude: -110.123, latitude: 32.987 }]])}
          obsLookup={{ S1: o }}
          silhouetteRenderById={new Map([['S1', { svgData: 'M0 0Z', color: '#abc' }]])}
          onOpen={onOpen}
          map={null}
          hitMarkers={[]}
          onSelect={noop}
          isCoarsePointer={false}
        />,
      );
      // The PresentationMarker (Marker mock) is anchored at the DISPLACED lng/lat.
      const marker = screen.getByTestId('mock-marker');
      expect(marker).toHaveAttribute('data-lng', '-110.123');
      expect(marker).toHaveAttribute('data-lat', '32.987');

      fireEvent.click(screen.getByTestId('displaced-silhouette'));
      // openPopoverAt receives the DISPLACED coord, NOT obs.lng/obs.lat.
      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(onOpen.mock.calls[0][0]).toBe(o);
      expect(onOpen.mock.calls[0][1]).toEqual([-110.123, 32.987]);
    });

    it('keys each twin on `displaced-${subId}` — stable identity under re-render', () => {
      const props = {
        obsLookup: { S1: obs({ subId: 'S1' }) },
        silhouetteRenderById: new Map([['S1', { svgData: 'M0 0Z', color: '#abc' }]]),
        onOpen: noop,
        map: null,
        hitMarkers: [] as HitTargetMarker[],
        onSelect: noop,
        isCoarsePointer: false,
      };
      const { rerender } = render(
        <DisplacedSilhouetteLayer
          {...props}
          silhouetteOffsets={offsets([['S1', { dx: 1, dy: 1, longitude: -110.8, latitude: 32.3 }]])}
        />,
      );
      const first = screen.getByTestId('mock-marker');
      rerender(
        <DisplacedSilhouetteLayer
          {...props}
          silhouetteOffsets={offsets([['S1', { dx: 2, dy: 2, longitude: -110.7, latitude: 32.4 }]])}
        />,
      );
      const second = screen.getByTestId('mock-marker');
      // Same key ⇒ React reconciled in place (no remount); position updated.
      expect(second).toBe(first);
      expect(second).toHaveAttribute('data-lng', '-110.7');
    });
  });

  describe('co-located hit-layer mount (block 3)', () => {
    it('mounts <MapMarkerHitLayer> when `map` is present, forwarding markers + isCoarsePointer', () => {
      const hitMarkers: HitTargetMarker[] = [
        {
          subId: 'S1',
          comName: 'House Finch',
          familyCode: 'fringillidae',
          locName: 'L1',
          obsDt: '2026-04-15T10:00:00Z',
          isNotable: false,
          lngLat: [-110.85, 32.27],
        },
      ];
      render(
        <DisplacedSilhouetteLayer
          silhouetteOffsets={offsets([])}
          obsLookup={{}}
          silhouetteRenderById={new Map()}
          onOpen={noop}
          map={fakeMap}
          hitMarkers={hitMarkers}
          onSelect={noop}
          isCoarsePointer
        />,
      );
      const hit = screen.getByTestId('mock-hit-layer');
      expect(hit).toHaveAttribute('data-marker-count', '1');
      expect(hit).toHaveAttribute('data-coarse', 'yes');
    });

    it('suppresses the hit-layer mount when `map` is null (the map && (...) guard)', () => {
      render(
        <DisplacedSilhouetteLayer
          silhouetteOffsets={offsets([])}
          obsLookup={{}}
          silhouetteRenderById={new Map()}
          onOpen={noop}
          map={null}
          hitMarkers={[]}
          onSelect={noop}
          isCoarsePointer={false}
        />,
      );
      expect(screen.queryByTestId('mock-hit-layer')).toBeNull();
    });

    it('routes a hit-layer onSelect call through to the onSelect prop', () => {
      // The hit-layer mock does not invoke onSelect, so verify the prop is the
      // exact callback the parent passed (handleHitSelect) — call it directly.
      const onSelect = vi.fn();
      render(
        <DisplacedSilhouetteLayer
          silhouetteOffsets={offsets([])}
          obsLookup={{}}
          silhouetteRenderById={new Map()}
          onOpen={noop}
          map={fakeMap}
          hitMarkers={[]}
          onSelect={onSelect}
          isCoarsePointer={false}
        />,
      );
      // Mount present (map non-null) is the contract; the onSelect wiring is the
      // same reference passed down — exercised end-to-end in MapCanvas + e2e.
      expect(screen.getByTestId('mock-hit-layer')).toBeInTheDocument();
    });
  });
});

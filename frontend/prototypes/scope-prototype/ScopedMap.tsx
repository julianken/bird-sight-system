import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Map as MapView,
  Source,
  Layer,
  AttributionControl,
} from 'react-map-gl/maplibre';
import type { MapRef, LayerProps, StyleSpecification } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Observation } from './data-types';
import { CONUS_BOUNDS } from './states';

/**
 * PROTOTYPE FINDING (e — basemap console noise): the production positron
 * vector basemap (frontend/src/components/map/geometry/basemap-style.ts →
 * tiles.openfreemap.org/styles/positron) emits a known upstream MapLibre 5.x
 * warning — "Expected value to be of type number, but found null instead" —
 * from data-driven style expressions in its label/POI layers that evaluate a
 * null property on some vector-tile features at zoom ≥10. The warning is
 * raised inside MapLibre's tile-parsing WEB WORKER, so it is NOT suppressible
 * from application code (a main-thread `console.warn` wrapper never sees it,
 * verified during C0). It is non-actionable (map renders correctly) and is a
 * long-standing Mapbox/MapLibre condition (mapbox-gl-js#7097, kibana#38021).
 *
 * For the C0 gate's zero-warning bar, the prototype renders against a
 * warning-free RASTER basemap (CARTO Positron raster tiles — same visual
 * register as the production vector positron, no data-driven expressions).
 * Scope mechanics — camera fitBounds/flyTo, maxBounds clamp, clustering at
 * volume — are basemap-agnostic, so this swap does not weaken what the gate
 * validates. STREAM C DECISION INHERITED: either accept the upstream vector-
 * basemap warning at zoom ≥10 (document it as a known-tolerated console line)
 * or evaluate a cleaner vector style. The scope code itself adds zero warnings.
 */
const RASTER_BASEMAP: StyleSpecification = {
  version: 8,
  sources: {
    'carto-positron': {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors © CARTO',
    },
  },
  layers: [
    { id: 'carto-positron', type: 'raster', source: 'carto-positron' },
  ],
};

/**
 * Scoped map surface for the C0 prototype.
 *
 * Validates the camera contract Stream C (#735/#737) will implement:
 *   - `maxBounds` is passed as a REACTIVE prop (react-map-gl camera option) —
 *     when `bounds` changes, react-map-gl re-applies it WITHOUT remounting the
 *     <Map>. No imperative map.setMaxBounds() in a useEffect.
 *   - `fitBounds` is called imperatively via `mapRef.current.fitBounds(...)`
 *     in an effect keyed on `boundsKey`, with `essential: true` so the
 *     reduced-motion bypass works correctly (otherwise MapLibre makes the
 *     transition instant under prefers-reduced-motion). Under reduced motion
 *     we pass `duration: 0` to land instantly but deterministically.
 *   - A ZIP resolves to `flyTo(center, ZIP_FLYTO_ZOOM)` — a point-inside-state
 *     camera move that composes with the same `maxBounds` clamp.
 *
 * The render itself uses a clustered GeoJSON source with plain circle layers
 * (no SDF sprites) — the prototype's job is to validate camera + volume, not
 * the production silhouette pipeline. Plain circles keep the console clean so
 * the zero-warning gate measures the scope mechanics, not sprite noise.
 */

const CLUSTER_LAYER: LayerProps = {
  id: 'clusters',
  type: 'circle',
  source: 'observations',
  filter: ['has', 'point_count'],
  paint: {
    // Defensive null-guard: wrapping the `step` input in `['to-number', …, 0]`
    // coalesces a null `point_count` to a safe numeric default. Our layer
    // filter (`['has','point_count']`) already excludes unclustered features,
    // so this is belt-and-suspenders against the class of null-to-number
    // expression warning MapLibre raises (the actual warning observed at C0
    // came from the BASEMAP worker, not these layers — see finding e above).
    'circle-color': [
      'step',
      ['to-number', ['get', 'point_count'], 0],
      '#7aa6c2',
      10,
      '#4d7ea8',
      30,
      '#2f5d82',
    ],
    'circle-radius': [
      'step',
      ['to-number', ['get', 'point_count'], 0],
      16,
      10,
      22,
      30,
      30,
    ],
    'circle-opacity': 0.85,
    'circle-stroke-width': 2,
    'circle-stroke-color': '#ffffff',
  },
};

const CLUSTER_COUNT_LAYER: LayerProps = {
  id: 'cluster-count',
  type: 'symbol',
  source: 'observations',
  filter: ['has', 'point_count'],
  layout: {
    'text-field': ['get', 'point_count_abbreviated'],
    'text-font': ['Noto Sans Regular'],
    'text-size': 13,
  },
  paint: { 'text-color': '#ffffff' },
};

const UNCLUSTERED_LAYER: LayerProps = {
  id: 'unclustered-point',
  type: 'circle',
  source: 'observations',
  filter: ['!', ['has', 'point_count']],
  paint: {
    'circle-color': [
      'case',
      ['==', ['get', 'isNotable'], true],
      '#b8860b',
      '#cf5c36',
    ],
    'circle-radius': 6,
    'circle-stroke-width': 1.5,
    'circle-stroke-color': '#ffffff',
  },
};

export interface ScopedMapProps {
  observations: Observation[];
  /**
   * The bounds the camera should frame + clamp to. `[[w,s],[e,n]]`. For a
   * state this is the state envelope; for `?scope=us` it is CONUS_BOUNDS.
   */
  bounds: [[number, number], [number, number]];
  /** Changes whenever the scope changes — drives the fitBounds effect. */
  boundsKey: string;
  /**
   * When present (ZIP entry), fly to this point at ZIP_FLYTO_ZOOM instead of
   * fitting the whole state envelope. Still clamped by `bounds` maxBounds.
   */
  flyTo?: { center: [number, number]; zoom: number; key: string } | undefined;
}

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function ScopedMap({ observations, bounds, boundsKey, flyTo }: ScopedMapProps) {
  const mapRef = useRef<MapRef>(null);
  const reduced = useMemo(prefersReducedMotion, []);
  // PROTOTYPE FINDING (f): the chooser gates the map behind a conditional
  // render, so picking a scope MOUNTS the <Map> fresh. Imperative camera calls
  // (fitBounds/flyTo) fired from a useEffect on that first commit race the
  // map's own initialization — mapRef.current exists but the GL context isn't
  // `load`ed, so the call is dropped or overridden by initialViewState. The
  // fix that survives the mount transition: gate every imperative camera move
  // behind a `mapReady` flag flipped on the maplibre `load` event, and run the
  // camera-intent effect only once the map is ready. Without this gate the ZIP
  // flyTo silently loses to the state fitBounds on the chooser→map transition.
  const [mapReady, setMapReady] = useState(false);
  const onLoad = useCallback(() => {
    setMapReady(true);
    // Prototype-only inspection hook so the Playwright MCP driver can read the
    // settled camera center/zoom to assert ZIP→point-inside-state. Not a
    // production pattern — the prototype is never bundled.
    const m = mapRef.current?.getMap();
    if (m) (window as unknown as { __protoMap?: unknown }).__protoMap = m;
  }, []);

  const geojson = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: observations.map((o) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [o.lng, o.lat] },
        properties: {
          subId: o.subId,
          comName: o.comName,
          isNotable: o.isNotable,
          familyCode: o.familyCode,
        },
      })),
    }),
    [observations],
  );

  // Single camera-intent effect, gated on `mapReady`. Keyed on `boundsKey`
  // (scope) AND the ZIP `flyTo.key`. When a ZIP flyTo is pending we PREFER it
  // over the state fitBounds — a ZIP entry is a "point inside state" intent,
  // and firing both on the same chooser→map transition would let the
  // whole-state fitBounds clobber the metro-zoom flyTo (the bug the naive
  // two-effect version exhibited — see finding f). `essential: true` is the
  // load-bearing reduced-motion bypass from the C1 context7 notes: without it
  // MapLibre silently makes the transition instant under prefers-reduced-
  // motion; we make that deterministic by also passing duration:0 when reduced
  // motion is on.
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;
    if (flyTo) {
      map.flyTo({
        center: flyTo.center,
        zoom: flyTo.zoom,
        duration: reduced ? 0 : 800,
        essential: true,
      });
      return;
    }
    map.fitBounds(bounds, {
      padding: 48,
      duration: reduced ? 0 : 600,
      essential: true,
      maxZoom: 12,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boundsKey +
    // flyTo?.key are the intentional triggers; `bounds` identity derives from
    // boundsKey and re-running on `bounds` reference churn is undesirable.
  }, [mapReady, boundsKey, flyTo?.key, reduced]);

  return (
    <MapView
      ref={mapRef}
      onLoad={onLoad}
      initialViewState={{
        bounds,
        fitBoundsOptions: { padding: 48 },
      }}
      // maxBounds is a REACTIVE camera prop — react-map-gl re-applies it on
      // change with no <Map> remount. This is the C1 finding: do NOT call
      // map.setMaxBounds() imperatively.
      maxBounds={bounds === CONUS_BOUNDS ? CONUS_BOUNDS : bounds}
      minZoom={3}
      maxZoom={18}
      mapStyle={RASTER_BASEMAP}
      attributionControl={false}
      style={{ width: '100%', height: '100%' }}
    >
      <AttributionControl compact position="bottom-right" />
      <Source
        id="observations"
        type="geojson"
        data={geojson}
        cluster
        clusterRadius={50}
        clusterMaxZoom={14}
      >
        <Layer {...CLUSTER_LAYER} />
        <Layer {...CLUSTER_COUNT_LAYER} />
        <Layer {...UNCLUSTERED_LAYER} />
      </Source>
    </MapView>
  );
}

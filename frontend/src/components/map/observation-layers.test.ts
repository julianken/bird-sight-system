import { describe, it, expect } from 'vitest';
import type { Observation } from '@bird-watch/shared-types';
import {
  observationsToGeoJson,
  buildClusterLayerSpec,
  buildClusterCountLayerSpec,
  buildUnclusteredPointLayerSpec,
  CLUSTER_MAX_ZOOM,
  CLUSTER_RADIUS,
  CLUSTER_MOSAIC_MAX_POINTS,
} from './observation-layers.js';

function makeObs(partial: Partial<Observation> = {}): Observation {
  return {
    subId: partial.subId ?? 'S001',
    speciesCode: partial.speciesCode ?? 'houfin',
    comName: partial.comName ?? 'House Finch',
    lat: partial.lat ?? 32.2,
    lng: partial.lng ?? -110.9,
    obsDt: partial.obsDt ?? '2026-04-15T10:00:00Z',
    locId: partial.locId ?? 'L001',
    locName: 'locName' in partial ? (partial.locName as string | null) : 'Sabino Canyon',
    howMany: 'howMany' in partial ? (partial.howMany as number | null) : 3,
    isNotable: partial.isNotable ?? false,
    regionId: null,
    silhouetteId: null,
    familyCode: 'familyCode' in partial ? (partial.familyCode as string | null) : null,
  };
}

describe('observationsToGeoJson', () => {
  it('returns a FeatureCollection with the correct number of features', () => {
    const obs = Array.from({ length: 5 }, (_, i) =>
      makeObs({ subId: `S00${i}` }),
    );
    const result = observationsToGeoJson(obs);

    expect(result.type).toBe('FeatureCollection');
    expect(result.features).toHaveLength(5);
  });

  it('maps observation fields to GeoJSON properties', () => {
    const obs = makeObs({
      subId: 'S999',
      comName: 'Vermilion Flycatcher',
      locName: 'Sweetwater Wetlands',
      obsDt: '2026-04-16T08:30:00Z',
      howMany: 2,
      isNotable: true,
    });
    const result = observationsToGeoJson([obs]);
    const feature = result.features[0]!;

    expect(feature.type).toBe('Feature');
    expect(feature.geometry.type).toBe('Point');
    expect(feature.geometry.coordinates).toEqual([-110.9, 32.2]);
    expect(feature.properties.subId).toBe('S999');
    expect(feature.properties.comName).toBe('Vermilion Flycatcher');
    expect(feature.properties.locName).toBe('Sweetwater Wetlands');
    expect(feature.properties.obsDt).toBe('2026-04-16T08:30:00Z');
    expect(feature.properties.howMany).toBe(2);
    expect(feature.properties.isNotable).toBe(true);
  });

  it('returns an empty FeatureCollection for zero observations', () => {
    const result = observationsToGeoJson([]);
    expect(result.type).toBe('FeatureCollection');
    expect(result.features).toHaveLength(0);
  });

  it('handles null locName and null howMany', () => {
    const obs = makeObs({ locName: null, howMany: null });
    const result = observationsToGeoJson([obs]);
    const props = result.features[0]!.properties;

    expect(props.locName).toBeNull();
    expect(props.howMany).toBeNull();
  });

  it('threads familyCode through to GeoJSON properties (mosaic source — issue #248)', () => {
    // The cluster-mosaic reconciler aggregates leaves by familyCode via
    // GeoJSONSource.getClusterLeaves. Each leaf is a GeoJSON Feature, so the
    // familyCode must round-trip through observationsToGeoJson into the
    // feature properties — otherwise the aggregation is silently empty and
    // every mosaic renders the FALLBACK silhouette.
    const obs = makeObs({ familyCode: 'tyrannidae' });
    const result = observationsToGeoJson([obs]);
    const props = result.features[0]!.properties;
    expect(props.familyCode).toBe('tyrannidae');
  });

  it('preserves null familyCode (uncurated species per issue #246)', () => {
    // The Read API LEFT-JOINs species_meta and yields NULL when a species is
    // absent from the seed. The mosaic must treat null as "skip this leaf"
    // rather than throw, so the property must serialize as null (not
    // undefined or omitted) — matches the Observation type contract.
    const obs = makeObs({ familyCode: null });
    const result = observationsToGeoJson([obs]);
    const props = result.features[0]!.properties;
    expect(props.familyCode).toBeNull();
  });
});

describe('layer specs', () => {
  it('unclustered-point paint uses isNotable case expression', () => {
    const spec = buildUnclusteredPointLayerSpec();
    expect(spec.id).toBe('unclustered-point');
    expect(spec.type).toBe('circle');

    // The paint expression should reference 'isNotable' via a case expression.
    const paint = spec.paint as Record<string, unknown>;
    const circleColor = paint['circle-color'] as unknown[];
    expect(circleColor[0]).toBe('case');
    expect(circleColor[1]).toEqual(['get', 'isNotable']);
    // Third element is the notable colour (string), fourth is common colour.
    expect(typeof circleColor[2]).toBe('string');
    expect(typeof circleColor[3]).toBe('string');
  });

  it('unclustered-point circle radius is 10-12px for mobile touch targets', () => {
    const spec = buildUnclusteredPointLayerSpec();
    const paint = spec.paint as Record<string, unknown>;
    const radius = paint['circle-radius'] as number;
    expect(radius).toBeGreaterThanOrEqual(10);
    expect(radius).toBeLessThanOrEqual(12);
  });

  it('cluster layer filters to clusters with more than 8 points (mosaic threshold)', () => {
    // Issue #248: clusters with point_count <= 8 render an HTML <Marker>
    // mosaic instead of the colored circle. The two surfaces must NOT
    // overlap — pin the boundary in the spec so a future filter loosen
    // (e.g. ['has', 'point_count']) gets caught here, not in production
    // where a circle would render under the mosaic.
    const spec = buildClusterLayerSpec();
    expect(spec.id).toBe('clusters');
    expect(spec.type).toBe('circle');
    expect(spec.filter).toEqual([
      'all',
      ['has', 'point_count'],
      ['>', ['get', 'point_count'], 8],
    ]);
  });

  it('cluster-count layer renders point_count_abbreviated for large clusters only', () => {
    const spec = buildClusterCountLayerSpec();
    expect(spec.id).toBe('cluster-count');
    expect(spec.type).toBe('symbol');
    // Same threshold as the cluster circle layer — count text only renders
    // INSIDE the circle (point_count > 8). Mosaic markers carry their own
    // count badge in HTML, so duplicating it here would double-render.
    expect(spec.filter).toEqual([
      'all',
      ['has', 'point_count'],
      ['>', ['get', 'point_count'], 8],
    ]);
    const layout = spec.layout as Record<string, unknown>;
    expect(layout['text-field']).toEqual(['get', 'point_count_abbreviated']);
    // Must declare a font present in the basemap glyph stack (Noto Sans on
    // OpenFreeMap positron). Omitting this falls back to Open Sans Regular,
    // which 404s against tiles.openfreemap.org.
    expect(layout['text-font']).toEqual(['Noto Sans Regular']);
  });

  it('exports CLUSTER_MOSAIC_MAX_POINTS=8 as the mosaic-vs-circle threshold', () => {
    // Issue #248 boundary token. The reconciler in MapCanvas reads this
    // same constant when filtering rendered cluster features for HTML
    // marker generation; pinning it as a named export keeps the layer
    // filter and the React reconciler in sync.
    expect(CLUSTER_MOSAIC_MAX_POINTS).toBe(8);
  });
});

describe('cluster defaults', () => {
  it('CLUSTER_RADIUS is 50', () => {
    expect(CLUSTER_RADIUS).toBe(50);
  });

  it('CLUSTER_MAX_ZOOM is 14', () => {
    expect(CLUSTER_MAX_ZOOM).toBe(14);
  });
});

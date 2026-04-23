import { describe, it, expect } from 'vitest';
import type { Observation } from '@bird-watch/shared-types';
import {
  observationsToGeoJson,
  buildClusterLayerSpec,
  buildClusterCountLayerSpec,
  buildUnclusteredPointLayerSpec,
  CLUSTER_MAX_ZOOM,
  CLUSTER_RADIUS,
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
    familyCode: null,
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

  it('cluster layer filters to features with point_count', () => {
    const spec = buildClusterLayerSpec();
    expect(spec.id).toBe('clusters');
    expect(spec.type).toBe('circle');
    expect(spec.filter).toEqual(['has', 'point_count']);
  });

  it('cluster-count layer renders point_count_abbreviated', () => {
    const spec = buildClusterCountLayerSpec();
    expect(spec.id).toBe('cluster-count');
    expect(spec.type).toBe('symbol');
    const layout = spec.layout as Record<string, unknown>;
    expect(layout['text-field']).toEqual(['get', 'point_count_abbreviated']);
    // Must declare a font present in the basemap glyph stack (Noto Sans on
    // OpenFreeMap positron). Omitting this falls back to Open Sans Regular,
    // which 404s against tiles.openfreemap.org.
    expect(layout['text-font']).toEqual(['Noto Sans Regular']);
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

import { describe, it, expect } from 'vitest';
import type { FamilySilhouette, Observation } from '@bird-watch/shared-types';
import {
  observationsToGeoJson,
  buildClusterLayerSpec,
  buildClusterCountLayerSpec,
  buildUnclusteredPointLayerSpec,
  buildNotableRingLayerSpec,
  CLUSTER_MAX_ZOOM,
  CLUSTER_RADIUS,
  FALLBACK_SILHOUETTE_ID,
} from './observation-layers.js';
import { FAMILY_COLOR_FALLBACK } from '../../data/family-color.js';

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
    silhouetteId: 'silhouetteId' in partial ? (partial.silhouetteId as string | null) : null,
    familyCode: 'familyCode' in partial ? (partial.familyCode as string | null) : null,
  };
}

function makeSilhouette(partial: Partial<FamilySilhouette> & { familyCode: string }): FamilySilhouette {
  return {
    familyCode: partial.familyCode,
    color: partial.color ?? '#123456',
    // svgData is nullable in the shared type, and the test for the
    // "row exists but svgData is NULL" case explicitly passes null. Use
    // `'svgData' in partial` so an explicit null isn't replaced by the
    // default — `??` would have collapsed null → fallback.
    svgData: 'svgData' in partial ? (partial.svgData as string | null) : 'M0 0 L1 1',
    source: partial.source ?? null,
    license: partial.license ?? null,
    commonName: partial.commonName ?? null,
    creator: partial.creator ?? null,
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

  it('joins silhouettes by familyCode → properties.silhouetteId, color', () => {
    const obs = makeObs({
      subId: 'S100',
      familyCode: 'tyrannidae',
      silhouetteId: 'tyrannidae',
    });
    const silhouettes = [
      makeSilhouette({ familyCode: 'tyrannidae', color: '#C77A2E' }),
    ];
    const result = observationsToGeoJson([obs], silhouettes);
    const props = result.features[0]!.properties;

    expect(props.familyCode).toBe('tyrannidae');
    // silhouetteId resolves to a sprite id present in addImage(...).
    expect(props.silhouetteId).toBe('tyrannidae');
    expect(props.color).toBe('#C77A2E');
  });

  it('maps unknown families to FALLBACK silhouette + fallback color', () => {
    const obs = makeObs({ familyCode: 'no-such-family', silhouetteId: null });
    const silhouettes = [
      makeSilhouette({ familyCode: 'tyrannidae', color: '#C77A2E' }),
    ];
    const result = observationsToGeoJson([obs], silhouettes);
    const props = result.features[0]!.properties;

    expect(props.familyCode).toBe('no-such-family');
    expect(props.silhouetteId).toBe(FALLBACK_SILHOUETTE_ID);
    expect(props.color).toBe(FAMILY_COLOR_FALLBACK);
  });

  it('maps null familyCode to FALLBACK silhouette + fallback color', () => {
    const obs = makeObs({ familyCode: null, silhouetteId: null });
    const result = observationsToGeoJson([obs], []);
    const props = result.features[0]!.properties;

    expect(props.familyCode).toBeNull();
    expect(props.silhouetteId).toBe(FALLBACK_SILHOUETTE_ID);
    expect(props.color).toBe(FAMILY_COLOR_FALLBACK);
  });

  it('maps families whose silhouette row exists but svgData is NULL to FALLBACK', () => {
    // Per #245, three families (cuculidae, ptilogonatidae, remizidae) have
    // svgData = NULL because no usable Phylopic silhouette was available.
    // The _FALLBACK consumer must render these too — same shape, family color
    // preserved via the join.
    const obs = makeObs({
      familyCode: 'cuculidae',
      silhouetteId: 'cuculidae',
    });
    const silhouettes = [
      makeSilhouette({ familyCode: 'cuculidae', color: '#5E4A20', svgData: null }),
    ];
    const result = observationsToGeoJson([obs], silhouettes);
    const props = result.features[0]!.properties;

    expect(props.silhouetteId).toBe(FALLBACK_SILHOUETTE_ID);
    // Family color is still resolved — preserves family-color signal
    // even when the shape falls back.
    expect(props.color).toBe('#5E4A20');
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
  it('unclustered-point is a symbol layer rendering per-feature silhouettes', () => {
    // Issue #246: replaced the legacy circle layer with an SDF symbol layer.
    // Each feature renders its family's silhouette via icon-image, tinted by
    // the per-feature color property (sourced from the silhouettes join in
    // observationsToGeoJson).
    const spec = buildUnclusteredPointLayerSpec();
    expect(spec.id).toBe('unclustered-point');
    expect(spec.type).toBe('symbol');
    expect(spec.filter).toEqual(['!', ['has', 'point_count']]);

    const layout = spec.layout as Record<string, unknown>;
    // icon-image reads the per-feature silhouette id (resolved to a sprite
    // registered with map.addImage(...) in MapCanvas).
    expect(layout['icon-image']).toEqual(['get', 'silhouetteId']);
    // Avoid clipping at high marker density — overlapping silhouettes
    // are an acceptable tradeoff vs dropping markers entirely.
    expect(layout['icon-allow-overlap']).toBe(true);
    expect(layout['icon-ignore-placement']).toBe(true);

    const paint = spec.paint as Record<string, unknown>;
    // SDF tint sourced from the per-feature color property — this is what
    // makes the silhouettes share the family color from the legend.
    expect(paint['icon-color']).toEqual(['get', 'color']);
    // _FALLBACK silhouette renders at 50% opacity so missing-Phylopic
    // families read as "we don't have a shape for this" instead of
    // visually equal to the rest.
    expect(paint['icon-opacity']).toEqual([
      'case',
      ['==', ['get', 'silhouetteId'], FALLBACK_SILHOUETTE_ID],
      0.5,
      1.0,
    ]);
  });

  it('notable-ring layer is a circle layer filtered to notable observations', () => {
    // Issue #246: notable observations get an amber halo INSTEAD of body
    // tint — preserves the family-color signal of the silhouette body.
    const spec = buildNotableRingLayerSpec();
    expect(spec.id).toBe('notable-ring');
    expect(spec.type).toBe('circle');
    // Filter: not-clustered AND notable.
    expect(spec.filter).toEqual([
      'all',
      ['!', ['has', 'point_count']],
      ['==', ['get', 'isNotable'], true],
    ]);

    const paint = spec.paint as Record<string, unknown>;
    // Hollow ring — fill is transparent, stroke is the amber accent token.
    expect(paint['circle-color']).toBe('rgba(0,0,0,0)');
    expect(paint['circle-stroke-width']).toBeGreaterThanOrEqual(2);
    expect(typeof paint['circle-stroke-color']).toBe('string');
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

  it('FALLBACK_SILHOUETTE_ID is "_FALLBACK"', () => {
    // Matches family_code = '_FALLBACK' seeded by migration 1700000018000.
    expect(FALLBACK_SILHOUETTE_ID).toBe('_FALLBACK');
  });
});

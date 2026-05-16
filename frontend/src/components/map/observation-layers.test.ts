import { describe, it, expect } from 'vitest';
import type { FamilySilhouette, Observation } from '@bird-watch/shared-types';
import {
  observationsToGeoJson,
  buildClusterLayerSpec,
  buildClusterCountLayerSpec,
  buildClustersHitLayerSpec,
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

  it('threads speciesCode through to feature properties (#557)', () => {
    const out = observationsToGeoJson(
      [
        {
          subId: 'S1', speciesCode: 'coohaw', comName: "Cooper's Hawk",
          locName: 'Tucson', obsDt: '2026-05-15', howMany: 1, isNotable: false,
          familyCode: 'accipitridae', silhouetteId: 'accipitridae',
          lng: -110, lat: 32,
          locId: 'L1',
        } as Observation,
      ],
      [],
    );
    expect(out.features[0]?.properties.speciesCode).toBe('coohaw');
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
    // Epic #539 cutover: inStack filter removed alongside auto-spider.
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
    // visually equal to the rest. The first branch (issue #554 scope
    // expansion 2026-05-15) drops opacity to 0 for silhouettes whose
    // displaced React twin is rendered by MapCanvas — keyed by the
    // `hidden` feature-state set via promoteId="subId".
    expect(paint['icon-opacity']).toEqual([
      'case',
      ['boolean', ['feature-state', 'hidden'], false], 0,
      ['==', ['get', 'silhouetteId'], FALLBACK_SILHOUETTE_ID], 0.5,
      1.0,
    ]);
  });

  it('notable-ring layer is a circle layer filtered to notable observations', () => {
    // Issue #246: notable observations get an amber halo INSTEAD of body
    // tint — preserves the family-color signal of the silhouette body.
    const spec = buildNotableRingLayerSpec();
    expect(spec.id).toBe('notable-ring');
    expect(spec.type).toBe('circle');
    // Filter: not-clustered AND notable. Epic #539: inStack guard removed
    // alongside auto-spider.
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

  // Phase 3: cluster-paint-suppression tests replace the pre-Phase-3
  // paint-expression assertions. The MapLibre cluster SOURCE still runs
  // (for point_count aggregation), but no canvas paint is drawn —
  // <ClusterPillOverlay> reads cluster features via queryRenderedFeatures
  // on the 'clusters-hit' layer and renders a React <Marker> per cluster.
  describe('buildClusterLayerSpec (Phase 3 — pills replace circle paint)', () => {
    it('returns a layer that never matches features (paint suppressed by filter)', () => {
      const spec = buildClusterLayerSpec();
      expect(spec.id).toBe('clusters');
      expect(spec.type).toBe('circle');
      // Phase 3 suppression: filter is set to a never-true expression so
      // the canvas never paints a cluster circle. The cluster source
      // itself still computes point_count for the React overlay to read.
      expect(spec.filter).toEqual(['boolean', false]);
    });

    it('cluster-count layer also never matches', () => {
      const spec = buildClusterCountLayerSpec();
      expect(spec.id).toBe('cluster-count');
      expect(spec.filter).toEqual(['boolean', false]);
    });

    it('imports CLUSTER_TIER_BOUNDARIES from frontend/src/config/cluster.ts', async () => {
      // Single source of truth assertion — keeps Phase 2 config + Phase 3
      // layer config bound. Snapshot the import path; if either side
      // forks the constant, the import resolves to a module that doesn't
      // re-export it.
      const config = await import('../../config/cluster.js');
      expect(config.CLUSTER_TIER_BOUNDARIES).toEqual({ sand: 100, ember: 750 });
    });
  });

  it('clusters-hit layer renders ALL clusters invisibly so queryRenderedFeatures can find them', () => {
    // Epic #539: the visible cluster circle/count layers are paint-
    // suppressed via filter:['boolean', false]; React markers
    // (AdaptiveGridMarker / ClusterPill) carry every cluster's visual.
    // The reconciler queries this invisible hit-test layer to discover
    // every cluster_id in the viewport.
    const spec = buildClustersHitLayerSpec();
    expect(spec.id).toBe('clusters-hit');
    expect(spec.type).toBe('circle');
    expect(spec.filter).toEqual(['has', 'point_count']);
    const paint = spec.paint as Record<string, unknown>;
    // Transparent circles — visually invisible but still hit-testable.
    expect(paint['circle-opacity']).toBe(0);
    // Stroke also transparent. (A nonzero stroke would create a visible
    // ring even with circle-opacity:0.)
    expect(paint['circle-stroke-opacity']).toBe(0);
    // Radius matches the small-cluster footprint so taps on a tile-edge
    // tile still register against the cluster.
    expect(typeof paint['circle-radius']).toBe('number');
  });

});

describe('cluster defaults', () => {
  it('CLUSTER_RADIUS is 50', () => {
    expect(CLUSTER_RADIUS).toBe(50);
  });

  it('CLUSTER_MAX_ZOOM is 22 (epic #539 cutover: was 14, raised so adaptive-grid disambiguation extends through max user zoom)', () => {
    expect(CLUSTER_MAX_ZOOM).toBe(22);
  });

  it('FALLBACK_SILHOUETTE_ID is "_FALLBACK"', () => {
    // Matches family_code = '_FALLBACK' seeded by migration 1700000018000.
    expect(FALLBACK_SILHOUETTE_ID).toBe('_FALLBACK');
  });
});

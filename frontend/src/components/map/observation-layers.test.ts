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
  CLUSTER_MOSAIC_MAX_POINTS,
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

  it('stackedSubIds default arg → every feature gets inStack: false (issue #277)', () => {
    // When no third argument is passed, all features must have inStack: false
    // so the unclustered-point filter passes them all through unchanged.
    const obs = [
      makeObs({ subId: 'SUB1' }),
      makeObs({ subId: 'SUB2' }),
      makeObs({ subId: 'SUB3' }),
    ];
    const result = observationsToGeoJson(obs);
    for (const feature of result.features) {
      expect(feature.properties.inStack).toBe(false);
    }
  });

  it('single stackedSubId → only matching feature gets inStack: true (issue #277)', () => {
    // SUB1 is in the stacked set; SUB2 is not. SUB1's feature should carry
    // inStack: true so the symbol layer filter can suppress it.
    const obs = [
      makeObs({ subId: 'SUB1' }),
      makeObs({ subId: 'SUB2' }),
    ];
    const result = observationsToGeoJson(obs, [], new Set(['SUB1']));
    const [f1, f2] = result.features;
    expect(f1!.properties.inStack).toBe(true);
    expect(f2!.properties.inStack).toBe(false);
  });

  it('multi-stack stackedSubIds → each listed subId gets inStack: true, unlisted stays false (issue #277)', () => {
    // SUB1 and SUB3 are in the stacked set; SUB2 is not.
    const obs = [
      makeObs({ subId: 'SUB1' }),
      makeObs({ subId: 'SUB2' }),
      makeObs({ subId: 'SUB3' }),
    ];
    const result = observationsToGeoJson(obs, [], new Set(['SUB1', 'SUB3']));
    const [f1, f2, f3] = result.features;
    expect(f1!.properties.inStack).toBe(true);
    expect(f2!.properties.inStack).toBe(false);
    expect(f3!.properties.inStack).toBe(true);
  });
});

describe('layer specs', () => {
  it('unclustered-point filter suppresses in-stack features (issue #277)', () => {
    // The filter must exclude clustered features AND features whose inStack
    // property is true. The ['!='] form is correct because inStack is always
    // present on every feature (set by observationsToGeoJson).
    const spec = buildUnclusteredPointLayerSpec();
    expect(spec.filter).toEqual([
      'all',
      ['!', ['has', 'point_count']],
      ['!=', ['get', 'inStack'], true],
    ]);
  });

  it('unclustered-point is a symbol layer rendering per-feature silhouettes', () => {
    // Issue #246: replaced the legacy circle layer with an SDF symbol layer.
    // Each feature renders its family's silhouette via icon-image, tinted by
    // the per-feature color property (sourced from the silhouettes join in
    // observationsToGeoJson).
    const spec = buildUnclusteredPointLayerSpec();
    expect(spec.id).toBe('unclustered-point');
    expect(spec.type).toBe('symbol');
    expect(spec.filter).toEqual([
      'all',
      ['!', ['has', 'point_count']],
      ['!=', ['get', 'inStack'], true],
    ]);

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
    // Filter: not-clustered AND notable AND not in a spider stack.
    expect(spec.filter).toEqual([
      'all',
      ['!', ['has', 'point_count']],
      ['==', ['get', 'isNotable'], true],
      ['!=', ['get', 'inStack'], true],
    ]);

    const paint = spec.paint as Record<string, unknown>;
    // Hollow ring — fill is transparent, stroke is the amber accent token.
    expect(paint['circle-color']).toBe('rgba(0,0,0,0)');
    expect(paint['circle-stroke-width']).toBeGreaterThanOrEqual(2);
    expect(typeof paint['circle-stroke-color']).toBe('string');
  });

  it('notable-ring filter suppresses in-stack notable observations (issue #277)', () => {
    // A notable obs that is also in a spider stack must NOT render the amber
    // ring at the original lat/lng — the StackedSilhouetteMarker handles
    // notable treatment at the fanned position. Ensure the filter shape
    // contains the ['!=', ['get', 'inStack'], true] guard.
    const spec = buildNotableRingLayerSpec();
    expect(spec.filter).toEqual([
      'all',
      ['!', ['has', 'point_count']],
      ['==', ['get', 'isNotable'], true],
      ['!=', ['get', 'inStack'], true],
    ]);
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

  it('clusters-hit layer renders ALL clusters invisibly so queryRenderedFeatures can find them', () => {
    // Issue #248: the visible cluster circle layer is filtered to point_count
    // > 8, which means small clusters (≤8) aren't rendered to the canvas
    // and queryRenderedFeatures can't see them. The reconciler needs an
    // invisible hit-test layer that covers ALL clusters so it can pull
    // small ones for HTML marker materialization. Without this layer the
    // mosaic feature simply doesn't activate.
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

  it('FALLBACK_SILHOUETTE_ID is "_FALLBACK"', () => {
    // Matches family_code = '_FALLBACK' seeded by migration 1700000018000.
    expect(FALLBACK_SILHOUETTE_ID).toBe('_FALLBACK');
  });
});

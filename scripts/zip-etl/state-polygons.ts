/**
 * Point-in-polygon ZIP→state resolution against the canonical CONUS polygons.
 *
 * This is the OFFLINE counterpart to the server-side `resolveStateForPoint`
 * (packages/db-client/src/state-boundaries.ts). Both read the SAME geometry
 * source: `data/us-state-polygons.geojson` (locked decision #6 in the plan).
 * If these two ever diverge, a ZIP could resolve to a state whose server clip
 * then returns empty — the gotcha #730 calls out. Keeping the artifact single
 * is what prevents it.
 *
 * Pure data + turf; no Node fs, no network — so the ETL and its vitest test can
 * both import `resolveStateForPoint` and feed it an in-memory FeatureCollection.
 */
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import type { Feature, MultiPolygon, Polygon } from 'geojson';

export interface StatePolygonProperties {
  state_code: string;
  name: string;
  bbox: [number, number, number, number];
}

export type StatePolygonFeature = Feature<MultiPolygon | Polygon, StatePolygonProperties>;

export interface StatePolygonCollection {
  type: 'FeatureCollection';
  features: StatePolygonFeature[];
}

/**
 * Resolve a `[lng, lat]` centroid to a CONUS `US-XX` code, or `null` if the
 * point falls in no CONUS state polygon (AK/HI/territories/ocean).
 *
 * Iterates in feature order and returns the FIRST containing polygon. The
 * canonical GeoJSON is `state_code`-sorted, so a point sitting exactly on a
 * simplified shared border resolves deterministically (lowest `state_code`)
 * rather than ambiguously — mirroring the server accessor's `ORDER BY
 * state_code ASC` tie-break.
 */
export function resolveStateForPoint(
  lng: number,
  lat: number,
  collection: StatePolygonCollection,
): string | null {
  for (const feature of collection.features) {
    if (booleanPointInPolygon([lng, lat], feature)) {
      return feature.properties.state_code;
    }
  }
  return null;
}

/**
 * Throw unless `collection.features` is in ascending `state_code` order.
 *
 * `resolveStateForPoint` returns the FIRST containing polygon, so its
 * border-tie-break only matches the server accessor's `ORDER BY state_code ASC`
 * while the canonical GeoJSON stays `state_code`-sorted. Nothing in the source
 * geometry enforces that, so the ETL's `main()` calls this as a build-time guard:
 * if #728's generator ever re-orders features, the build fails loudly here
 * rather than silently letting the offline PIP and the server clip disagree on
 * a border centroid.
 */
export function assertStateCodeSorted(collection: StatePolygonCollection): void {
  const codes = collection.features.map((f) => f.properties.state_code);
  for (let i = 1; i < codes.length; i++) {
    if (codes[i] < codes[i - 1]) {
      throw new Error(
        `state-polygons.geojson is not state_code-sorted: "${codes[i]}" follows ` +
          `"${codes[i - 1]}" at feature ${i}. resolveStateForPoint's first-match ` +
          `border tie-break only mirrors the server's ORDER BY state_code ASC ` +
          `while features stay sorted — re-sort the generator output (#728).`,
      );
    }
  }
}

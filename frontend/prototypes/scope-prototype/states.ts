/**
 * Minimal state-bbox table for the prototype. In production this comes from
 * `GET /api/states` (StateSummary[]; bbox tuple [west, south, east, north]).
 * For the C0 gate we hard-code the handful of states the canned data covers
 * plus the synthetic CONUS envelope — enough to validate fitBounds + maxBounds
 * reframing at both viewports. Bboxes are the Census cartographic envelopes
 * rounded to 3 decimals.
 */
export interface StateSummary {
  stateCode: string;
  name: string;
  /** [west, south, east, north] — matches ObservationFilters.bbox order. */
  bbox: [number, number, number, number];
}

export const STATES: StateSummary[] = [
  { stateCode: 'US-AZ', name: 'Arizona', bbox: [-114.815, 31.332, -109.045, 37.004] },
  { stateCode: 'US-CA', name: 'California', bbox: [-124.482, 32.529, -114.131, 42.009] },
  { stateCode: 'US-CO', name: 'Colorado', bbox: [-109.06, 36.992, -102.041, 41.003] },
  { stateCode: 'US-FL', name: 'Florida', bbox: [-87.635, 24.396, -79.974, 31.001] },
  { stateCode: 'US-IL', name: 'Illinois', bbox: [-91.513, 36.97, -87.019, 42.508] },
  { stateCode: 'US-MA', name: 'Massachusetts', bbox: [-73.508, 41.187, -69.858, 42.887] },
  { stateCode: 'US-NY', name: 'New York', bbox: [-79.763, 40.477, -71.856, 45.016] },
  { stateCode: 'US-TX', name: 'Texas', bbox: [-106.646, 25.837, -93.508, 36.501] },
  { stateCode: 'US-WA', name: 'Washington', bbox: [-124.848, 45.544, -116.916, 49.002] },
];

/**
 * CONUS pan envelope — identical to MapCanvas.tsx's MAX_BOUNDS so the
 * prototype's `?scope=us` reset matches the production whole-US clamp.
 * MapLibre LngLatBoundsLike: [[west, south], [east, north]].
 */
export const CONUS_BOUNDS: [[number, number], [number, number]] = [
  [-130, 20],
  [-65, 52],
];

export function stateByCode(code: string): StateSummary | undefined {
  return STATES.find((s) => s.stateCode === code);
}

/** [[w,s],[e,n]] from a [w,s,e,n] tuple — MapLibre fitBounds/maxBounds order. */
export function bboxToBounds(
  bbox: [number, number, number, number],
): [[number, number], [number, number]] {
  return [
    [bbox[0], bbox[1]],
    [bbox[2], bbox[3]],
  ];
}

/**
 * Synthetic ZIP→scope resolution for the prototype (production uses the
 * lazy-loaded zip-index.json). Maps a handful of real ZIPs to a state +
 * centroid so the ZIP→point-inside-state flow is exercised.
 */
export const ZIP_FLYTO_ZOOM = 10;

const ZIP_TABLE: Record<string, { stateCode: string; center: [number, number] }> = {
  '85701': { stateCode: 'US-AZ', center: [-110.974, 32.222] }, // Tucson
  '85001': { stateCode: 'US-AZ', center: [-112.074, 33.448] }, // Phoenix
  '86001': { stateCode: 'US-AZ', center: [-111.651, 35.198] }, // Flagstaff
  '10001': { stateCode: 'US-NY', center: [-73.99, 40.74] }, // NYC
  '33801': { stateCode: 'US-FL', center: [-81.7, 27.8] }, // Lakeland
  '90001': { stateCode: 'US-CA', center: [-118.24, 34.05] }, // LA
};

export interface ZipResolution {
  zip: string;
  stateCode: string;
  center: [number, number];
}

export function lookupZip(raw: string): ZipResolution | null {
  const zip = raw.trim().replace(/-\d{4}$/, '');
  if (!/^\d{5}$/.test(zip)) return null;
  const hit = ZIP_TABLE[zip];
  if (!hit) return null;
  return { zip, stateCode: hit.stateCode, center: hit.center };
}

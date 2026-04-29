// Public type contract for the iNaturalist photo client. Consumers (e.g.
// run-photos.ts orchestrator) depend only on this shape — nothing about the
// raw iNat API response leaks across the module boundary.

export interface InatPhoto {
  url: string; // ~800px medium-sized JPEG (size substituted from 'square' → 'medium')
  attribution: string; // e.g. "(c) Jane Doe, some rights reserved (CC BY)"
  license: string; // e.g. "cc-by", "cc-by-sa", "cc0"
}

// Minimal shape of the iNat /v1/observations response we care about. The real
// payload has many more fields (taxon, location, observed_on, etc.) — we only
// project the photo subset, so anything else is intentionally absent here.
export interface InatObservationPhoto {
  url: string; // 75px square thumbnail; size token must be substituted for the larger variant
  attribution: string;
  license_code: string | null; // null when license is ARR (filtered out at the API level via photo_license)
}

export interface InatObservation {
  photos: InatObservationPhoto[];
}

export interface InatObservationsResponse {
  total_results: number;
  page: number;
  per_page: number;
  results: InatObservation[];
}

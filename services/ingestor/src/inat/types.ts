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

// Public type contract for the iNaturalist /v1/taxa client. Consumers depend
// only on this shape — the raw iNat taxon payload (much larger, with
// matched_term, ancestors, default_photo, conservation_status, etc.) is
// projected down to just the two fields child #371/#374 will consume from
// `species_meta` (`inat_taxon_id`) and the descriptions cache (`wikipediaUrl`).
export interface InatTaxon {
  inatTaxonId: number;
  wikipediaUrl: string | null; // null when iNat has no Wikipedia article cross-reference
}

// Public type contract for the iNaturalist per-id taxon endpoint
// (`/v1/taxa/{id}`). Returned by `fetchInatTaxonSummary` and consumed only by
// the Wikipedia-404 fallback branch in `run-descriptions.ts`. The search
// endpoint's result shape (`InatTaxon`) does NOT include the summary — only
// the per-id endpoint surfaces `wikipedia_summary`.
//
// `wikipediaSummary` is null when the taxon record exists but has no
// Wikipedia cross-reference (rare splits, regional lumps); the orchestrator
// treats null as "no usable fallback body, increment descriptionsSkipped".
export interface InatTaxonSummary {
  wikipediaSummary: string | null;
}

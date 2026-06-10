// Shared iNaturalist building blocks used by both the single-photo client
// (client.ts) and the top-N candidate sourcer (candidates.ts). Extracted in
// Slice 3 so the two paths share one license allowlist, one tier cascade, and
// one square→medium substitution — no drift between "fetch the best one" and
// "fetch the top N".

// User-Agent header value identifying the app to iNaturalist's API. iNat's
// API recommended-practices doc asks for a meaningful UA so they can contact
// the maintainer. Anonymous UAs may be throttled or blocked.
export const INAT_USER_AGENT = 'bird-maps.com/1.0 (https://bird-maps.com)';

export const INAT_BASE_URL = 'https://api.inaturalist.org/v1';

// CC license codes accepted by `photo_license`. CC-BY-NC* (non-commercial)
// and CC-*-ND (no-derivatives) variants are excluded: NC forbids commercial
// use (a future donations/grants tier could reclassify bird-maps.com, and
// re-licensing backfilled photos would be painful), ND forbids the cropping /
// resizing the pipeline performs. cc-by, cc-by-sa, cc0 are the only safe set.
export const CC_LICENSES = 'cc-by,cc-by-sa,cc0';

// Tier 1 place_id defaults to '40' (iNaturalist's canonical "Arizona" Place).
// Preserves AZ-launch behavior. `INAT_PLACE_ID` env overrides; '' drops Tier 1.
const DEFAULT_TIER1_PLACE_ID = '40';
// place_id=1 is iNaturalist's canonical "United States" Place (Tier 2).
const UNITED_STATES_PLACE_ID = '1';

// Tier cascade for photo lookup. Tier 1 is region-narrowed (configurable via
// INAT_PLACE_ID); Tier 2 widens to the US; Tier 3 drops the place filter.
export type Tier = { label: 'region' | 'us' | 'global'; placeId: string | null };

export function buildTiers(): readonly Tier[] {
  // env read at module-init time is correct: ingestor process lifetime is
  // short (single backfill / cron tick); tests opt-in via the `tiers` option
  // rather than mutating process.env mid-run.
  const envVal = process.env.INAT_PLACE_ID;
  const tier1 = envVal === undefined ? DEFAULT_TIER1_PLACE_ID : envVal;
  const tiers: Tier[] = [];
  if (tier1 !== '') {
    tiers.push({ label: 'region', placeId: tier1 });
  }
  tiers.push({ label: 'us', placeId: UNITED_STATES_PLACE_ID });
  tiers.push({ label: 'global', placeId: null });
  return tiers;
}

// iNat's `photo.url` returns a 75px square thumbnail by convention (the URL
// contains the literal segment 'square', e.g. .../photos/12345/square.jpg).
// Substituting 'medium' yields the ~500-800px variant suitable for a detail
// panel. iNat documents the size tokens at
// https://www.inaturalist.org/pages/help#photos (square|small|medium|large|original).
export function toMediumUrl(squareUrl: string): string {
  return squareUrl.replace('square', 'medium');
}

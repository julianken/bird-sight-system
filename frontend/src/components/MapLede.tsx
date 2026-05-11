import { REGION_LABEL } from '../config/region.js';

export type Freshness = 'fresh' | 'recent' | 'stale' | 'error';

export interface MapLedeProps {
  /** Number of distinct species across the active filter scope. */
  speciesCount: number;
  /** Number of observations across the active filter scope. */
  observationCount: number;
  /** Common name of the active species filter; null when no species is selected. */
  speciesCommonName: string | null;
  /** Pretty-printed family name (e.g. "woodpeckers"); null when no family filter. */
  familyName: string | null;
  /** Period clause text (e.g. "14 days", "7 days"). */
  period: string;
  /** Freshness state from voice-and-content spec; "stale" drops the period clause. */
  freshness: Freshness;
}

/**
 * Newspaper lede for the map / feed / species surfaces. 4 templates in
 * priority order — see docs/design/01-spec/voice-and-content.md §"Lede
 * contract". Stale data drops the "in the last {period}" clause.
 */
export function MapLede({
  speciesCount,
  observationCount,
  speciesCommonName,
  familyName,
  period,
  freshness,
}: MapLedeProps) {
  const periodClause = freshness === 'stale' ? '' : ` in the last ${period}`;

  let text: string;
  if (observationCount === 0 && speciesCount === 0) {
    // Template 1
    text = 'No sightings match your current filters.';
  } else if (speciesCommonName) {
    // Template 2
    text = `${observationCount} sightings of ${speciesCommonName} in ${REGION_LABEL}${periodClause}.`;
  } else if (familyName) {
    // Template 3
    text = `${speciesCount} species of ${familyName} seen across ${REGION_LABEL}${periodClause}.`;
  } else {
    // Template 4
    text = `${speciesCount} species seen across ${REGION_LABEL}${periodClause}.`;
  }

  return <h1 className="map-lede">{text}</h1>;
}

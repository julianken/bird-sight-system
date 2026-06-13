/**
 * Shared count formatting utilities.
 *
 * One module-scope formatter guarantees deterministic en-US output regardless
 * of the host locale — important because the app copy is English and
 * `Intl.NumberFormat` inherits the host locale when no locale is supplied.
 *
 * Usage:
 *   formatCount(16626)              → "16,626"
 *   countNoun(1, 'observation')     → "1 observation"
 *   countNoun(16626, 'sighting')    → "16,626 sightings"
 *   countNoun(3, 'family','families') → "3 families"
 */

const NUMBER_FORMAT = new Intl.NumberFormat('en-US');

/**
 * Format a count integer with thousands separators.
 * formatCount(241966) → "241,966"
 */
export function formatCount(n: number): string {
  return NUMBER_FORMAT.format(n);
}

/**
 * Format a count with a singular/plural noun.
 *
 * @param n         The count value.
 * @param singular  Singular noun (e.g. "observation", "sighting", "family").
 * @param plural    Optional explicit plural; defaults to `singular + "s"`.
 *
 * countNoun(1, 'observation')         → "1 observation"
 * countNoun(16626, 'sighting')        → "16,626 sightings"
 * countNoun(3, 'family', 'families') → "3 families"
 */
export function countNoun(n: number, singular: string, plural?: string): string {
  const noun = n === 1 ? singular : (plural ?? `${singular}s`);
  return `${formatCount(n)} ${noun}`;
}

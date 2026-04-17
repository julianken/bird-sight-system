import type { EbirdObservation } from './ebird/types.js';
import type { ObservationInput } from '@bird-watch/db-client';

/**
 * eBird returns obsDt as "YYYY-MM-DD HH:MM" in local time of the observation.
 * For MVP we treat as UTC — accuracy to the hour is fine for "what was seen recently".
 */
export function toObservationInput(
  o: EbirdObservation,
  notableKeys: ReadonlySet<string>
): ObservationInput {
  const key = `${o.subId}|${o.speciesCode}`;
  const obsDtIso = parseEbirdDate(o.obsDt);
  return {
    subId: o.subId,
    speciesCode: o.speciesCode,
    comName: o.comName,
    lat: o.lat,
    lng: o.lng,
    obsDt: obsDtIso,
    locId: o.locId,
    locName: o.locName,
    howMany: typeof o.howMany === 'number' ? o.howMany : null,
    isNotable: notableKeys.has(key),
  };
}

export function notableKeyset(obs: EbirdObservation[]): Set<string> {
  return new Set(obs.map(o => `${o.subId}|${o.speciesCode}`));
}

function parseEbirdDate(s: string): string {
  // "2026-04-15 08:00" → "2026-04-15T08:00:00.000Z"
  const normalized = s.replace(' ', 'T') + ':00.000Z';
  const d = new Date(normalized);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid eBird obsDt: ${s}`);
  }
  return d.toISOString();
}

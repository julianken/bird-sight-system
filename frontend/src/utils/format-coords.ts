/**
 * Format a lat/lng pair for display in hotspot rows.
 *
 * Output shape: `"31.51°N, 110.35°W"` — always two decimals, hemisphere
 * letter absolute-valued so negative coordinates don't show as `-110.35°W`.
 *
 * Hemisphere convention (documented in format-coords.test.ts):
 *   - lat >= 0 → "N"; lat < 0 → "S"
 *   - lng >= 0 → "E"; lng < 0 → "W"
 * Positive-zero conventions match what eBird ships: `lat=0` renders as
 * `"0.00°N"`, not `"0.00°S"`. The test suite pins this so a later flip to
 * strict `> 0` is caught.
 *
 * Caller responsibility: pass finite numbers. Hotspot data from the Read
 * API always has `lat`/`lng` present (they're `NOT NULL` in the DB schema,
 * see `migrations/1_hotspots.sql`); this helper does NOT defend against
 * NaN / Infinity — that would be an upstream data bug worth surfacing.
 */
export function formatCoords(lat: number, lng: number): string {
  const latHemi = lat >= 0 ? 'N' : 'S';
  const lngHemi = lng >= 0 ? 'E' : 'W';
  const latAbs = Math.abs(lat).toFixed(2);
  const lngAbs = Math.abs(lng).toFixed(2);
  return `${latAbs}°${latHemi}, ${lngAbs}°${lngHemi}`;
}

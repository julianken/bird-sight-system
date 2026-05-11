/**
 * deriveFreshness — 4-state freshness machine
 *
 * Consumes the threshold constants from frontend/src/config/freshness.ts and
 * the freshestObservationAt ISO string from meta.freshestObservationAt to
 * produce a { state, label } pair for display.
 *
 * State machine (spec: docs/design/01-spec/voice-and-content.md §Freshness label state machine):
 *   fresh  — age ≤ FRESHNESS_FRESH_MAX_MS (30 min) → "Updated N min ago · Source: eBird"
 *   recent — age ≤ FRESHNESS_RECENT_MAX_MS (6 h)   → "Updated N h ago · Source: eBird"
 *   stale  — age > FRESHNESS_RECENT_MAX_MS          → "Last updated N h ago · Source: eBird"
 *   error  — freshestObservationAt is null          → "Source unavailable · check back soon"
 *
 * The `now` parameter is injectable for deterministic testing (pass a fixed Date).
 *
 * Issue: #456 W3-A
 */

import {
  FRESHNESS_FRESH_MAX_MS,
  FRESHNESS_RECENT_MAX_MS,
} from '../config/freshness.js';

export type Freshness = 'fresh' | 'recent' | 'stale' | 'error';

export interface FreshnessResult {
  state: Freshness;
  label: string;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * Formats a duration in milliseconds as a human-readable age string.
 * Only produces the bucket strings needed by the freshness label spec:
 *   - <60 min: "N min ago" (1 min floor)
 *   - ≥60 min: "Nh ago" (1 h floor)
 *
 * This is intentionally simpler than formatRelativeTime — it handles only
 * the sub-24-hour range that fresh/recent/stale occupy.
 */
function formatAge(ageMs: number): string {
  if (ageMs < HOUR_MS) {
    const mins = Math.max(1, Math.floor(ageMs / MINUTE_MS));
    return `${mins} min ago`;
  }
  const hours = Math.floor(ageMs / HOUR_MS);
  return `${hours}h ago`;
}

/**
 * Derive freshness state and display label from a freshestObservationAt
 * timestamp and the current time.
 *
 * @param freshestObservationAt — ISO string from meta.freshestObservationAt,
 *   or null (empty table / read-api unavailable)
 * @param now — current time; defaults to new Date() for production use
 */
export function deriveFreshness(
  freshestObservationAt: string | null,
  now: Date = new Date()
): FreshnessResult {
  if (freshestObservationAt === null) {
    return { state: 'error', label: 'Source unavailable · check back soon' };
  }

  const ageMs = now.getTime() - new Date(freshestObservationAt).getTime();

  if (ageMs <= FRESHNESS_FRESH_MAX_MS) {
    return {
      state: 'fresh',
      label: `Updated ${formatAge(ageMs)} · Source: eBird`,
    };
  }

  if (ageMs <= FRESHNESS_RECENT_MAX_MS) {
    return {
      state: 'recent',
      label: `Updated ${formatAge(ageMs)} · Source: eBird`,
    };
  }

  // stale: age > FRESHNESS_RECENT_MAX_MS
  return {
    state: 'stale',
    label: `Last updated ${formatAge(ageMs)} · Source: eBird`,
  };
}

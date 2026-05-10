/**
 * Freshness label state machine thresholds.
 *
 * The read API exposes meta.freshest_observation_at. The frontend
 * computes age client-side and selects a state:
 *
 *   fresh  — age ≤ FRESHNESS_FRESH_MAX_MS   → "Updated N min ago"
 *   recent — age ≤ FRESHNESS_RECENT_MAX_MS  → "Updated N h ago"
 *   stale  — age > FRESHNESS_RECENT_MAX_MS  → "Last updated N h ago"
 *
 * FRESHNESS_STALE_MIN_MS is an alias for FRESHNESS_RECENT_MAX_MS + 1ms,
 * exported for consumers that want a positive lower bound on stale age.
 *
 * Spec: docs/design/01-spec/voice-and-content.md (freshness state machine)
 */
export const FRESHNESS_FRESH_MAX_MS = 30 * 60 * 1000;   // 30 min
export const FRESHNESS_RECENT_MAX_MS = 6 * 60 * 60 * 1000; // 6 h
export const FRESHNESS_STALE_MIN_MS = FRESHNESS_RECENT_MAX_MS + 1;

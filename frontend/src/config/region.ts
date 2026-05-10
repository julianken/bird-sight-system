/**
 * Region configuration.
 *
 * REGION_LABEL is the source of truth for the region name used in the
 * wordmark ("Bird Maps · Arizona"), the lede, and any region claim in
 * the UI. Change this string to relocate the application to a different
 * region — downstream consumers read it from here.
 *
 * Spec: docs/design/01-spec/architecture.md §Cross-cutting structures
 */
export const REGION_LABEL = 'Arizona' as const;

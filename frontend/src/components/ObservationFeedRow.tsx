/**
 * Compatibility re-export shim — Sky Atlas Phase 5.
 *
 * ObservationFeedRow has been refactored into FeedRow (which adds the
 * <FamilySilhouette> thumb) and FeedCard (elevated notable treatment).
 * This shim preserves the existing named export so callers that haven't
 * migrated continue to compile and render correctly.
 *
 * Callers should migrate to importing from FeedRow.tsx directly. This
 * shim will be removed in Phase 6 cleanup.
 */
export { FeedRow as ObservationFeedRow } from './FeedRow.js';
export type { FeedRowProps as ObservationFeedRowProps } from './FeedRow.js';

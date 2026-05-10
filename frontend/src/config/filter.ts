/**
 * FilterSentence timing constants.
 *
 * FILTER_SENTENCE_DEBOUNCE_MS: Settled-state debounce. A user toggling
 * multiple filters in quick succession gets one SR announcement after
 * the toggles stop (not one per toggle).
 *
 * FILTER_SENTENCE_CLEAR_HOLD_MS: When filter content transitions from
 * non-null to null, hold "All filters cleared." in the live region for
 * this duration before going silent. The visible <FilterSentence>
 * collapses to null immediately; only the hidden live region holds.
 *
 * Spec: docs/design/01-spec/components.md#filtersentence
 *       docs/design/01-spec/accessibility.md (live-region contract)
 */
export const FILTER_SENTENCE_DEBOUNCE_MS = 500;
export const FILTER_SENTENCE_CLEAR_HOLD_MS = 1500;

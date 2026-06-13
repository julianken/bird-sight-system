// Per-row diff classifier for the eleatic run-diff view.
//
// Given how a row's two sides (run A, run B) relate to their `expected_json`,
// derive a single classification the diff table and the run-level
// regression-count badge consume:
//
//   regression  — matched expected in A but NOT in B   (the metric that matters)
//   improvement — matched expected in B but NOT in A   (the reverse)
//   new         — present in B only
//   removed     — present in A only (or, degenerately, neither)
//   unchanged   — present in both and the matched-state is the same on each side
//
// Presence dominates: a row that exists in only one run is `new`/`removed`
// regardless of match state. Among rows present in both, the (aMatched, bMatched)
// pair decides regression / improvement / unchanged. `diverged` (whether the two
// outputs differ in content) is part of the input contract for the diff view's
// display but does NOT change the classification — a row can match expected on
// both sides yet still diverge in incidental output shape; that is `unchanged`.
//
// Pure: no DOM, no network. Importable by the browser (express.static) and
// vitest in node — the safe.js / format.js precedent.

/**
 * @param {{ aMatched: boolean, bMatched: boolean, aPresent: boolean,
 *           bPresent: boolean, diverged: boolean }} row
 * @returns {'regression'|'improvement'|'unchanged'|'new'|'removed'}
 */
export function classifyRow({ aMatched, bMatched, aPresent, bPresent }) {
  // Presence first: a one-sided row is new/removed irrespective of match state.
  if (aPresent && !bPresent) return 'removed';
  if (!aPresent && bPresent) return 'new';
  if (!aPresent && !bPresent) return 'removed'; // degenerate; never in a real diff

  // Both present: the expected-match transition decides the verdict.
  if (aMatched && !bMatched) return 'regression';
  if (!aMatched && bMatched) return 'improvement';
  return 'unchanged';
}

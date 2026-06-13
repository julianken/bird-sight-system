// Adjudication staleness comparator for the eleatic drawer.
//
// A stored adjudication carries the `against_hash` — the row's content_hash AT
// THE TIME the verdict was decided. The verdict is STALE when the row's CURRENT
// content_hash differs: the underlying item changed since a human decided, so
// the decision may no longer apply. adjudicate.js surfaces a "stale — re-decide"
// badge when this returns true.
//
// Mirrors the server's contract (src/queries.ts#isStale): an adjudication with
// no recorded against_hash is NEVER stale (it was never anchored to a hash), and
// an absent current hash gives nothing to compare against. Both are treated the
// same as a missing value, so empty string / null / undefined all count as
// "absent" → not stale.
//
// Pure: no DOM, no network. Importable by the browser (express.static) and
// vitest in node — the safe.js / format.js precedent.

/**
 * @param {string | null | undefined} againstHash  hash the verdict was decided against
 * @param {string | null | undefined} currentHash  the row's current content_hash
 * @returns {boolean} true only when both are present and differ
 */
export function isStale(againstHash, currentHash) {
  if (!againstHash || !currentHash) return false;
  return againstHash !== currentHash;
}

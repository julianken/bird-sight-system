import { useEffect, useRef } from 'react';

/**
 * Scroll position capture-and-restore tied to an `active` boolean.
 *
 * Contract (per issue #115):
 *   - false → true: capture `window.scrollY` as the "pre-open" position.
 *   - true  → false: if the user has NOT scrolled materially since capture
 *     (|current - captured| ≤ 2px), restore to the captured position.
 *     Otherwise (user scrolled > 2px), preserve their current position —
 *     they are engaged with new content, overriding them would feel hostile.
 *
 * Why false→true is the boundary, not "on mount":
 *   The deep-link case (`?species=vermfly` on cold load) mounts the panel
 *   with `active=true` and scrollY=0. Capturing on mount would stash 0;
 *   "restoring" to 0 on close would be a no-op (correct), but the mental
 *   model is simpler if we only capture on a real open event. So the hook
 *   uses a ref to track the previous `active` value and only captures when
 *   it observes a false → true transition.
 *
 * The 2px tolerance exists because sub-pixel rounding in browser layout
 * (devicePixelRatio math, zoom) can move scrollY by ±1 even with no user
 * input. 2px is tight enough to not swallow a real 3px scroll, loose
 * enough to ignore rounding.
 *
 * Scroll-surface split (as of PR #516 / issue #509):
 *   This hook watches window.scrollY, which is correct for surfaces that
 *   scroll the document itself — specifically the species detail panel
 *   open/close transition (App.tsx). It is NOT wired to the virtualized
 *   feed list, which uses an inner OL element as its scroll container.
 *   Feed-internal scroll position is preserved across filter changes by
 *   react-window's own internal state (the List component keeps its
 *   scrollOffset ref alive through re-renders when filters change because
 *   the component is never unmounted — only rowCount/rowProps update).
 *   Both surfaces therefore preserve position correctly, through different
 *   mechanisms. The e2e suite covers both (feed-virtualize.spec.ts).
 */
export function useScrollRestore(active: boolean): void {
  const capturedRef = useRef<number | null>(null);
  const prevActiveRef = useRef<boolean>(active);

  useEffect(() => {
    const prev = prevActiveRef.current;
    prevActiveRef.current = active;

    // false → true: capture.
    if (!prev && active) {
      capturedRef.current = window.scrollY;
      return;
    }

    // true → false: restore if the user did not scroll materially.
    if (prev && !active) {
      const captured = capturedRef.current;
      capturedRef.current = null;
      if (captured === null) return; // Nothing to restore (e.g. deep-link case).
      const current = window.scrollY;
      const drift = Math.abs(current - captured);
      if (drift <= 2) {
        window.scrollTo(0, captured);
      }
      // else: user scrolled materially — preserve their position, no-op.
    }

    // true → true or false → false: nothing to do.
  }, [active]);
}

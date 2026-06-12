import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Observation } from '@bird-watch/shared-types';

export interface ObservationPopoverProps {
  observation: Observation | null;
  /**
   * Screen coordinates (px, relative to the `.map-canvas` wrapper which is
   * `position: relative`) of the clicked marker. The popover renders adjacent
   * to this point with viewport-edge clamping (flipX/flipY) so it stays
   * fully visible at any viewport. Pass `null` for the legacy "no anchor"
   * path used by the demo harness + older tests that render the component
   * without a click — that path falls back to the CSS rule alone.
   *
   * Optional so existing callers (older tests, demo harness) still
   * type-check; omitting the prop is equivalent to `null`.
   */
  position?: { x: number; y: number } | null;
  onClose: () => void;
  /**
   * Issue #246: switch to the species-detail surface for the observation's
   * species. Wired in App.tsx to `set({ view: 'detail', detail: code })`
   * via `useUrlState` — NOT a `<a href>` because:
   *   1. App.tsx mounts surfaces mutually-exclusive (no #species-detail
   *      anchor exists during view=map), so a hash-link wouldn't have a
   *      target to scroll to.
   *   2. A real navigation would reload the page; the URL-state setter
   *      keeps the SPA in-place. Mirrors the skip-link pattern from #247.
   *
   * Optional so existing callers (older tests, demo harness) still
   * type-check; the link is hidden when omitted (no clickable surface
   * without a destination).
   */
  onSelectSpecies?: (speciesCode: string) => void;
}

// Pixel distance between the click point and the nearest popover edge.
const OFFSET = 12;
// Matches `max-width: 280px` in styles.css (.observation-popover). Single
// source of truth lives in styles.css; the comment there flags that
// POPOVER_W in this file must be updated alongside it.
const POPOVER_W = 280;
// First-paint fallback for height; replaced by the ResizeObserver-measured
// real height after the first observe callback. A conservative 180px
// matches the median content height at 1440×900 in the production app.
const FALLBACK_H = 180;

/**
 * Inline popover shown when an unclustered observation point is clicked on
 * the map. Displays the species common name, location, timestamp, optional
 * count, a notable badge when applicable, and a "See species details" link
 * that routes to the SpeciesDetail surface for the observation's species.
 *
 * Anchoring (issue #718): when `position` is supplied, the popover paints
 * at `position.x + OFFSET, position.y + OFFSET` (below-right of the click),
 * flipping to the left/above when within `POPOVER_W` / measured height of
 * the right/bottom viewport edge. Height for the flipY decision is
 * measured at runtime via ResizeObserver — see the `measuredH` state below.
 */
export function ObservationPopover({
  observation,
  position = null,
  onClose,
  onSelectSpecies,
}: ObservationPopoverProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLSpanElement | null>(null);
  const [measuredH, setMeasuredH] = useState<number>(FALLBACK_H);

  // #1031 — dialog focus-return. ObservationPopover's open path is
  // coordinate-based: the triggering marker button is discarded at click
  // time (`onOpen(obs,[lng,lat])` / `onSelect(subId)` both funnel into
  // `setSelectedObs` with only the obs + screen pos). So instead of holding
  // an `anchorEl` prop like the sibling popovers, we RE-QUERY the live opener
  // element by subId at dismissal time. The data attribute is spelled two
  // different ways across the two opener surfaces, so the selector covers
  // BOTH: `[data-subid]` (DisplacedSilhouetteLayer.tsx — the displaced
  // silhouette button) and `[data-sub-id]` (MapMarkerHitLayer.tsx — the
  // hit-layer button, which is `tabIndex={-1}`; programmatic `.focus()` still
  // works). Re-query (not a captured `e.currentTarget`) is deliberate: both
  // opener layers re-render with the viewport, so a node captured at click
  // time can be unmounted by close time and `.focus()` would silently no-op —
  // the live re-query always finds the current node. If neither resolves
  // (marker left the data/viewport), fall back to the map wrapper rather than
  // dropping focus to `document.body`.
  const subId = observation?.subId;
  const returnFocus = useCallback(() => {
    if (typeof document === 'undefined') return;
    const opener = subId
      ? document.querySelector<HTMLElement>(
          `[data-subid="${subId}"], [data-sub-id="${subId}"]`,
        )
      : null;
    if (opener) {
      opener.focus();
      return;
    }
    const wrapper = document.querySelector<HTMLElement>(
      '[data-testid="map-canvas"]',
    );
    wrapper?.focus();
  }, [subId]);

  // Dismiss = close + return focus, shared by the × button and Escape so the
  // focus-return contract holds on every close path.
  const dismiss = useCallback(() => {
    onClose();
    returnFocus();
  }, [onClose, returnFocus]);

  // Measure the rendered popover height once it's in the DOM. The flipY
  // decision below uses `measuredH` so popovers with long content (e.g.
  // long species names + locName + howMany rows) still clear the bottom
  // edge. On the very first paint of a given observation we use
  // FALLBACK_H = 180, which can cause a one-frame visual shift on the
  // pathological case (popover within (measuredH - FALLBACK_H) px of
  // bottom AND content taller than the fallback). Documented in #718.
  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      if (typeof h === 'number' && h > 0) setMeasuredH(h);
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, [observation]);

  // #1031 — move focus into the dialog on open (spec §4.8 popover focus
  // management; mirrors CellPopover/ClusterListPopover). The heading carries
  // `tabIndex={-1}` so it is programmatically focusable. Keyed on the obs
  // identity so re-opening for a different observation re-lands focus.
  useEffect(() => {
    if (!observation) return;
    headingRef.current?.focus();
  }, [observation]);

  // #1031 — document-level Escape → close + focus return. Matches the sibling
  // popovers' Escape contract; the × button shares the same `dismiss`.
  useEffect(() => {
    if (!observation) return;
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') dismiss();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [observation, dismiss]);

  if (!observation) return null;

  const dateStr = new Date(observation.obsDt).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  let style: CSSProperties = {};
  // #950: recipe-05 transform-origin tracks the flip decision so the scale-in
  // grows from the corner nearest the click. Default (below-right of click) →
  // the click sits at the popover's top-left corner; flipX/flipY move the
  // origin to the corner the popover grew toward. Defaults to 'top left' for
  // the legacy no-anchor path (position === null).
  let origin = 'top left';
  if (position) {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
    const flipX = position.x + OFFSET + POPOVER_W > vw;
    const flipY = position.y + OFFSET + measuredH > vh;
    style = {
      position: 'absolute',
      left: flipX
        ? `${Math.max(8, position.x - OFFSET - POPOVER_W)}px`
        : `${position.x + OFFSET}px`,
      top: flipY
        ? `${Math.max(8, position.y - OFFSET - measuredH)}px`
        : `${position.y + OFFSET}px`,
    };
    origin = `${flipY ? 'bottom' : 'top'} ${flipX ? 'right' : 'left'}`;
  }

  return (
    <div
      ref={rootRef}
      className="observation-popover t-popover-grow"
      data-origin={origin}
      role="dialog"
      aria-label={`Details for ${observation.comName}`}
      style={style}
    >
      <div className="observation-popover-header">
        <span
          ref={headingRef}
          className="observation-popover-name"
          tabIndex={-1}
        >
          {observation.comName}
        </span>
        {observation.isNotable && (
          <span className="observation-popover-badge" aria-label="Notable">
            !
          </span>
        )}
        <button
          type="button"
          className="observation-popover-close"
          onClick={dismiss}
          aria-label="Close"
        >
          &times;
        </button>
      </div>
      {observation.locName && (
        <div className="observation-popover-location">
          {observation.locName}
        </div>
      )}
      <div className="observation-popover-time">{dateStr}</div>
      {observation.howMany != null && (
        <div className="observation-popover-count">
          Count: {observation.howMany}
        </div>
      )}
      {onSelectSpecies && (
        <button
          type="button"
          className="observation-popover-detail-link"
          onClick={() => onSelectSpecies(observation.speciesCode)}
        >
          See species details &rarr;
        </button>
      )}
    </div>
  );
}

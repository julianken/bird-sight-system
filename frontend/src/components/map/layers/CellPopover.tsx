import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { SpeciesAggregate } from '@/components/map/geometry/adaptive-grid.js';
import { prettyFamily } from '@/derived.js';
import { formatCount } from '@/lib/format-count.js';

/**
 * `<CellPopover>` — full popover for one family within an adaptive-grid cell
 * (epic #556 Phase 1, issue #558; species data now real per #859).
 *
 * Renders the family's species rows as `{count}× {comName}`. With #859 the
 * `species` rows carry REAL eBird codes resolved against the species dictionary
 * (no more synthetic `agg-*` rows / Latin family-code names), so every row with
 * a non-null `speciesCode` is a working native `<button>` (#1031 C54 — was
 * `<a role="link">`) into the species detail. Spuh/slash/hybrid taxa
 * (`speciesCode === null`) render as a static `<span>`.
 *
 * `+N more` is an ACTIVE DRILL-IN (#859 D): when a family has more distinct
 * species than the popover shows (`overflowCount > 0`), the footer is a button
 * that calls `onDrillIn` — the caller zooms the map into this cell where the
 * top-8 cap no longer applies. When there is no overflow, the footer is the
 * static "Click or tap for full list" hint.
 *
 * #859 E (structural z-index): the popover PORTALS to `document.body` so the
 * maplibre marker `<div>`'s `transform` (a stacking context) can't let the
 * cluster pills paint over it. The portal escapes that context — but a portal to
 * `document.body` has NO positioned ancestor, so the bare CSS `position: absolute`
 * would collapse to the body origin (bottom-left).
 *
 * #863 fix: because the card is portaled out of the marker, it must compute its
 * own on-screen placement from `anchorEl.getBoundingClientRect()` and apply it as
 * an inline `position: fixed; top; left` (the inline style wins over the CSS
 * `position: absolute`). It anchors just below the clicked cell, left-aligned to
 * the cell, with edge handling: flip above when it would overflow the bottom and
 * clamp horizontally so it never runs off the right/left edge. This mirrors the
 * `<CellHoverPreview>` pattern (inline `position: fixed` + computed `left`/`top` +
 * portal). One-shot compute on mount is sufficient: the popover only lives while a
 * cell is in `popover` mode and dismisses on map interaction (pan/zoom), so the
 * anchor rect cannot go stale underneath an open card.
 */

/** Gap between the anchor cell and the popover card, in CSS px. */
const ANCHOR_GAP = 6;
/**
 * E1 (#1053): shared viewport-edge safe-area inset, in CSS px. Mirrors the
 * `--card-inset` token (12px = `--space-md`) so every transient popover keeps
 * the same 12px gutter the four-corner floating-card contract assigns to
 * resting chrome. Consumed by `computePopoverPosition` here AND by
 * `ObservationPopover`'s clamp — one source of truth so the two anchored
 * surfaces can't drift apart (the prior 8px `VIEWPORT_MARGIN` /
 * `Math.max(8, …)` floor left an east-edge popover flush to within 8px of the
 * edge, where it collides with the browser's edge-swipe gesture region).
 */
export const POPOVER_VIEWPORT_INSET_PX = 12;
/**
 * Fallback card box used before the real rendered rect is measurable (and in
 * jsdom, where layout is not computed). Mirrors `.cell-popover`'s CSS
 * `min-width: 240px`; the height is a conservative estimate for the flip check.
 */
const FALLBACK_CARD_WIDTH = 240;
const FALLBACK_CARD_HEIGHT = 200;
/**
 * E1 (#1053): the card's CSS `max-width: var(--card-maxw-popover)` (300px). The
 * one-shot `useLayoutEffect` measures the card width BEFORE content/fonts fully
 * settle, so a card that ends up at the 300px cap can be measured narrower —
 * and then a left clamp computed from that stale narrow width lets the
 * fully-grown card overrun the right edge (verified live at 390: right edge at
 * 391 vs the vw−12=378 floor). Clamping the RIGHT edge against this cap instead
 * of the measured width makes the gutter robust to the late growth: a narrower
 * card simply gets a slightly wider right gutter, never an overflow. Mirrors
 * --card-maxw-popover in tokens.css; keep in sync (same contract as
 * ObservationPopover's POPOVER_W).
 */
const POPOVER_MAX_WIDTH = 300;

/**
 * Compute the popover's fixed-position `left`/`top` (viewport coordinates) from
 * the anchor cell's rect and the card's own size, clamping/flipping so the card
 * stays fully on screen.
 */
function computePopoverPosition(
  anchorRect: DOMRect,
  cardWidth: number,
  cardHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): { left: number; top: number; placement: 'above' | 'below' } {
  // Horizontal: left-align to the cell, then clamp into the viewport so the
  // card never overflows the right (flips effectively become a right-shift) or
  // left edge. E1 (#1053): clamp to the 12px safe area, not the old 8px floor.
  // Bound the RIGHT edge against the LARGER of the measured width and the CSS
  // max-width cap (300) — the one-shot measure can under-read the width before
  // content settles, and a left clamp from a stale-narrow width lets the grown
  // card overrun the right edge (live repro at vw 390).
  const clampWidth = Math.max(cardWidth, POPOVER_MAX_WIDTH);
  const maxLeft = Math.max(
    POPOVER_VIEWPORT_INSET_PX,
    viewportWidth - clampWidth - POPOVER_VIEWPORT_INSET_PX,
  );
  const left = Math.min(Math.max(anchorRect.left, POPOVER_VIEWPORT_INSET_PX), maxLeft);

  // Vertical: prefer below the cell. If that would overflow the bottom, flip to
  // above the cell. Clamp into the viewport as a final fallback.
  const belowTop = anchorRect.bottom + ANCHOR_GAP;
  const aboveTop = anchorRect.top - ANCHOR_GAP - cardHeight;
  const overflowsBottom = belowTop + cardHeight > viewportHeight - POPOVER_VIEWPORT_INSET_PX;
  const placedAbove = overflowsBottom && aboveTop >= POPOVER_VIEWPORT_INSET_PX;
  let top = placedAbove ? aboveTop : belowTop;
  const maxTop = Math.max(
    POPOVER_VIEWPORT_INSET_PX,
    viewportHeight - cardHeight - POPOVER_VIEWPORT_INSET_PX,
  );
  top = Math.min(Math.max(top, POPOVER_VIEWPORT_INSET_PX), maxTop);

  // #950: surface the flip decision so the recipe-05 transform-origin tracks
  // it — a card placed below the cell grows from its top edge, one placed above
  // grows from its bottom edge.
  return { left, top, placement: placedAbove ? 'above' : 'below' };
}
export interface CellPopoverProps {
  familyCode: string;
  /**
   * #920: pre-resolved colloquial family name (the tile's `displayName`,
   * `resolveFamilyName(familyCode, { commonName })`). When omitted, the header
   * falls back to `prettyFamily(familyCode)` so legacy/test callers that pass
   * only a code still render the capitalized scientific label.
   */
  familyName?: string;
  familyCount: number;
  species: ReadonlyArray<SpeciesAggregate>;
  /**
   * #859: number of distinct species beyond the shown rows — drives the active
   * `+N more` drill-in. Defaults to `species.length - POPOVER_CAP` (legacy
   * behaviour) when omitted, so existing per-observation callers are unchanged.
   */
  overflowCount?: number;
  anchorEl: HTMLElement;
  onDismiss: () => void;
  onSelectSpecies: (speciesCode: string) => void;
  /**
   * #859: invoked when the user activates `+N more` — the caller escalates the
   * camera into this cell so the full species list resolves at higher zoom.
   * When omitted the `+N more` footer is inert text (legacy callers).
   */
  onDrillIn?: () => void;
}

const POPOVER_CAP = 8;

export function CellPopover(props: CellPopoverProps) {
  const {
    familyCode, familyName, familyCount, species, overflowCount, anchorEl,
    onDismiss, onSelectSpecies, onDrillIn,
  } = props;
  const headingId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  // #863: the portaled card's fixed-position placement, computed from the
  // anchor rect on mount. `null` until the layout effect runs (one paint).
  // #950: `placement` ('above'|'below') drives the recipe-05 transform-origin
  // so the scale-in grows from the cell-facing edge.
  const [position, setPosition] = useState<
    { left: number; top: number; placement: 'above' | 'below' } | null
  >(null);

  const visible = species.slice(0, POPOVER_CAP);
  // Overflow is the EXACT distinct-species remainder when the caller supplies
  // it (#859 — driven by the family's true speciesCount, not the capped row
  // count); otherwise fall back to the rendered-row remainder.
  const overflow = overflowCount ?? species.length - POPOVER_CAP;
  const hasOverflow = overflow > 0;
  // The drill-in is active only when the caller wired a handler AND there is
  // overflow to drill into.
  const drillInActive = hasOverflow && typeof onDrillIn === 'function';

  // #863: compute the fixed-position placement from the anchor rect before the
  // browser paints (useLayoutEffect avoids a one-frame flash at the body origin).
  // The card's own rendered size is read from rootRef when available; otherwise
  // we fall back to the CSS min-width / an estimated height (jsdom, first pass).
  useLayoutEffect(() => {
    const anchorRect = anchorEl.getBoundingClientRect();
    const cardRect = rootRef.current?.getBoundingClientRect();
    const cardWidth = cardRect && cardRect.width > 0 ? cardRect.width : FALLBACK_CARD_WIDTH;
    const cardHeight = cardRect && cardRect.height > 0 ? cardRect.height : FALLBACK_CARD_HEIGHT;
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 768;
    setPosition(
      computePopoverPosition(anchorRect, cardWidth, cardHeight, viewportWidth, viewportHeight),
    );
  }, [anchorEl]);

  // Move focus to the heading on mount (spec §4.8 — popover focus management).
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // ESC dismiss + focus return.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent | globalThis.KeyboardEvent) {
      if (e.key === 'Escape') {
        onDismiss();
        anchorEl.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown as EventListener);
    return () => document.removeEventListener('keydown', onKeyDown as EventListener);
  }, [onDismiss, anchorEl]);

  // Click-outside dismiss.
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node | null;
      if (target && rootRef.current && !rootRef.current.contains(target)) {
        onDismiss();
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [onDismiss]);

  // #863: the inline `position: fixed` wins over the CSS `.cell-popover`'s
  // `position: absolute`, anchoring the portaled card to the clicked cell. Until
  // the layout effect has measured (one pre-paint pass), keep it off-screen so it
  // never flashes at the body origin — `position` is set synchronously before the
  // browser paints, so users only ever see the anchored placement.
  const positionStyle: CSSProperties = position
    ? { position: 'fixed', left: position.left, top: position.top }
    : { position: 'fixed', left: -9999, top: -9999, visibility: 'hidden' };

  const content = (
    <div
      ref={rootRef}
      role="dialog"
      aria-labelledby={headingId}
      className="cell-popover t-popover-grow"
      data-testid="cell-popover"
      // #950: gate the recipe-05 scale-in on data-placed — it flips to "true"
      // in the SAME useLayoutEffect that sets `position`, so the enter never
      // plays while the card is parked off-screen at left:-9999/visibility:hidden
      // (which would surface as a hard cut on first paint). data-placement
      // ('above'|'below') sets the transform-origin to the cell-facing edge.
      data-placed={position ? 'true' : undefined}
      data-placement={position?.placement}
      style={positionStyle}
    >
      {/* #1053: anchor caret — an 8px rotated-square notch on the cell-facing
          edge (top when the card sits BELOW the cell, bottom when it flips
          ABOVE). data-placement mirrors the card's placement so the CSS can
          park it on the correct edge; it survives the flip/shift/clamp because
          it tracks the same `placement` decision the position math emits. It's
          purely decorative (aria-hidden) — the card already announces as a
          dialog. Rendered only once placement is known, so it never paints at
          the off-screen park. */}
      {position && (
        <span
          className="cell-popover__caret"
          data-testid="cell-popover-caret"
          data-placement={position.placement}
          aria-hidden="true"
        />
      )}
      <header className="cell-popover__header">
        <h2
          ref={headingRef}
          id={headingId}
          className="cell-popover__heading"
          tabIndex={-1}
          data-testid="cell-popover-heading"
        >
          {familyName ?? prettyFamily(familyCode)} ({formatCount(familyCount)})
        </h2>
      </header>
      <ul className="cell-popover__rows">
        {visible.map((s) => {
          const code = s.speciesCode;
          if (code !== null) {
            // #1031 (C54): the `--clickable` modifier scoped the old
            // `a[role="link"]` rule; the new `.cell-popover__row-button`
            // self-scopes its affordance, so the modifier is dropped.
            return (
              <li key={s.comName} className="cell-popover__row">
                {/* #1031 (C54): native <button> rather than `<a role="link"
                    tabIndex={0}>` with hand-rolled Enter+Space — the row drives
                    an in-page URL-state switch (onSelectSpecies), not a real
                    navigation, so 'link' semantics mis-announced it and Space
                    had to be emulated. A button announces correctly and gets
                    Enter/Space activation for free. Mirrors the
                    ObservationPopover detail-link precedent. */}
                <button
                  type="button"
                  className="cell-popover__row-button"
                  data-testid="cell-popover-row"
                  onClick={() => onSelectSpecies(code)}
                >
                  {formatCount(s.count)}x {s.comName}
                </button>
              </li>
            );
          }
          // Spuh/slash/hybrid taxa with no canonical code: static, non-clickable.
          return (
            <li
              key={s.comName}
              className="cell-popover__row"
              data-testid="cell-popover-row"
            >
              <span>{formatCount(s.count)}x {s.comName}</span>
            </li>
          );
        })}
      </ul>
      {drillInActive ? (
        <button
          type="button"
          className="cell-popover__more"
          data-testid="cell-popover-more"
          onClick={() => onDrillIn?.()}
        >
          +{overflow} more
        </button>
      ) : (
        <div className="cell-popover__footer">
          {hasOverflow ? `…and ${overflow} more species` : 'Click or tap for full list'}
        </div>
      )}
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(content, document.body);
  }
  return content;
}

import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { SpeciesAggregate } from './adaptive-grid.js';
import { prettyFamily } from '../../derived.js';

/**
 * `<CellPopover>` — full popover for one family within an adaptive-grid cell
 * (epic #556 Phase 1, issue #558; species data now real per #859).
 *
 * Renders the family's species rows as `{count}× {comName}`. With #859 the
 * `species` rows carry REAL eBird codes resolved against the species dictionary
 * (no more synthetic `agg-*` rows / Latin family-code names), so every row with
 * a non-null `speciesCode` is a working `role="link"` into the species detail.
 * Spuh/slash/hybrid taxa (`speciesCode === null`) render as a static `<span>`.
 *
 * `+N more` is an ACTIVE DRILL-IN (#859 D): when a family has more distinct
 * species than the popover shows (`overflowCount > 0`), the footer is a button
 * that calls `onDrillIn` — the caller zooms the map into this cell where the
 * top-8 cap no longer applies. When there is no overflow, the footer is the
 * static "Click or tap for full list" hint.
 *
 * #859 E (structural z-index): the popover PORTALS to `document.body` so the
 * maplibre marker `<div>`'s `transform` (a stacking context) can't let the
 * cluster pills paint over it. Positioning/flip/shift/clamp is owned by the
 * caller via the anchor; the portal only changes the DOM parent, not the visual
 * placement. Mirrors the `<CellHoverPreview>` portal.
 */
export interface CellPopoverProps {
  familyCode: string;
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
    familyCode, familyCount, species, overflowCount, anchorEl,
    onDismiss, onSelectSpecies, onDrillIn,
  } = props;
  const headingId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  const visible = species.slice(0, POPOVER_CAP);
  // Overflow is the EXACT distinct-species remainder when the caller supplies
  // it (#859 — driven by the family's true speciesCount, not the capped row
  // count); otherwise fall back to the rendered-row remainder.
  const overflow = overflowCount ?? species.length - POPOVER_CAP;
  const hasOverflow = overflow > 0;
  // The drill-in is active only when the caller wired a handler AND there is
  // overflow to drill into.
  const drillInActive = hasOverflow && typeof onDrillIn === 'function';

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

  function onRowKeyDown(e: KeyboardEvent<HTMLAnchorElement>, code: string) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelectSpecies(code);
    }
  }

  const content = (
    <div
      ref={rootRef}
      role="dialog"
      aria-labelledby={headingId}
      className="cell-popover"
      data-testid="cell-popover"
    >
      <header className="cell-popover__header">
        <h2
          ref={headingRef}
          id={headingId}
          className="cell-popover__heading"
          tabIndex={-1}
          data-testid="cell-popover-heading"
        >
          {prettyFamily(familyCode)} ({familyCount})
        </h2>
      </header>
      <ul className="cell-popover__rows">
        {visible.map((s) => {
          const code = s.speciesCode;
          if (code !== null) {
            return (
              <li key={s.comName} className="cell-popover__row cell-popover__row--clickable">
                <a
                  role="link"
                  tabIndex={0}
                  data-testid="cell-popover-row"
                  onClick={(e) => {
                    e.preventDefault();
                    onSelectSpecies(code);
                  }}
                  onKeyDown={(e) => onRowKeyDown(e, code)}
                >
                  {s.count}x {s.comName}
                </a>
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
              <span>{s.count}x {s.comName}</span>
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

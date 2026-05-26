import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import type { SpeciesAggregate } from './adaptive-grid.js';
import { prettyFamily } from '../../derived.js';
import { isSyntheticCode } from '../../data/use-bird-data.js';

/**
 * `<CellPopover>` — full popover for an adaptive-grid cell (epic #556
 * Phase 1, issue #558, spec
 * `docs/specs/2026-05-15-cell-species-popover-design.md` §4.4).
 *
 * Top 8 species per family with "…and N more species" footer when
 * species.length > 8. Clickable rows (role="link") when speciesCode is
 * non-null; static <span> for spuh/slash/hybrid taxa where eBird returns
 * no canonical code. Non-modal `role="dialog"`. ESC + click-outside
 * dismiss, focus returns to the triggering cell.
 *
 * Phase 1 signature: `onSelectSpecies(speciesCode)`. Phase 3 (#560) will
 * widen to `(speciesCode, bbox)` for the SpeciesDetailSurface bbox-scoped
 * variant.
 */
export interface CellPopoverProps {
  familyCode: string;
  familyCount: number;
  species: ReadonlyArray<SpeciesAggregate>;
  anchorEl: HTMLElement;
  onDismiss: () => void;
  onSelectSpecies: (speciesCode: string) => void;
}

const POPOVER_CAP = 8;

export function CellPopover(props: CellPopoverProps) {
  const { familyCode, familyCount, species, anchorEl, onDismiss, onSelectSpecies } = props;
  const headingId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  const visible = species.slice(0, POPOVER_CAP);
  const overflow = species.length - POPOVER_CAP;
  const footerText =
    overflow > 0 ? `…and ${overflow} more species` : 'Click or tap for full list';

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

  return (
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
          // #715: synthetic `agg-*` codes (aggregated z<6 buckets) are
          // non-resolvable by /api/species/:code and must render as static
          // spans, identical to spuh/slash/hybrid rows with a null code.
          const clickable = s.speciesCode !== null && !isSyntheticCode(s.speciesCode);
          const code = s.speciesCode;
          if (clickable && code !== null) {
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
      <div className="cell-popover__footer">{footerText}</div>
    </div>
  );
}

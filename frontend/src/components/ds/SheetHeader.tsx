import type { ReactNode } from 'react';

/**
 * SheetHeader — the ONE shared sheet-header affordance vocabulary (#1026).
 *
 * Both the mobile detail sheet (SpeciesDetailSheet) and the filters sheet
 * (App.tsx) adopt this so a user who learns "grabber + × + Escape" on one sheet
 * carries it to the other (V31: the sheets used to expose opposite affordance
 * sets — the detail sheet had a grabber and no ×, the filters sheet had a × and
 * no grabber). The grabber is a SLOT: the detail sheet hands in its existing
 * pointer-wired `.sheet-handle` button so the delicate drag/snap/inert wiring is
 * never pulled into a shared component (that wiring stays local to the sheet and
 * its tests). The filters sheet supplies no grabber — it is a plain bottom panel,
 * not a draggable detent surface (full detent mechanics for filters are out of
 * scope per the issue) — so it gets the × alone.
 *
 * The × is a BARE icon button (the shared convention SpeciesDetailRail.tsx
 * already uses): glyph `×`, accessible name via `closeLabel`, ≥44px hit area
 * supplied by the consumer's CSS (`.filters-panel-close` / `.sheet-close`).
 * `closeClassName` keeps the existing `.filters-panel-close` selector
 * byte-identical so the filters CSS and the e2e POM (`getByRole('button',
 * { name: /Close filters/i })`) resolve unchanged.
 */
export interface SheetHeaderProps {
  /** Accessible name for the close button. The filters sheet MUST pass exactly
   *  `"Close filters"` (e2e + POM resolve on it); the detail sheet passes
   *  `"Close species detail"` (matches SpeciesDetailRail). */
  closeLabel: string;
  /** Fired when the × is activated. The detail sheet wires `closeWithRestore`
   *  here so #910 focus-restore is preserved on the single-pointer close path. */
  onClose: () => void;
  /** className for the × button. Defaults to the detail-sheet `sheet-close`;
   *  the filters sheet passes `filters-panel-close` to keep its CSS + e2e
   *  selector unchanged. */
  closeClassName?: string;
  /** Optional grabber affordance rendered before the ×. The detail sheet passes
   *  its pointer-wired drag handle; the filters sheet omits it. */
  grabber?: ReactNode;
}

export function SheetHeader({
  closeLabel,
  onClose,
  closeClassName = 'sheet-close',
  grabber,
}: SheetHeaderProps) {
  return (
    <>
      {grabber}
      <button
        type="button"
        className={closeClassName}
        aria-label={closeLabel}
        onClick={onClose}
      >
        ×
      </button>
    </>
  );
}

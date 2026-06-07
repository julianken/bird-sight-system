import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { SpeciesAggregate } from './adaptive-grid.js';
import { prettyFamily } from '../../derived.js';

/**
 * `<CellHoverPreview>` — compact hover preview for an adaptive-grid cell
 * (epic #556 Phase 1, issue #558, spec
 * `docs/specs/2026-05-15-cell-species-popover-design.md` §4.4).
 *
 * Top 3 species per family in descending count order. Footer "Click for
 * more" appears ONLY when the family has > 3 species — telling the user
 * to click for the full `<CellPopover>`. Tooltip role; no focus
 * management (tooltips don't take focus per WAI-ARIA tooltip pattern).
 */
export interface CellHoverPreviewProps {
  /** Family code; resolved to display name via `prettyFamily` when `familyName` is absent. */
  familyCode: string;
  /**
   * #920: pre-resolved colloquial family name (the tile's `displayName`).
   * When omitted, the header falls back to `prettyFamily(familyCode)`.
   */
  familyName?: string;
  /** Total observations of this family in the cluster (badge value). */
  familyCount: number;
  /** Species in descending count order; consumer slices to ≤ 3 if desired. */
  species: ReadonlyArray<SpeciesAggregate>;
  /** Required id used by the trigger's `aria-describedby`. */
  id: string;
  /**
   * Cursor position in viewport coordinates. When provided, the preview
   * is rendered at `position: fixed` with translate-based offset from
   * the cursor (16px right, 12px below). When null/undefined, the
   * preview falls back to its CSS-anchored position (legacy / test).
   */
  cursorPos?: { x: number; y: number } | null;
}

const PREVIEW_CAP = 3;

export function CellHoverPreview(props: CellHoverPreviewProps) {
  const { familyCode, familyName, familyCount, species, id, cursorPos } = props;
  const visible = species.slice(0, PREVIEW_CAP);
  const hasMore = species.length > PREVIEW_CAP;

  // #761 O6 (#782): the cursor-following branch keeps `position: fixed` +
  // `left`/`top`/`pointerEvents` inline (computed from `cursorPos`, cannot move
  // to CSS), but the stacking level no longer comes from the off-scale inline
  // literal it used to carry (the magic 1000). Both render paths now inherit the
  // `.cell-hover-preview` class's named `--z-modal` (50) token, so the
  // keyboard-focus path and the cursor-following path agree on rank (above the
  // cell/cluster popovers the tooltip can overlap) instead of disagreeing by ~955.
  const positionStyle: CSSProperties | undefined = cursorPos
    ? {
        position: 'fixed',
        left: cursorPos.x + 16,
        top: cursorPos.y + 12,
        pointerEvents: 'none',
      }
    : undefined;

  const content = (
    <div
      role="tooltip"
      id={id}
      className="cell-hover-preview"
      data-testid="cell-hover-preview"
      style={positionStyle}
    >
      <div className="cell-hover-preview__header">
        {familyName ?? prettyFamily(familyCode)} ({familyCount})
      </div>
      <ul className="cell-hover-preview__rows">
        {visible.map((s) => (
          <li
            key={s.comName}
            className="cell-hover-preview__row"
            data-testid="cell-hover-preview-row"
          >
            {s.count}x {s.comName}
          </li>
        ))}
      </ul>
      {hasMore && (
        <div className="cell-hover-preview__footer">Click for more</div>
      )}
    </div>
  );

  // Portal to body ONLY when cursor-following is active. Without the portal,
  // an ancestor's `transform` (e.g., MapLibre marker container) breaks
  // position: fixed (CSS containing-block quirk — fixed becomes relative
  // to the transformed ancestor, not the viewport). The portal escapes that.
  if (cursorPos && typeof document !== 'undefined') {
    return createPortal(content, document.body);
  }
  return content;
}

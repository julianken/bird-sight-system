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
  /** Family code; resolved to display name via `prettyFamily`. */
  familyCode: string;
  /** Total observations of this family in the cluster (badge value). */
  familyCount: number;
  /** Species in descending count order; consumer slices to ≤ 3 if desired. */
  species: ReadonlyArray<SpeciesAggregate>;
  /** Required id used by the trigger's `aria-describedby`. */
  id: string;
}

const PREVIEW_CAP = 3;

export function CellHoverPreview(props: CellHoverPreviewProps) {
  const { familyCode, familyCount, species, id } = props;
  const visible = species.slice(0, PREVIEW_CAP);
  const hasMore = species.length > PREVIEW_CAP;

  return (
    <div
      role="tooltip"
      id={id}
      className="cell-hover-preview"
      data-testid="cell-hover-preview"
    >
      <div className="cell-hover-preview__header">
        {prettyFamily(familyCode)} ({familyCount})
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
}

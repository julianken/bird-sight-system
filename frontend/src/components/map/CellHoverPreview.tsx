import type { SpeciesAggregate } from './adaptive-grid.js';

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

export function CellHoverPreview(_props: CellHoverPreviewProps) {
  throw new Error('not implemented');
}

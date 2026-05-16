import type { SpeciesAggregate } from './adaptive-grid.js';

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

export function CellPopover(_props: CellPopoverProps) {
  throw new Error('not implemented');
}

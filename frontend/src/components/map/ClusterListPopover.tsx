import type { FamilyAggregate, SpeciesAggregate } from './adaptive-grid.js';

/**
 * `<ClusterListPopover>` — mobile / coarse-pointer sheet-style popover for
 * the full cluster (epic #556 Phase 2, issue #559, spec
 * `docs/specs/2026-05-15-cell-species-popover-design.md` §4.4, §5.3).
 *
 * Non-modal `role="dialog"`. Collapsible family sections — initially the top
 * 2 families (highest count) are expanded; the rest are collapsed. Each
 * expanded family shows the top 8 species + "…and N more species" footer
 * when that family has more. Spuh/slash/hybrid taxa with `speciesCode ===
 * null` render as static `<span>` (no link); otherwise as `<a role="link">`.
 *
 * Dismiss surfaces: "Done" button at bottom, ESC, click-outside. Each
 * returns focus to the supplied `anchorEl` (the outer marker `<button>`).
 *
 * Phase 2 signature: `onSelectSpecies(speciesCode)`. Phase 3 (#560) will
 * widen to `(speciesCode, bbox)` for the SpeciesDetailSurface bbox-scoped
 * variant.
 */
export interface ClusterListPopoverProps {
  /** All families in the cluster, descending count order (from `aggregateClusterFamilies`). */
  families: ReadonlyArray<FamilyAggregate>;
  /** Species lookup keyed by familyCode. */
  speciesByFamily: ReadonlyMap<string, ReadonlyArray<SpeciesAggregate>>;
  /** Total point_count for the cluster header. */
  totalCount: number;
  /** Total unique families for the cluster header. */
  uniqueFamilies: number;
  /** Anchor element for focus return. */
  anchorEl: HTMLElement;
  /** Invoked when user dismisses (ESC, click-outside, Done). */
  onDismiss: () => void;
  /** Invoked when user clicks a species row with non-null speciesCode. */
  onSelectSpecies: (speciesCode: string) => void;
}

export function ClusterListPopover(_props: ClusterListPopoverProps) {
  throw new Error('not implemented');
}
